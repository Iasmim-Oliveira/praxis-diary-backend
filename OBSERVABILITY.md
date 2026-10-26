# Observabilidade

Este documento explica como a observabilidade da API funciona na prática: o que foi implementado, como subir o ambiente, como verificar cada parte e onde mexer para estender. O **porquê** de cada escolha está na [ADR 0007](docs/decisions/0007-observabilidade.md).

A API cobre os três requisitos do TCC:

| Requisito | O que entrega | Onde ver |
|---|---|---|
| **RNF08** — logs estruturados | Um log JSON por requisição, mais logs de eventos de negócio, todos correlacionados por `X-Request-Id` | stdout da API |
| **RNF09** — métricas Prometheus | Endpoint `GET /metrics` com latência, volume, erros, métricas de negócio e saúde do processo | http://localhost:9090 |
| **RNF10** — dashboards Grafana | Dashboard "Praxis Diary — API", provisionado automaticamente | http://localhost:3001 |

## Como subir

```bash
docker compose up -d     # Postgres, Redis, Prometheus e Grafana
npm run start:dev        # a API, no host, na porta 3000
```

- **Grafana:** http://localhost:3001 (usuário `admin`, senha `admin`, ou os valores de `GRAFANA_ADMIN_*` no `.env`). O dashboard fica em **Dashboards → Praxis Diary → Praxis Diary — API**.
- **Prometheus:** http://localhost:9090. Em **Status → Targets**, o alvo `praxis-diary-api` deve aparecer como `UP`.

O Prometheus só enxerga a API se ela estiver rodando na porta configurada em `observability/prometheus/prometheus.yml` (3000 por padrão).

---

## 1. Logs estruturados (RNF08)

### O que é logado

**Toda requisição**, ao terminar, gera uma linha com método, URL, status, tempo de resposta (`responseTime`, em ms), `req.id` e, se autenticada, `userId`. O nível segue o status:

| Status | Nível |
|---|---|
| 2xx / 3xx | `info` (30) |
| 4xx | `warn` (40) |
| 5xx ou exceção | `error` (50) |

**Eventos de negócio**, registrados nos services:

| Evento (`msg`) | Nível | Campos | Onde |
|---|---|---|---|
| `user registered` | info | `userId`, `role` | `AuthService` |
| `login succeeded` | info | `userId` | `AuthService` |
| `login failed` | warn | `reason` (`unknown_email` / `invalid_password`), `userId` quando existe | `AuthService` |
| `appointment created` | info | `appointmentId`, `serviceId`, `clientId`, `startsAt` | `AppointmentsService` |
| `appointment updated` | info | `appointmentId`, `rescheduled`, `startsAt` | `AppointmentsService` |
| `appointment cancelled` | info | `appointmentId` | `AppointmentsService` |
| `appointment conflict` | warn | `operation`, `detectedBy` (`precheck` / `constraint`), `startsAt`, `endsAt` | `AppointmentsService` |
| `appointment cancellation rejected` | warn | `reason`, `appointmentId`, `minutesUntilStart` | `AppointmentsService` |

O motivo da falha de login aparece **só no log**. Para o cliente a resposta é sempre "Credenciais inválidas", para não revelar quais e-mails estão cadastrados.

### Correlação: `X-Request-Id`

- Cada requisição recebe um id. Ele aparece no `req.id` de **todas** as linhas dela (a da requisição e as de negócio) e volta no header `X-Request-Id` da resposta.
- Se a requisição já chegar com esse header, o id é reaproveitado, mas só se tiver até 64 caracteres e contiver apenas letras, números, `_` ou `-`. Caso contrário, gera-se um UUID novo.
- Na prática: quando um usuário relatar um erro, o `X-Request-Id` da resposta leva direto a todas as linhas de log daquela operação.

Os logs de negócio herdam o `req.id` sem nenhum código extra. O `nestjs-pino` guarda a requisição atual em `AsyncLocalStorage`, e o `Logger` do Nest usado nos services é roteado para o pino.

### Dados sensíveis (RNF03)

