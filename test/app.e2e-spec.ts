import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  // Mock do Prisma: o e2e testa o guard global e as rotas públicas, não o
  // banco (o fluxo com Postgres real é validado à parte).
  const prismaMock = {
    user: { findUnique: jest.fn(), create: jest.fn() },
    $connect: jest.fn(),
    $disconnect: jest.fn(),
  };

  beforeEach(async () => {
    prismaMock.user.findUnique.mockReset();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
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
});
