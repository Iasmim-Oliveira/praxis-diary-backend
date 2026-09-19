import { IsEmail, IsString } from 'class-validator';

export class LoginDto {
  // então o login precisa saber a qual tenant o usuário pertence.
  // Em produção isso normalmente viria de um subdomínio (ex: minhaorg.praxisdiary.com)

  @IsEmail()
  email: string;

  @IsString()
  password: string;
}
