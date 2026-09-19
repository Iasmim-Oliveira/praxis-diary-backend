// Variáveis exigidas por requireEnv() no bootstrap do AppModule.
// Valores fixos de teste: não dependem de .env (CI, outras máquinas) e nunca
// são segredos reais. O PrismaService é substituído por um mock nos testes,
// então o DATABASE_URL não precisa apontar para um banco existente.
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.JWT_ACCESS_SECRET = 'test-access-secret';
process.env.JWT_ACCESS_EXPIRES_IN = '15m';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
process.env.JWT_REFRESH_EXPIRES_IN = '7d';
