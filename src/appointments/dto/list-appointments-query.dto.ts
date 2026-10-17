import { IsDateString, IsOptional } from 'class-validator';

// RF07: visualização de agenda por período.
export class ListAppointmentsQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
