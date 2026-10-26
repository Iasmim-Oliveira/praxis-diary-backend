import { createHash, timingSafeEqual } from 'node:crypto';
import {
  Controller,
  Get,
  Headers,
  OnModuleInit,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { MetricsService } from './metrics.service';

@Public()
@SkipThrottle()
@Controller('metrics')
export class MetricsController implements OnModuleInit {
  constructor(
    private readonly metrics: MetricsService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    if (
      this.config.get<string>('NODE_ENV') === 'production' &&
      !this.metricsToken()
    ) {
      throw new Error(
        'METRICS_TOKEN é obrigatório em produção: sem ele, GET /metrics ficaria público',
      );
    }
  }

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
    const token = this.metricsToken();
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

  private metricsToken(): string | undefined {
    return this.config.get<string>('METRICS_TOKEN')?.trim();
  }
}
