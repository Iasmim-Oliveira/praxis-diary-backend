import { Injectable } from '@nestjs/common';
import {
  collectDefaultMetrics,
  Counter,
  Histogram,
  Registry,
} from 'prom-client';

// RNF09 (ver ADR 0007). Registry próprio em vez do global do prom-client:
// cada instância do AppModule (ex.: um por teste e2e) ganha o seu, sem erro
// de "metric already registered".
@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  // Buckets com 0.5 de propósito: é o limite do RNF04 (< 500 ms), então dá
  // para ler direto do histograma quantas requisições ficaram dentro dele.
  readonly httpRequestDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'Duração das requisições HTTP, por método, rota e status',
    labelNames: ['method', 'route', 'status_code'] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [this.registry],
  });

  readonly authLogins = new Counter({
    name: 'auth_login_attempts_total',
    help: 'Tentativas de login, por resultado',
    labelNames: ['result'] as const,
    registers: [this.registry],
  });

  readonly appointmentsCreated = new Counter({
    name: 'appointments_created_total',
    help: 'Agendamentos criados',
    registers: [this.registry],
  });

  readonly appointmentsUpdated = new Counter({
    name: 'appointments_updated_total',
    help: 'Agendamentos editados, separando reagendamentos (horário/serviço)',
    labelNames: ['rescheduled'] as const,
    registers: [this.registry],
  });

  readonly appointmentsCancelled = new Counter({
    name: 'appointments_cancelled_total',
    help: 'Agendamentos cancelados',
    registers: [this.registry],
  });

  readonly appointmentConflicts = new Counter({
    name: 'appointment_conflicts_total',
    help: 'Tentativas bloqueadas por conflito de horário (RN01)',
    labelNames: ['operation'] as const,
    registers: [this.registry],
  });

  readonly cancellationsRejected = new Counter({
    name: 'appointment_cancellations_rejected_total',
    help: 'Cancelamentos recusados pela antecedência mínima (RN04)',
    registers: [this.registry],
  });

  constructor() {
    // CPU, memória, heap, event loop lag, GC — saúde do processo Node.
    collectDefaultMetrics({ register: this.registry });
  }
}
