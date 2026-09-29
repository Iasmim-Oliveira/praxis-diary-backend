import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Cabeçalhos de segurança padrão (X-Content-Type-Options, X-Frame-Options,
  // Strict-Transport-Security, remove X-Powered-By, etc). Sem configuração
  // específica — é a prática padrão de mercado para qualquer API Express/Nest.
  app.use(helmet());

  // Origem(ns) configurável via env (ver ADR 0006): em dev, sem
  // CORS_ALLOWED_ORIGINS definida (ou vazia — `.env` traz a chave vazia por
  // padrão, e "" não é a mesma coisa que undefined), libera qualquer origem.
  // Antes de qualquer deploy real, essa variável precisa apontar para a
  // origem real do frontend.
  const rawOrigins = process.env.CORS_ALLOWED_ORIGINS;
  const allowedOrigins = rawOrigins
    ? rawOrigins.split(',').map((origin) => origin.trim())
    : undefined;
  app.enableCors({ origin: allowedOrigins ?? '*' });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // remove do payload qualquer campo que não esteja no DTO
      forbidNonWhitelisted: true, // rejeita a requisição se vier campo extra não esperado
      transform: true, // converte o payload plano em uma instância da classe do DTO
    }),
  );

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
