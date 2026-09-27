# ADR 0005: Modelagem do domínio de agendamento e regras de negócio

**Status:** Proposto
**Data:** 2026-09-27

## Contexto

Com autenticação (ADR 0002) e autorização (ADR 0004) prontas, o próximo passo do roadmap é o núcleo de negócio do TCC: RF02 (CRUD de serviços), RF03 (CRUD de clientes), RF04 (criação/edição/cancelamento de agendamentos), RF05 (consulta de disponibilidade) e RF07 (visualização de agenda por período), junto com as regras RN01 (sem conflito de horário), RN03\* (serviço tem duração definida) e RN04 (restrição de tempo para cancelamento).

\* O TCC numerou duas regras diferentes como "RN03" — a de permissões (já coberta pela ADR 0004) e a de duração de serviço. Tratadas aqui como regras distintas.

Como não existe mais tenant (ADR 0003), o sistema representa **um negócio só**: uma agenda, um catálogo de serviços, uma base de clientes — não múltiplas organizações isoladas.

## Decisão 1: Entidades

```prisma
model Service {
  id              String   @id @default(uuid())
  name            String
  description     String?
  durationMinutes Int
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  appointments    Appointment[]
}

model Client {
  id           String   @id @default(uuid())
  name         String
  email        String?
  phone        String?
  notes        String?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  appointments Appointment[]
}

enum AppointmentStatus {
  SCHEDULED
  CANCELLED
}

model Appointment {
  id          String            @id @default(uuid())
  clientId    String
  client      Client            @relation(fields: [clientId], references: [id])
  serviceId   String
  service     Service           @relation(fields: [serviceId], references: [id])
  createdById String
  createdBy   User              @relation(fields: [createdById], references: [id])
  startsAt    DateTime
  endsAt      DateTime
  status      AppointmentStatus @default(SCHEDULED)
  cancelledAt DateTime?
  createdAt   DateTime          @default(now())
  updatedAt   DateTime          @updatedAt

  @@index([startsAt, endsAt])
}
```

**Por que `endsAt` é uma coluna, e não calculado a partir de `service.durationMinutes` em toda leitura:** se a duração do serviço mudar depois, agendamentos passados não podem mudar retroativamente — `endsAt` fica congelado no momento da criação. Também é o que permite o mecanismo de conflito da Decisão 3 funcionar com uma constraint simples de intervalo.

**`createdById`:** não é "dono" do agendamento (não existe mais tenant), é só rastreabilidade — quem criou o registro. Consistente com o pilar de observabilidade do TCC (logs estruturados vão usar o mesmo tipo de referência).

## Decisão 2: Controle de acesso por entidade

- **`Service`** — CRUD restrito a `ADMIN` (RN03: "apenas administradores podem gerenciar usuários e serviços"). Mesmo padrão do `UsersController`: `@Roles(Role.ADMIN)` no controller inteiro.
- **`Client`** e **`Appointment`** — CRUD liberado para qualquer usuário autenticado (`ADMIN` ou `USER`), sem `@Roles()`. O TCC descreve o "Usuário" como quem opera a agenda no dia a dia; nada na RN03 restringe clientes/agendamentos a admin.

## Decisão 3: Prevenção de conflito de horário (RN01) — agenda única, global

Confirmado: existe uma única agenda no sistema. Dois agendamentos `SCHEDULED` nunca podem se sobrepor no tempo, independente do serviço.

### Mecanismo

Repetir aqui o padrão de "checagem no código + checagem no banco" que já usamos para e-mail único (ADR 0001) e para o bootstrap de admin (ADR 0004): a aplicação valida e dá uma mensagem amigável, mas quem garante de verdade é uma constraint atômica no Postgres — dessa vez uma **exclusion constraint** sobre um intervalo de tempo, o mecanismo nativo do Postgres para "estes dois intervalos não podem se sobrepor":

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "Appointment"
  ADD CONSTRAINT appointment_no_overlap
  EXCLUDE USING gist (
    tsrange("startsAt", "endsAt") WITH &&
  )
  WHERE (status = 'SCHEDULED');
