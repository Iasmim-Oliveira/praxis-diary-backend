# ADR 0007: Observabilidade — logs estruturados, métricas e dashboards

**Status:** Aceito
**Data:** 2026-10-21

## Contexto

O título do TCC coloca observabilidade no mesmo patamar da segurança, e três requisitos não funcionais tratam dela diretamente:

- **RNF08** — logs estruturados, para rastreabilidade e análise de falhas;
- **RNF09** — métricas operacionais compatíveis com Prometheus;
- **RNF10** — visualização das métricas no Grafana.

A metodologia do TCC também depende disso: o aspecto quantitativo da pesquisa é "a coleta e análise de métricas de desempenho, como tempo de resposta, volume de requisições e taxa de erros". E o RNF04 (resposta abaixo de 500 ms) só pode ser demonstrado se a latência for medida.

Até aqui a API não tinha nenhum desses sinais: nenhum log além do padrão do Nest, nenhuma métrica, nada além de Postgres e Redis no `docker-compose.yml`.

## Decisão 1: Logs estruturados com pino (`nestjs-pino`)

O pino gera JSON nativamente, é um dos loggers mais rápidos do ecossistema Node e tem integração madura com o Nest (`nestjs-pino`, que usa o `pino-http` como middleware). Alternativas consideradas:

- **Logger padrão do Nest:** texto livre, sem esquema — não atende o RNF08.
- **winston:** também estruturado, mas mais lento e com integração menos direta para log por requisição e contexto de requisição.

Configuração adotada (`src/app.module.ts`):

- **Um log por requisição**, com nível pelo status: 2xx/3xx `info`, 4xx `warn`, 5xx `error`.
- **Correlação por `X-Request-Id`:** cada requisição recebe um id, presente em todas as linhas de log dela e devolvido no header. Um id vindo de proxy/cliente é reaproveitado só se for curto e simples (`^[\w-]{1,64}$`); caso contrário, gera-se um UUID — o cliente não injeta conteúdo arbitrário nos logs.
- **`userId`** (o `sub` do JWT) no log da requisição autenticada.
- **Dados sensíveis (RNF03):** `Authorization` e `Cookie` são redigidos; o corpo da requisição não é logado (padrão do `pino-http`), então senha e refresh token nunca chegam ao log. Logs de negócio não incluem e-mail (dado pessoal, LGPD) — só ids.
- **Formato por ambiente:** JSON puro em produção, `pino-pretty` em desenvolvimento, `silent` em teste. `LOG_LEVEL` sobrescreve o nível.

**Logs de negócio** usam o `Logger` padrão do Nest nos services. Como o pino é registrado como logger da aplicação (`app.useLogger`) e o `nestjs-pino` guarda a requisição em `AsyncLocalStorage`, essas linhas herdam automaticamente o `req.id` da requisição em andamento — sem passar contexto à mão. Eventos registrados: cadastro, login (sucesso/falha, com o motivo só no log), agendamento criado/editado/cancelado, conflito de horário (RN01) e cancelamento recusado (RN04).

## Decisão 2: Métricas com `prom-client` e endpoint `/metrics`

`prom-client` é a biblioteca de referência do Prometheus para Node. Foi usada diretamente, sem um wrapper para Nest: são poucas linhas e o mecanismo fica explícito.

- **Registry próprio** (não o global do `prom-client`), para cada instância do `AppModule` ter o seu — os testes e2e criam uma por teste.
- **Métricas padrão do processo:** CPU, memória, heap, event loop lag, GC.
- **`http_request_duration_seconds`** (histograma, labels `method`, `route`, `status_code`). Dele saem volume, latência (p95) e taxa de erros. Os buckets incluem `0.5` de propósito, para ler direto a fração de requisições dentro do RNF04.
- **Métricas de negócio:** `auth_login_attempts_total{result}`, `appointments_created_total`, `appointments_updated_total{rescheduled}`, `appointments_cancelled_total`, `appointment_conflicts_total{operation}`, `appointment_cancellations_rejected_total`.

