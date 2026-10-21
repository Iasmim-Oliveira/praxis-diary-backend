import { createHash, timingSafeEqual } from 'node:crypto';
import {
  Controller,
  Get,
  Headers,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { MetricsService } from './metrics.service';

// @Public: o Prometheus não tem JWT de usuário. @SkipThrottle: o scrape é
// periódico e não pode ser bloqueado pelo rate limit.
//
// Proteção própria (ver ADR 0007): com METRICS_TOKEN definido, exige
// `Authorization: Bearer <token>` — o Prometheus suporta isso nativamente.
// Sem a variável, fica aberto (aceitável em dev, como o CORS; NUNCA em
// produção, onde as métricas revelariam rotas, volume e saúde da API).
@Public()
@SkipThrottle()
@Controller('metrics')
export class MetricsController {
  constructor(
    private readonly metrics: MetricsService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  async scrape(
    @Headers('authorization') authorization: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    this.ensureAuthorized(authorization);

    res.setHeader('Content-Type', this.metrics.registry.contentType);
    return this.metrics.registry.metrics();
  }

  private ensureAuthorized(authorization: string | undefined): void {
    const token = this.config.get<string>('METRICS_TOKEN')?.trim();
    if (!token) {
      return;
    }

    // Compara os hashes (mesmo tamanho sempre) com timingSafeEqual, para o
    // tempo de resposta não vazar quantos caracteres do token estão certos.
    const expected = createHash('sha256').update(`Bearer ${token}`).digest();
    const received = createHash('sha256')
      .update(authorization ?? '')
      .digest();

    if (!timingSafeEqual(expected, received)) {
      throw new UnauthorizedException();
    }
  }
}
