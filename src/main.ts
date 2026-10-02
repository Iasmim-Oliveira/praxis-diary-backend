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
  // CORS_ALLOWED_ORIGINS definida (ou vazia/só espaço/só vírgula — qualquer
  // valor que não sobre nenhuma origem de verdade depois do split+trim),
  // libera qualquer origem. Antes de qualquer deploy real, essa variável
  // precisa apontar para a origem real do frontend.
  //
  // O filter() importa: "" ou " " já são strings truthy, e um array como
  // [''] também é truthy (não é a mesma coisa que vazio) — sem filtrar as
  // entradas em branco, `?? '*'` nunca dispararia nesses casos, e o CORS
  // ficaria configurado pra aceitar uma origem vazia, ou seja, nenhuma.
  const allowedOrigins = process.env.CORS_ALLOWED_ORIGINS?.split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  app.enableCors({
    origin: allowedOrigins && allowedOrigins.length > 0 ? allowedOrigins : '*',
  });

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
