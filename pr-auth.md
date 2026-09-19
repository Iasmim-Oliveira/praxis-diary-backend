# feat: autenticação JWT com argon2id e refresh token

## Resumo

- Autenticação da API: registro, login e refresh de tokens
- Hash de senha com argon2id (recomendação atual da OWASP)
- Refresh token stateless (JWT assinado) — trade-offs documentados na ADR 0002
- Guard JWT global protegendo todas as rotas por padrão, com decorator `@Public()` para as exceções (register/login/refresh)
- `PrismaService`/`PrismaModule` integrando o Prisma ao ciclo de vida do NestJS (com driver adapter `pg`, obrigatório a partir do Prisma 7)

## Endpoints

- `POST /auth/register` — cria uma nova organização (Tenant) + usuário owner, em transação
- `POST /auth/login` — autentica por (tenantId, email, password)
- `POST /auth/refresh` — emite novo par de tokens a partir de um refresh token válido

Validação de entrada via `class-validator` (DTOs) + `ValidationPipe` global (whitelist, forbidNonWhitelisted, transform). A constraint `@@unique([tenantId, email])` garante unicidade de e-mail por tenant a nível de banco, não só na aplicação.

## Decisões documentadas

- [ADR 0002](docs/decisions/0002-hash-senha-e-refresh-token.md): algoritmo de hash (argon2id) e estratégia de refresh token (stateless), incluindo os trade-offs assumidos conscientemente

## Testado manualmente

- [x] Registro cria tenant + usuário
- [x] Login com senha errada → 401
- [x] Login com senha certa → tokens válidos
- [x] Rota protegida sem token → 401
- [x] Rota protegida com token inválido → 401
- [x] Rota protegida com token válido → 200
- [x] Refresh emite novo par de tokens
- [x] Mesmo e-mail em tenants diferentes → permitido
- [x] Constraint (tenantId, email) rejeitada no banco (via INSERT SQL direto)

## Limitações conhecidas (trabalho futuro)

- `/auth/register` sempre cria um tenant novo — ainda não há fluxo de convite para um tenant existente
- `/auth/login` exige `tenantId` explícito no body (produção normalmente resolveria isso via subdomínio)
- Refresh token stateless não pode ser revogado antes de expirar — mitigado por TTL curto (ver ADR 0002)