```

- `WITH &&` = "conflita se os dois intervalos se sobrepõem".
- A cláusula `WHERE (status = 'SCHEDULED')` é o que permite cancelar um agendamento sem que ele continue "ocupando" o horário para sempre — uma constraint sem essa cláusula bloquearia reagendar em cima de algo já cancelado.
- Como o Prisma não tem uma forma declarativa de expressar exclusion constraints no `schema.prisma`, essa parte vai como SQL manual dentro da migration gerada (mesma técnica já usada nos advisory locks da ADR 0004).

Isso substitui a necessidade de um advisory lock aqui: diferente do bootstrap de admin (onde a invariante — "existe pelo menos um ADMIN" — não tem uma constraint de banco natural), aqui a invariante É literalmente o que uma exclusion constraint resolve, de forma atômica, sem lock nenhum escrito à mão. A aplicação ainda faz uma checagem prévia (para responder com uma mensagem clara em vez de estourar um erro de banco cru), mas a garantia real é a constraint.

## Decisão 4: Duração do serviço (RN03)

`Service.durationMinutes` é obrigatório (`Int`, sem default) — reforçado por validação no DTO (`@IsInt() @Min(1)`). É o valor usado para calcular `endsAt = startsAt + durationMinutes` na criação do agendamento.

## Decisão 5: Restrição de cancelamento (RN04)

Cancelamento de agendamento é uma operação própria (`POST /appointments/:id/cancel`), não um `PATCH` genérico — tem uma regra e um efeito colateral específicos (`status = CANCELLED`, `cancelledAt = now()`), e merece ficar explícito na API em vez de escondido dentro de um update de campos livres.

Regra: um agendamento não pode ser cancelado se faltar menos de **60 minutos** para `startsAt` (valor do exemplo do próprio TCC). Fica como constante no código (`MIN_CANCELLATION_NOTICE_MINUTES`), não configurável por enquanto — configurável por negócio é extensão natural futura, fora do escopo atual.

## Decisão 6: Consulta de disponibilidade (RF05)

Endpoint novo: `GET /appointments/availability?serviceId=&date=`. Retorna os horários livres do dia para aquele serviço, considerando sua duração e os agendamentos `SCHEDULED` já existentes.

**Simplificação assumida:** horário de funcionamento fixo no código (ex: 08:00–18:00, todos os dias), não uma configuração por negócio/dia da semana. Igual às outras simplificações já registradas neste projeto (login sem subdomínio, refresh stateless), é uma escolha consciente de escopo — um "horário de funcionamento configurável" fica registrado como extensão futura natural.

## Decisão 7: Visualização de agenda por período (RF07)

Não exige mecanismo novo: `GET /appointments?from=&to=` — filtro de listagem por intervalo de datas sobre a mesma tabela, usando o índice de `[startsAt, endsAt]` já definido na Decisão 1.

## Consequências

- Três novos módulos NestJS (`Service`, `Client`, `Appointment`), seguindo a mesma estrutura já estabelecida (`Module`/`Controller`/`Service`/DTOs com `class-validator`).
- A migration desta feature precisa de edição manual (extensão `btree_gist` + exclusion constraint), assim como a de RBAC precisou do `UPDATE` de bootstrap — não é gerada automaticamente pelo `prisma migrate dev`, precisa ser adicionada ao arquivo gerado antes de aplicar.
- Cancelamento é lógico (`status = CANCELLED`), nunca `DELETE` físico — preserva histórico, o que também alimenta observabilidade (poder responder "quantos agendamentos foram cancelados e quando" é o tipo de métrica que a fase de Prometheus/Grafana vai expor).

## Referências

- [ADR 0001](0001-multi-tenancy-e-orm.md), [ADR 0003](0003-remocao-do-multi-tenancy.md) — por que existe uma agenda só, não uma por organização
- [ADR 0004](0004-rbac.md) — padrão de controle de acesso por `@Roles()` reaplicado aqui
