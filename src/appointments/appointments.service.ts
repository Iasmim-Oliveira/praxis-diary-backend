import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AppointmentStatus, Prisma } from '../../generated/prisma/client';
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

@Injectable()
export class AppointmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly servicesService: ServicesService,
    private readonly clientsService: ClientsService,
  ) {}

  async create(dto: CreateAppointmentDto, createdById: string) {
    const service = await this.servicesService.findOneOrThrow(dto.serviceId);
    await this.clientsService.findOneOrThrow(dto.clientId);

    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(
      startsAt.getTime() + service.durationMinutes * 60_000,
    );

    await this.ensureNoOverlap(startsAt, endsAt);

    try {
      return await this.prisma.appointment.create({
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
        throw new ConflictException('Já existe um agendamento nesse horário');
      }
      throw error;
    }
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
    if (dto.startsAt || dto.serviceId) {
      const service = dto.serviceId
        ? await this.servicesService.findOneOrThrow(dto.serviceId)
        : appointment.service;
      startsAt = dto.startsAt ? new Date(dto.startsAt) : appointment.startsAt;
      endsAt = new Date(startsAt.getTime() + service.durationMinutes * 60_000);

      await this.ensureNoOverlap(startsAt, endsAt, id);
    }

    try {
      return await this.prisma.appointment.update({
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
        throw new ConflictException('Já existe um agendamento nesse horário');
      }
      throw error;
    }
  }

  async cancel(id: string) {
    const appointment = await this.findOneOrThrow(id);

    if (appointment.status === AppointmentStatus.CANCELLED) {
      throw new ConflictException('Agendamento já está cancelado');
    }

    const minutesUntilStart =
      (appointment.startsAt.getTime() - Date.now()) / 60_000;
    if (minutesUntilStart < MIN_CANCELLATION_NOTICE_MINUTES) {
      throw new ConflictException(
        `Cancelamento só é permitido até ${MIN_CANCELLATION_NOTICE_MINUTES} minutos antes do horário`,
      );
    }

    return this.prisma.appointment.update({
      where: { id },
      data: { status: AppointmentStatus.CANCELLED, cancelledAt: new Date() },
    });
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
      throw new ConflictException('Já existe um agendamento nesse horário');
    }
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
