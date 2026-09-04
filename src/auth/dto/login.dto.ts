import { IsEmail, IsString, IsUUID } from 'class-validator';

export class LoginDto {
  // Simplificação atual: o e-mail só é único DENTRO de um tenant (ver ADR 0001),
  // então o login precisa saber a qual tenant o usuário pertence.
  // Em produção isso normalmente viria de um subdomínio (ex: minhaorg.praxisdiary.com)
  // em vez de pedir o tenantId explicitamente no formulário de login.
  @IsUUID()
  tenantId: string;

  @IsEmail()
  email: string;

  @IsString()
  password: string;
}
