import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Appointment,
  AppointmentStatus,
  Prisma,
} from '../../generated/prisma/client';
import { MetricsService } from '../metrics/metrics.service';
import { PrismaService } from '../prisma/prisma.service';
import { ClientsService } from '../clients/clients.service';
import { ServicesService } from '../services/services.service';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';

// RN04 (ADR 0005): constante no código, não configurável por enquanto.
const MIN_CANCELLATION_NOTICE_MINUTES = 60;

// RF05 (ADR 0005): horário de funcionamento fixo — simplificação de escopo
// assumida conscientemente, igual a outras já registradas neste projeto.
const BUSINESS_HOURS = { startHour: 8, endHour: 18 };

export interface AvailabilitySlot {
  startsAt: Date;
  endsAt: Date;
}

type WriteOperation = 'create' | 'update';

@Injectable()
export class AppointmentsService {
  // Logs de negócio (ver ADR 0007): herdam o req.id da requisição.
  private readonly logger = new Logger(AppointmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly servicesService: ServicesService,
    private readonly clientsService: ClientsService,
    private readonly metrics: MetricsService,
  ) {}

  async create(dto: CreateAppointmentDto, createdById: string) {
    const service = await this.servicesService.findOneOrThrow(dto.serviceId);
    await this.clientsService.findOneOrThrow(dto.clientId);

    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(
      startsAt.getTime() + service.durationMinutes * 60_000,
    );

    await this.ensureNoOverlap('create', startsAt, endsAt);

    let appointment: Appointment;
    try {
      appointment = await this.prisma.appointment.create({
        data: {
          clientId: dto.clientId,
          serviceId: dto.serviceId,
          createdById,
          startsAt,
          endsAt,
        },
      });
    } catch (error) {
      // RN01 (ver ADR 0005): a checagem acima não é atômica com este create
      // — é só a resposta amigável do caso comum. Quem garante de verdade,
      // mesmo sob concorrência, é a exclusion constraint `appointment_no_overlap`
      // no banco. Se ela disparar, convertemos pro mesmo erro amigável.
      if (this.isOverlapViolation(error)) {
        throw this.overlapConflict('create', 'constraint', startsAt, endsAt);
      }
      throw error;
    }

    this.metrics.appointmentsCreated.inc();
    this.logger.log({
      msg: 'appointment created',
      appointmentId: appointment.id,
      serviceId: appointment.serviceId,
      clientId: appointment.clientId,
      startsAt: appointment.startsAt,
    });

    return appointment;
  }

  findAll(from?: string, to?: string) {
    const where: Prisma.AppointmentWhereInput = {};
    if (from) {
      where.endsAt = { gte: new Date(from) };
    }
    if (to) {
      where.startsAt = { lte: new Date(to) };
    }

    return this.prisma.appointment.findMany({
      where,
      orderBy: { startsAt: 'asc' },
      include: { client: true, service: true },
    });
  }

