import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import { RedisThrottlerStorage } from './../src/common/redis-throttler-storage';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  // Mock do Prisma: o e2e testa o guard global e as rotas públicas, não o
  // banco (o fluxo com Postgres real é validado à parte).
  const prismaMock = {
    user: { findUnique: jest.fn(), create: jest.fn() },
    $connect: jest.fn(),
    $disconnect: jest.fn(),
  };

  // Mock do storage do throttler: sem isso, o e2e dependeria de um Redis de
  // verdade rodando (ver ADR 0006) só pra instanciar o AppModule — o mesmo
  // motivo do mock do Prisma acima. "Nunca bloqueado" é o suficiente aqui,
  // já que estes testes não existem pra validar rate limiting.
  const throttlerStorageMock = {
    increment: jest.fn().mockResolvedValue({
      totalHits: 0,
      timeToExpire: 0,
      isBlocked: false,
      timeToBlockExpire: 0,
    }),
  };

  beforeEach(async () => {
    prismaMock.user.findUnique.mockReset();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .overrideProvider(RedisThrottlerStorage)
      .useValue(throttlerStorageMock)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('guard global (GET /)', () => {
    it('sem token → 401', () => {
      return request(app.getHttpServer()).get('/').expect(401);
    });

    it('com token inválido → 401', () => {
      return request(app.getHttpServer())
        .get('/')
        .set('Authorization', 'Bearer token.invalido.aqui')
        .expect(401);
    });

    it('com token assinado com outro segredo → 401', () => {
      const forged = new JwtService().sign(
        { sub: 'u1', email: 'a@b.com' },
        { secret: 'outro-segredo' },
      );
      return request(app.getHttpServer())
        .get('/')
        .set('Authorization', `Bearer ${forged}`)
        .expect(401);
    });

    it('com access token válido → 200', () => {
      const token = new JwtService().sign(
        { sub: 'u1', email: 'a@b.com' },
        { secret: process.env.JWT_ACCESS_SECRET, expiresIn: '5m' },
      );
      return request(app.getHttpServer())
        .get('/')
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
        .expect('Hello World!');
    });

    it('com refresh token no lugar do access token → 401', () => {
      const refresh = new JwtService().sign(
        { sub: 'u1', email: 'a@b.com' },
        { secret: process.env.JWT_REFRESH_SECRET, expiresIn: '5m' },
      );
      return request(app.getHttpServer())
        .get('/')
        .set('Authorization', `Bearer ${refresh}`)
        .expect(401);
    });
  });

  describe('rotas públicas (@Public)', () => {
    it('POST /auth/login sem token chega ao controller (401 por credenciais, não pelo guard)', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);

      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'x@y.com', password: 'qualquer' })
        .expect(401);

      // A mensagem vem do AuthService; o guard responderia só "Unauthorized".
      expect((res.body as { message: string }).message).toBe(
        'Credenciais inválidas',
      );
    });
  });

  describe('observabilidade (ADR 0007)', () => {
    // Fixa METRICS_TOKEN por teste, independente do que estiver no .env
    // (vazio = /metrics aberto). O ConfigService lê process.env na hora.
    const originalMetricsToken = process.env.METRICS_TOKEN;
    beforeEach(() => {
      process.env.METRICS_TOKEN = '';
    });
    afterAll(() => {
      process.env.METRICS_TOKEN = originalMetricsToken;
    });

    it('gera um X-Request-Id quando o cliente não envia', async () => {
      const res = await request(app.getHttpServer()).get('/').expect(401);
      expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('reaproveita um X-Request-Id válido e descarta um inseguro', async () => {
      const kept = await request(app.getHttpServer())
        .get('/')
        .set('X-Request-Id', 'abc-123');
      expect(kept.headers['x-request-id']).toBe('abc-123');

      const replaced = await request(app.getHttpServer())
        .get('/')
        .set('X-Request-Id', '<script>');
      expect(replaced.headers['x-request-id']).not.toBe('<script>');
    });

    it('GET /metrics expõe o histograma HTTP com o template da rota, não a URL real', async () => {
      await request(app.getHttpServer())
        .get('/appointments/0b7e2c3a-1f0e-4a3b-9c1d-2e3f4a5b6c7d')
        .expect(401);

      const res = await request(app.getHttpServer())
        .get('/metrics')
        .expect(200)
        .expect('Content-Type', /text\/plain/);

      expect(res.text).toContain(
        'http_request_duration_seconds_count{method="GET",route="/appointments/:id",status_code="401"} 1',
      );
      expect(res.text).not.toContain('0b7e2c3a-1f0e-4a3b-9c1d-2e3f4a5b6c7d');
    });

    it('conta logins com falha', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'x@y.com', password: 'qualquer' })
        .expect(401);

      const res = await request(app.getHttpServer()).get('/metrics');
      expect(res.text).toContain(
        'auth_login_attempts_total{result="failure"} 1',
      );
    });

    it('com METRICS_TOKEN definido, /metrics exige o Bearer token', async () => {
      process.env.METRICS_TOKEN = 'segredo-de-teste';

      await request(app.getHttpServer()).get('/metrics').expect(401);
      await request(app.getHttpServer())
        .get('/metrics')
        .set('Authorization', 'Bearer errado')
        .expect(401);
      await request(app.getHttpServer())
        .get('/metrics')
        .set('Authorization', 'Bearer segredo-de-teste')
        .expect(200);
    });

    it('em produção, sem METRICS_TOKEN, a aplicação não sobe', async () => {
      const originalNodeEnv = process.env.NODE_ENV;
      const originalLogLevel = process.env.LOG_LEVEL;
      process.env.NODE_ENV = 'production';
      process.env.LOG_LEVEL = 'silent';

      try {
        const moduleFixture = await Test.createTestingModule({
          imports: [AppModule],
        })
          .overrideProvider(PrismaService)
          .useValue(prismaMock)
          .overrideProvider(RedisThrottlerStorage)
          .useValue(throttlerStorageMock)
          .compile();
        const prodApp = moduleFixture.createNestApplication();

        await expect(prodApp.init()).rejects.toThrow(
          'METRICS_TOKEN é obrigatório em produção',
        );
        await prodApp.close();
      } finally {
        process.env.NODE_ENV = originalNodeEnv;
        process.env.LOG_LEVEL = originalLogLevel;
      }
    });
  });
});
