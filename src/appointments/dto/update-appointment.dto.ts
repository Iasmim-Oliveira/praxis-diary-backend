import { IsDateString, IsOptional, IsUUID } from 'class-validator';

// RF04: edição de agendamento. Todos os campos são opcionais; `endsAt`
// continua nunca sendo aceito do cliente (ver ADR 0005, Decisão 8).
export class UpdateAppointmentDto {
  @IsOptional()
  @IsUUID()
  clientId?: string;

  @IsOptional()
  @IsUUID()
  serviceId?: string;

  @IsOptional()
  @IsDateString()
  startsAt?: string;
}
