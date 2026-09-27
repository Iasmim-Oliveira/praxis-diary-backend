import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { requireEnv } from '../common/env.util';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    // A partir do Prisma 7, o Client não fala mais direto com o banco por
    // conta própria — ele delega isso a um "driver adapter" (aqui, o driver
    // `pg`, o mesmo usado por qualquer app Node que conecte em Postgres na unha).
    //
    // Precisa ser criado aqui dentro (não como `const` no topo do arquivo):
    // nesse ponto o ConfigModule já carregou o .env no process.env. Se fosse
    // no topo do arquivo, rodaria durante a cadeia de `import`, antes do
    // ConfigModule.forRoot() do AppModule ter a chance de rodar.
    const adapter = new PrismaPg({
      connectionString: requireEnv('DATABASE_URL'),
    });
    super({ adapter });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