- `Authorization` (access token) e `Cookie` aparecem como `[REDACTED]`.
- O **corpo da requisição não é logado**, então senha, refresh token e dados de clientes nunca chegam ao log. Se um dia for preciso logar o body, os campos sensíveis **têm** que entrar na lista de `redact` antes.
- Logs de negócio usam **ids, nunca e-mail** (dado pessoal, LGPD).
- Do lado da resposta, só o `statusCode` é logado. Os headers são sempre os mesmos do helmet e só incham a linha.
- O scrape do Prometheus em `/metrics` (a cada 15s) **não** gera log, para não poluir.

### Formato por ambiente

| `NODE_ENV` | Formato | Nível padrão |
|---|---|---|
| `production` | JSON puro, uma linha por evento | `info` |
| `development` (ou ausente) | Colorido e legível (`pino-pretty`) | `debug` |
| `test` | Nada é impresso (`silent`) | — |

`LOG_LEVEL` sobrescreve o padrão (`fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent`). Vazio significa "usar o padrão do ambiente".

### Exemplo

Login com senha errada. As duas linhas compartilham o mesmo `req.id`; o trecho foi encurtado:

```
WARN: login failed {"req":{"id":"239e6a47-…","method":"POST","url":"/auth/login"},"context":"AuthService","reason":"invalid_password","userId":"523f5f0e-…"}
WARN: request completed {"req":{"id":"239e6a47-…","method":"POST","url":"/auth/login"},"res":{"statusCode":401},"responseTime":35}
```

---

## 2. Métricas (RNF09)

### O que é exposto em `GET /metrics`

**HTTP:**

| Métrica | Tipo | Labels | Para quê |
|---|---|---|---|
| `http_request_duration_seconds` | histograma | `method`, `route`, `status_code` | Volume (req/s), latência (p95) e taxa de erros |

Os buckets incluem `0.5` de propósito: é o limite do **RNF04** (< 500 ms). A fração de requisições dentro dele sai direto do histograma.

**Negócio:**

| Métrica | Labels | Significado |
|---|---|---|
| `auth_login_attempts_total` | `result` (`success` / `failure`) | Tentativas de login; um pico de `failure` pode indicar força bruta |
| `appointments_created_total` | — | Agendamentos criados |
| `appointments_updated_total` | `rescheduled` (`true` / `false`) | Edições; `true` quando mudou horário ou serviço |
| `appointments_cancelled_total` | — | Cancelamentos |
| `appointment_conflicts_total` | `operation` (`create` / `update`) | Operações bloqueadas pela RN01 (conflito de horário) |
| `appointment_cancellations_rejected_total` | — | Cancelamentos recusados pela RN04 (antecedência mínima) |

**Processo Node.js** (métricas padrão do `prom-client`): `process_cpu_*`, `process_resident_memory_bytes`, `nodejs_heap_*`, `nodejs_eventloop_lag_*`, `nodejs_gc_*` etc.

Contadores com labels só aparecem no `/metrics` depois do primeiro evento. Por exemplo, `appointment_conflicts_total` surge no primeiro conflito.

### Rótulo `route`: template, não URL

O label `route` usa o **template da rota** (`/appointments/:id`), nunca a URL real (`/appointments/0b7e2c3a-…`). Com o UUID no label, cada agendamento criaria uma série nova no Prometheus, a chamada *explosão de cardinalidade*, que degrada o Prometheus até ele parar. Requisições sem rota (404) caem todas em `route="unmatched"`.

### Medição em middleware

A latência é medida num middleware (`src/metrics/http-metrics.middleware.ts`), não num interceptor. Interceptors rodam **depois** dos guards, então respostas 401 (token inválido) e 429 (rate limit) ficariam de fora, e esses são sinais de segurança que queremos ver.

### Proteger o `/metrics`

