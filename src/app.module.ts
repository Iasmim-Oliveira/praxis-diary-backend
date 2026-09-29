import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { RolesGuard } from './auth/guards/roles.guard';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Limite global (ver ADR 0006); rotas específicas (login/register) usam
    // @Throttle(...) para sobrescrever com um limite mais estrito.
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
    PrismaModule,
    AuthModule,
    UsersModule,
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
