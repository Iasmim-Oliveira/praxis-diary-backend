import { IsDateString, IsUUID } from 'class-validator';

export class CreateAppointmentDto {
  @IsUUID()
  clientId: string;

  @IsUUID()
  serviceId: string;

  // O fim é calculado no servidor a partir da duração do serviço — nunca
  // aceito do cliente (ver ADR 0005, Decisão 4).
  @IsDateString()
  startsAt: string;
}