- Sem `METRICS_TOKEN`, o endpoint fica aberto em dev.
- Em produção (`NODE_ENV=production`), a API **não sobe** sem `METRICS_TOKEN`: as métricas revelariam rotas, volume e saúde da API. O erro na inicialização é `METRICS_TOKEN é obrigatório em produção`.
- Com `METRICS_TOKEN` definido, ele exige `Authorization: Bearer <token>`.
- Para o Prometheus enviar o token:
  1. Gere um valor (`openssl rand -hex 32`) e coloque em `METRICS_TOKEN` no `.env` da API.
  2. Salve o mesmo valor num arquivo (por exemplo, `observability/prometheus/metrics_token`). **Não** versione esse arquivo.
  3. Monte o arquivo no container do Prometheus, em `docker-compose.yml`:

     ```yaml
     - ./observability/prometheus/metrics_token:/etc/prometheus/metrics_token:ro
     ```

  4. Descomente o bloco `authorization` em `observability/prometheus/prometheus.yml`.

---

## 3. Dashboard (RNF10)

O datasource e o dashboard são carregados por **provisioning**: o Grafana já sobe configurado, sem nenhum clique.

| Arquivo | Papel |
|---|---|
| `observability/grafana/provisioning/datasources/prometheus.yml` | Datasource Prometheus (uid fixo `prometheus`) |
| `observability/grafana/provisioning/dashboards/dashboards.yml` | Diz ao Grafana para carregar os JSONs da pasta de dashboards |
| `observability/grafana/dashboards/praxis-diary-api.json` | O dashboard em si |

### Painéis

| Seção | Painéis |
|---|---|
| **Visão geral** | Requisições/s · Latência p95 (verde < 250 ms, laranja < 500 ms, vermelho ≥ 500 ms) · Fração dentro do RNF04 · Taxa de erros 5xx |
| **HTTP** | Requisições/s por rota · Latência p95 por rota (com linha em 500 ms) · Respostas por status · Logins por resultado |
| **Negócio** | Agendamentos criados/editados/cancelados · Bloqueios por RN01 e RN04 |
| **Processo Node.js** | Memória (RSS e heap) · Event loop lag p99 |

### Editar o dashboard

Dá para editar pela interface. Mas a **fonte da verdade é o JSON versionado**: depois de editar, use **Share → Export → Save to file**, substitua `praxis-diary-api.json` e faça commit. Do contrário, a mudança fica só no volume local do Grafana.

---

## Como verificar

Com tudo rodando (`docker compose up -d` e `npm run start:dev`):

```bash
# 1. Logs: header X-Request-Id na resposta e log WARN com status 401
curl -i http://localhost:3000/

# 2. Id próprio reaproveitado; Authorization aparece como [REDACTED] no log
curl -i http://localhost:3000/ -H 'X-Request-Id: teste-123' -H 'Authorization: Bearer abc'

# 3. Com um access token válido (POST /auth/login), o log mostra userId
curl -i http://localhost:3000/ -H 'Authorization: Bearer <token>'

# 4. Métricas: o histograma usa o template da rota
curl -s http://localhost:3000/metrics | grep http_request_duration_seconds_count

# 5. Prometheus coletando: deve listar a API com health "up"
curl -s http://localhost:9090/api/v1/targets | grep -o '"health":"[a-z]*"'
```

Depois, abra o dashboard no Grafana e gere tráfego (login, criar e cancelar agendamentos). Os painéis atualizam a cada 10s.

Para ver os logs no formato de produção (JSON puro):

```bash
npm run build
NODE_ENV=production METRICS_TOKEN=token-local node dist/src/main
```

O `METRICS_TOKEN` é necessário porque, em produção, a API não sobe sem ele.

Os testes e2e (`npm run test:e2e`) cobrem o `X-Request-Id`, o label `route` com template, o contador de login, a proteção por `METRICS_TOKEN` e a recusa de subir em produção sem o token.

## Como estender

- **Nova regra de negócio:**
  1. Adicione um log com `this.logger.log/warn({ msg: '...', ...ids })` no service.
  2. Se fizer sentido acompanhar ao longo do tempo, crie um `Counter` em `src/metrics/metrics.service.ts` e incremente-o no mesmo ponto.
  3. Adicione o painel correspondente no dashboard.
- **Labels:** só valores de um conjunto pequeno e fixo (`result`, `operation`, `status_code`). Nunca ids, e-mails ou URLs.
- **Logs:** nunca e-mail, senha, token ou dado de cliente. Use ids.