  async findOneOrThrow(id: string) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id },
      include: { client: true, service: true },
    });
    if (!appointment) {
      throw new NotFoundException('Agendamento não encontrado');
    }
    return appointment;
  }

  async update(id: string, dto: UpdateAppointmentDto) {
    const appointment = await this.findOneOrThrow(id);

    if (appointment.status === AppointmentStatus.CANCELLED) {
      throw new ConflictException(
        'Não é possível editar um agendamento cancelado',
      );
    }

    if (dto.clientId) {
      await this.clientsService.findOneOrThrow(dto.clientId);
    }

    // Mudar o horário ou o serviço é um reagendamento: `endsAt` é recalculado
    // no servidor com a duração atual do serviço e passa de novo pela RN01.
    // Trocar só o cliente mantém o intervalo congelado (ADR 0005, Decisão 1).
    let { startsAt, endsAt } = appointment;
    const rescheduled = Boolean(dto.startsAt || dto.serviceId);
    if (rescheduled) {
      const service = dto.serviceId
        ? await this.servicesService.findOneOrThrow(dto.serviceId)
        : appointment.service;
      startsAt = dto.startsAt ? new Date(dto.startsAt) : appointment.startsAt;
      endsAt = new Date(startsAt.getTime() + service.durationMinutes * 60_000);

      await this.ensureNoOverlap('update', startsAt, endsAt, id);
    }

    let updated: Appointment;
    try {
      updated = await this.prisma.appointment.update({
        where: { id },
        data: {
          clientId: dto.clientId,
          serviceId: dto.serviceId,
          startsAt,
          endsAt,
        },
      });
    } catch (error) {
      // Mesma garantia do create: a exclusion constraint é quem decide sob
      // concorrência; a checagem acima é só a resposta amigável.
      if (this.isOverlapViolation(error)) {
        throw this.overlapConflict('update', 'constraint', startsAt, endsAt);
      }
      throw error;
    }

    this.metrics.appointmentsUpdated.inc({ rescheduled: String(rescheduled) });
    this.logger.log({
      msg: 'appointment updated',
      appointmentId: id,
      rescheduled,
      startsAt: updated.startsAt,
    });

    return updated;
  }

  async cancel(id: string) {
    const appointment = await this.findOneOrThrow(id);

    if (appointment.status === AppointmentStatus.CANCELLED) {
      throw new ConflictException('Agendamento já está cancelado');
    }

    const minutesUntilStart =
      (appointment.startsAt.getTime() - Date.now()) / 60_000;
    if (minutesUntilStart < MIN_CANCELLATION_NOTICE_MINUTES) {
      this.metrics.cancellationsRejected.inc();
      this.logger.warn({
        msg: 'appointment cancellation rejected',
        reason: 'notice_period',
        appointmentId: id,
        minutesUntilStart: Math.floor(minutesUntilStart),
      });
      throw new ConflictException(
        `Cancelamento só é permitido até ${MIN_CANCELLATION_NOTICE_MINUTES} minutos antes do horário`,
      );
    }

    const cancelled = await this.prisma.appointment.update({
      where: { id },
      data: { status: AppointmentStatus.CANCELLED, cancelledAt: new Date() },
    });

    this.metrics.appointmentsCancelled.inc();
    this.logger.log({ msg: 'appointment cancelled', appointmentId: id });

    return cancelled;
  }

  async availability(
    serviceId: string,
    dateStr: string,
  ): Promise<AvailabilitySlot[]> {
    const service = await this.servicesService.findOneOrThrow(serviceId);

    const dayStart = new Date(`${dateStr}T00:00:00`);
    dayStart.setHours(BUSINESS_HOURS.startHour, 0, 0, 0);
    const dayEnd = new Date(`${dateStr}T00:00:00`);
    dayEnd.setHours(BUSINESS_HOURS.endHour, 0, 0, 0);

    const appointments = await this.prisma.appointment.findMany({
      where: {
        status: AppointmentStatus.SCHEDULED,
        startsAt: { lt: dayEnd },
        endsAt: { gt: dayStart },
      },
    });

    const durationMs = service.durationMinutes * 60_000;
    const slots: AvailabilitySlot[] = [];

    for (
      let slotStart = dayStart;
      slotStart.getTime() + durationMs <= dayEnd.getTime();
      slotStart = new Date(slotStart.getTime() + durationMs)
    ) {
      const slotEnd = new Date(slotStart.getTime() + durationMs);
      const overlaps = appointments.some(
        (a) => slotStart < a.endsAt && slotEnd > a.startsAt,
      );
      if (!overlaps) {
        slots.push({ startsAt: slotStart, endsAt: slotEnd });
      }
    }

    return slots;
  }

  // `excludingId`: no update, o próprio agendamento não conta como conflito
  // consigo mesmo (ex.: adiar 15 minutos um horário que se sobrepõe ao atual).
  private async ensureNoOverlap(
    operation: WriteOperation,
    startsAt: Date,
    endsAt: Date,
    excludingId?: string,
  ): Promise<void> {
    const overlapping = await this.prisma.appointment.findFirst({
      where: {
        id: excludingId ? { not: excludingId } : undefined,
        status: AppointmentStatus.SCHEDULED,
        startsAt: { lt: endsAt },
        endsAt: { gt: startsAt },
      },
    });
    if (overlapping) {
      throw this.overlapConflict(operation, 'precheck', startsAt, endsAt);
    }
  }

  // `detectedBy` separa a checagem prévia da constraint do banco: um volume
  // alto de 'constraint' indica corrida real entre requisições simultâneas.
  private overlapConflict(
    operation: WriteOperation,
    detectedBy: 'precheck' | 'constraint',
    startsAt: Date,
    endsAt: Date,
  ): ConflictException {
    this.metrics.appointmentConflicts.inc({ operation });
    this.logger.warn({
      msg: 'appointment conflict',
      operation,
      detectedBy,
      startsAt,
      endsAt,
    });
    return new ConflictException('Já existe um agendamento nesse horário');
  }

  private isOverlapViolation(error: unknown): boolean {
    return (
      (error instanceof Prisma.PrismaClientKnownRequestError ||
        error instanceof Prisma.PrismaClientUnknownRequestError) &&
      typeof (error as { message?: unknown }).message === 'string' &&
      (error as Error).message.includes('appointment_no_overlap')
    );
  }
}
