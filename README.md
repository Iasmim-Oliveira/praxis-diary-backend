# Praxis Diary — Backend

API RESTful segura e observável para uma plataforma SaaS de agendamento e gestão de clientes.

Este repositório é o backend desenvolvido como parte do Trabalho de Conclusão de Curso **"API Segura com Observabilidade e Boas Práticas de Mercado - Praxis Diary"**, com foco em autenticação/autorização, isolamento de dados entre organizações (multi-tenancy) e observabilidade (logs estruturados, métricas e dashboards).

## Stack

- **Node.js** + **TypeScript**
- **NestJS** — framework da API
- **PostgreSQL** — banco de dados
- **Prisma** — ORM / migrations
- **Docker Compose** — ambiente de banco local
- Prometheus + Grafana — observabilidade _(planejado)_
- Swagger/OpenAPI — documentação da API _(planejado)_

## Status do projeto

- [x] Fundação do projeto (NestJS, Git, Docker Compose)
- [x] Modelagem inicial de dados
- [ ] Autenticação (JWT + refresh token)
- [ ] Autorização (RBAC)
- [ ] Regras de negócio core (agendamento, clientes, disponibilidade)
- [ ] Segurança de API (rate limiting, helmet, validação de input, CORS)
- [ ] Observabilidade (logs estruturados, métricas Prometheus)
- [ ] Dashboards (Grafana)
- [ ] Documentação (OpenAPI/Swagger)
- [ ] Testes (unit, integração, e2e)

As decisões arquiteturais tomadas ao longo do projeto — e o porquê de cada uma — estão documentadas em [`docs/decisions/`](docs/decisions/).

## Pré-requisitos

- Node.js 22+
- npm
- Docker (usado aqui via [OrbStack](https://orbstack.dev/), mas Docker Desktop também funciona)

## Como rodar localmente

1. Clone o repositório e instale as dependências:

   ```bash
   npm install
   ```

2. Copie o arquivo de variáveis de ambiente de exemplo:

   ```bash
   cp .env.example .env
   ```

   Por padrão, o Postgres do projeto sobe na porta `5433` (não `5432`), para não conflitar com outras instâncias de Postgres que você já tenha rodando localmente. Ajuste o `.env` se precisar.

3. Suba o banco de dados:

   ```bash
   docker compose up -d
   ```

4. Aplique as migrations do Prisma (cria as tabelas no banco):

   ```bash
   npx prisma migrate dev
   ```

5. Rode a API em modo desenvolvimento (watch mode):

   ```bash
   npm run start:dev
   ```

## Scripts disponíveis

```bash
npm run start        # inicia a API
npm run start:dev    # inicia em modo watch (recarrega a cada mudança)
npm run start:prod   # inicia a build de produção (requer `npm run build` antes)
npm run build        # compila o TypeScript

npm run lint          # lint com auto-fix
npm run format        # formata o código com Prettier

npm run test          # testes unitários
npm run test:e2e      # testes end-to-end
npm run test:cov      # testes com relatório de cobertura
```

Comandos úteis do Prisma:

```bash
npx prisma studio       # interface visual para inspecionar os dados
npx prisma migrate dev  # cria e aplica uma nova migration a partir de mudanças no schema
npx prisma format       # formata prisma/schema.prisma
npx prisma validate     # valida o schema sem acessar o banco
```

## Estrutura do projeto

```
src/                  # código-fonte da aplicação (módulos NestJS)
prisma/
  schema.prisma        # modelo de dados
  migrations/           # histórico de migrations do banco
docs/
  decisions/            # ADRs — decisões arquiteturais e o porquê de cada uma
docker-compose.yml      # ambiente local do Postgres
```
