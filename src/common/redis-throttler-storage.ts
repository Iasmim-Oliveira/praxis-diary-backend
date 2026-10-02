import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import Redis from 'ioredis';

// Implementação de ThrottlerStorage com Redis, pra substituir o storage
// padrão em memória do @nestjs/throttler (ver ADR 0006 — RNF06 exige
// compatibilidade com escalabilidade horizontal, e contadores em memória não
// são compartilhados entre réplicas nem sobrevivem a um restart).
//
// Reproduz o mesmo algoritmo do storage padrão (lido em
// node_modules/@nestjs/throttler/dist/throttler.service.js):
// - janela deslizante por chave (um ZSET por chave+throttler, cada hit é um
//   membro com score = timestamp; hits mais velhos que `ttl` são podados a
//   cada chamada)
// - quando o número de hits na janela atinge o limite, a chave entra em
//   "bloqueio" por `blockDuration` — enquanto bloqueada, novas tentativas não
//   são contadas, só recusadas, até o bloqueio expirar
//
// Nota: `blockDuration` não é 0 por padrão no @nestjs/throttler — quando não
// especificado, o valor é igual ao `ttl` (ver throttler.guard.js). Ou seja,
// o caminho "com bloqueio" é o que está em uso aqui, não um caso raro.
@Injectable()
export class RedisThrottlerStorage
  implements ThrottlerStorage, OnApplicationShutdown
{
  private readonly redis: Redis;

  constructor(redisUrl: string) {
    this.redis = new Redis(redisUrl);
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<{
    totalHits: number;
    timeToExpire: number;
    isBlocked: boolean;
    timeToBlockExpire: number;
  }> {
    const hitsKey = `throttler:{${key}:${throttlerName}}:hits`;
    const blockedKey = `throttler:{${key}:${throttlerName}}:blocked`;
    const now = Date.now();
    const member = `${now}-${Math.random()}`;

    const [totalHits, isBlockedRaw, blockPttl] = (await this.redis.eval(
      LUA_INCREMENT,
      2,
      hitsKey,
      blockedKey,
      now,
      ttl,
      limit,
      blockDuration,
      member,
    )) as [number, number, number];

    return {
      totalHits,
      timeToExpire: Math.ceil(ttl / 1000),
      isBlocked: isBlockedRaw === 1,
      timeToBlockExpire: Math.ceil(blockPttl / 1000),
    };
  }

  onApplicationShutdown() {
    this.redis.disconnect();
  }
}

// KEYS[1] = hitsKey (ZSET da janela deslizante)
// KEYS[2] = blockedKey (existe só enquanto bloqueado, com TTL = blockDuration)
// ARGV[1] = now (ms)      ARGV[2] = ttl (ms)
// ARGV[3] = limit         ARGV[4] = blockDuration (ms, 0 = sem bloqueio)
// ARGV[5] = member (identificador único deste hit no ZSET)
const LUA_INCREMENT = `
local hitsKey = KEYS[1]
local blockedKey = KEYS[2]
local now = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local blockDuration = tonumber(ARGV[4])
local member = ARGV[5]

local blockPttl = redis.call('PTTL', blockedKey)
if blockPttl and blockPttl > 0 then
  local hits = redis.call('ZCARD', hitsKey)
  return {hits, 1, blockPttl}
end

redis.call('ZREMRANGEBYSCORE', hitsKey, 0, now - ttl)
local count = redis.call('ZCARD', hitsKey)

if count >= limit then
  if blockDuration > 0 then
    redis.call('SET', blockedKey, 1, 'PX', blockDuration)
  end
  return {count + 1, 1, blockDuration}
end

redis.call('ZADD', hitsKey, now, member)
redis.call('PEXPIRE', hitsKey, ttl)
return {count + 1, 0, 0}
`;
