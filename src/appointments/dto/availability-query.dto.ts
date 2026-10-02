import { IsDateString, IsUUID } from 'class-validator';

// RF05: consulta de disponibilidade de horários.
export class AvailabilityQueryDto {
  @IsUUID()
  serviceId: string;

  @IsDateString()
  date: string;
}
