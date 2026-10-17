import { IsDateString, IsUUID, Matches } from 'class-validator';

// RF05: consulta de disponibilidade de horários.
export class AvailabilityQueryDto {
  @IsUUID()
  serviceId: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'date deve estar no formato YYYY-MM-DD',
  })
  @IsDateString({ strict: true })
  date: string;
}
