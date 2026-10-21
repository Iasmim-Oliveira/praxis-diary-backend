import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { RedisThrottlerStorage } from './common/redis-throttler-storage';
import { RedisThrottlerStorageModule } from './common/redis-throttler-storage.module';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { ServicesModule } from './services/services.module';
import { ClientsModule } from './clients/clients.module';
import { AppointmentsModule } from './appointments/appointments.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { RolesGuard } from './auth/guards/roles.guard';
import type { JwtPayload } from './auth/interfaces/jwt-payload.interface';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Logs estruturados (RNF08, ver LOGGING.md). forRootAsync + ConfigService
    // pelo mesmo motivo do Throttler abaixo: a config depende de env.
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const env = config.get<string>('NODE_ENV');
        const isProduction = env === 'production';

        return {
          pinoHttp: {
            // `||` e não o default do get(): no .env.example a variável vem
            // vazia (LOG_LEVEL=), e '' não é um nível válido para o pino.
            level:
              env === 'test'
                ? 'silent'
                : config.get<string>('LOG_LEVEL') ||
                  (isProduction ? 'info' : 'debug'),

            // JSON puro em produção (formato processável por ferramentas);
            // legível no terminal em dev.
            transport: isProduction
              ? undefined
              : { target: 'pino-pretty', options: { singleLine: true } },

            // Correlação: um id por requisição, presente em todos os logs
            // dela e devolvido no header. Reaproveita o id de um proxy, mas
            // só se for curto e simples — nada de lixo vindo do cliente.
            genReqId: (req, res) => {
              const incoming = req.headers['x-request-id'];
              const id =
                typeof incoming === 'string' && /^[\w-]{1,64}$/.test(incoming)
                  ? incoming
                  : randomUUID();
              res.setHeader('X-Request-Id', id);
              return id;
            },

            // O pino-http chama isso de novo quando a resposta termina — aí
            // o JwtAuthGuard já preencheu req.user.
            customProps: (req) => ({
              userId: (req as Request & { user?: JwtPayload }).user?.sub,
            }),

            customLogLevel: (_req, res, err) => {
              if (err || res.statusCode >= 500) return 'error';
              if (res.statusCode >= 400) return 'warn';
              return 'info';
            },

            // RNF03: credenciais nunca vão para o log. O body não é logado
            // pelo pino-http por padrão (senha e refresh token ficam de fora).
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                'res.headers["set-cookie"]',
              ],
              censor: '[REDACTED]',
            },
          },
        };
      },
    }),
    // Limite global (ver ADR 0006); rotas específicas (login/register) usam
    // @Throttle(...) para sobrescrever com um limite mais estrito.
    // RedisThrottlerStorage vem de um módulo próprio (injetado, não criado
    // com `new` aqui dentro) justamente para poder ser substituído por um
    // mock nos testes e2e, igual o PrismaService.
    ThrottlerModule.forRootAsync({
      imports: [RedisThrottlerStorageModule],
      inject: [RedisThrottlerStorage],
      useFactory: (storage: RedisThrottlerStorage) => ({
        throttlers: [{ ttl: 60000, limit: 100 }],
        storage,
      }),
    }),
    PrismaModule,
    AuthModule,
    UsersModule,
    ServicesModule,
    ClientsModule,
    AppointmentsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Guards globais, executados na ordem em que aparecem aqui:
    // 1. ThrottlerGuard — rejeita (429) antes de gastar trabalho validando
    //    token/papel numa requisição que já excedeu o limite.
    // 2. JwtAuthGuard — exige access token válido (rotas @Public() ficam de fora).
    // 3. RolesGuard — só entra em ação em rotas marcadas com @Roles(...), e
    //    nesse ponto já pode ler request.user (populado pelo guard anterior).
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
