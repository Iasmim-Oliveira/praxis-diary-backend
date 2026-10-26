import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { MetricsService } from './metrics.service';

// Middleware, e não interceptor: interceptors rodam depois dos guards, então
// respostas 401 (JWT) e 429 (throttler) nunca passariam por eles — e são
// justamente sinais que queremos medir.
@Injectable()
export class HttpMetricsMiddleware implements NestMiddleware {
  constructor(private readonly metrics: MetricsService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const end = this.metrics.httpRequestDuration.startTimer();

    res.on('finish', () => {
      // O label é o template da rota (/appointments/:id), nunca a URL real:
      // com o UUID no label, cada agendamento viraria uma série nova no
      // Prometheus (explosão de cardinalidade). Sem rota casada (404),
      // tudo cai num único valor.
      const routePath = (req.route as { path?: string } | undefined)?.path;
      const route = routePath ? `${req.baseUrl}${routePath}` : 'unmatched';

      if (route === '/metrics') {
        return;
      }

      end({
        method: req.method,
        route,
        status_code: String(res.statusCode),
      });
    });

    next();
  }
}