Dois cuidados de projeto:

- **Label `route` é o template da rota** (`/appointments/:id`), nunca a URL real. Com o UUID no label, cada agendamento criaria uma série nova no Prometheus (explosão de cardinalidade). Requisições sem rota (404) caem em `route="unmatched"`.
- **Medição em middleware, não em interceptor:** interceptors rodam depois dos guards, então respostas 401 (JWT) e 429 (rate limit) nunca passariam por eles — e são justamente sinais de segurança que queremos ver.

## Decisão 3: Acesso ao `/metrics`

O Prometheus não tem JWT de usuário, então a rota é `@Public()` e `@SkipThrottle()` (o scrape é periódico e não pode ser bloqueado). Mas métricas expostas revelam rotas, volume e saúde da API, então:

- Com `METRICS_TOKEN` definido, a rota exige `Authorization: Bearer <token>` — suportado nativamente pelo Prometheus (`authorization.credentials_file`). A comparação é feita sobre hashes com `timingSafeEqual`, para o tempo de resposta não vazar o token.
- Sem a variável, fica aberta — mesmo padrão do CORS (ADR 0006): aceitável em dev, **nunca** em produção.

Em produção, o ideal é somar a isso a rede: `/metrics` acessível só pela rede interna, não pela internet.

## Decisão 4: Prometheus e Grafana no `docker-compose.yml`, com provisioning

- **Prometheus** (`prom/prometheus:v3.5.0`) coleta `host.docker.internal:3000/metrics` a cada 15s, já que a API roda no host durante o desenvolvimento. `extra_hosts: host-gateway` faz o nome resolver também em Linux.
- **Grafana** (`grafana/grafana:12.1.0`) na porta 3001 (a 3000 é da API).
- **Datasource e dashboard versionados** em `observability/grafana/` e carregados por provisioning. Qualquer pessoa que rode `docker compose up -d` vê o mesmo dashboard, sem configuração manual — o que também torna a evidência para o TCC reproduzível.

O dashboard "Praxis Diary — API" tem quatro seções: visão geral (req/s, p95, fração dentro do RNF04, taxa de 5xx), HTTP (por rota e por status, logins), negócio (agendamentos, RN01, RN04) e processo Node (memória, event loop lag).

## Fora do escopo (extensões futuras)

- **Traces distribuídos (OpenTelemetry):** citados na fundamentação do TCC, mas não exigidos pelos RNFs. Com uma API única, o `X-Request-Id` já cobre a correlação; traces passam a valer a pena com múltiplos serviços.
- **Agregação de logs (Loki/ELK):** os logs saem em JSON no stdout, prontos para serem coletados, mas nenhum coletor foi configurado.
- **Alertas:** o Prometheus e o Grafana suportam regras de alerta (ex.: p95 acima de 500 ms); não foram configuradas.
- **Health check (`/health`):** útil para orquestradores; não exigido pelos RNFs.

## Consequências

- Novas dependências: `nestjs-pino`, `pino-http`, `pino-pretty` (dev) e `prom-client`.
- Novo módulo global `MetricsModule` (`src/metrics/`); `AuthService` e `AppointmentsService` passam a receber `MetricsService`.
- Novas variáveis de ambiente: `LOG_LEVEL`, `METRICS_TOKEN`, `PROMETHEUS_PORT`, `GRAFANA_PORT`, `GRAFANA_ADMIN_USER`, `GRAFANA_ADMIN_PASSWORD`.
- Toda nova regra de negócio relevante deve ganhar um log de negócio e, se fizer sentido medir ao longo do tempo, um contador — e o painel correspondente no dashboard versionado.

## Referências

- [ADR 0005](0005-dominio-de-agendamento.md) — regras RN01 e RN04, medidas pelas métricas de negócio
- [ADR 0006](0006-seguranca-de-api.md) — padrão "aberto em dev, nunca em produção" do CORS, reaplicado ao `/metrics`
- [`OBSERVABILITY.md`](../../OBSERVABILITY.md) — guia prático: como subir, verificar e usar
