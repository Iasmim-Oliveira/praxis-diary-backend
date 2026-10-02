import { Module } from '@nestjs/common';
import { requireEnv } from './env.util';
import { RedisThrottlerStorage } from './redis-throttler-storage';

// Módulo próprio só pra isso ser um provider de verdade do Nest (não um
// `new RedisThrottlerStorage(...)` direto dentro da fábrica do ThrottlerModule),
// e assim poder ser substituído por mock nos testes e2e, igual o PrismaService.
@Module({
  providers: [
    {
      provide: RedisThrottlerStorage,
      // Fábrica (não construção no topo do arquivo): só roda quando o Nest
      // instancia o provider, depois do ConfigModule já ter carregado o .env.
      useFactory: () => new RedisThrottlerStorage(requireEnv('REDIS_URL')),
    },
  ],
  exports: [RedisThrottlerStorage],
})
export class RedisThrottlerStorageModule {}
