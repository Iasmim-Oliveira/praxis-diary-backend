import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { AppointmentsService } from './appointments.service';
import { AvailabilityQueryDto } from './dto/availability-query.dto';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { ListAppointmentsQueryDto } from './dto/list-appointments-query.dto';

// RF04/RF05/RF07 do TCC. Sem @Roles() — qualquer usuário autenticado opera a
// agenda (ver ADR 0005).
@Controller('appointments')
export class AppointmentsController {
  constructor(private readonly appointmentsService: AppointmentsService) {}

  @Post()
  create(@Body() dto: CreateAppointmentDto, @CurrentUser() user: JwtPayload) {
    return this.appointmentsService.create(dto, user.sub);
  }

  @Get()
  findAll(@Query() query: ListAppointmentsQueryDto) {
    return this.appointmentsService.findAll(query.from, query.to);
  }

  // Precisa vir ANTES de GET /:id — senão "availability" seria interpretado
  // como um :id (e rejeitado pelo ParseUUIDPipe da rota seguinte).
  @Get('availability')
  availability(@Query() query: AvailabilityQueryDto) {
    return this.appointmentsService.availability(query.serviceId, query.date);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.appointmentsService.findOneOrThrow(id);
  }

  @HttpCode(HttpStatus.OK)
  @Post(':id/cancel')
  cancel(@Param('id', ParseUUIDPipe) id: string) {
    return this.appointmentsService.cancel(id);
  }
}
