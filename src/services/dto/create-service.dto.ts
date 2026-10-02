import { IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class CreateServiceDto {
  @IsString()
  @MinLength(2)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  // RN03 (ADR 0005): todo serviço precisa de duração definida — é o que
  // permite calcular o fim do agendamento e checar conflitos de horário.
  @IsInt()
  @Min(1)
  durationMinutes: number;
}
