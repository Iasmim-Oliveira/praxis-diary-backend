import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

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
