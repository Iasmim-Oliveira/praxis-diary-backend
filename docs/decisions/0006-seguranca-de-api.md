# ADR 0006: Segurança de API (rate limiting, Helmet, CORS, validação de input)

**Status:** Aceito
**Data:** 2026-09-28

## Contexto

Fase RNF03 do TCC: "adotar práticas de segurança para mitigação das principais vulnerabilidades listadas pelo OWASP". O README lista quatro frentes concretas: rate limiting, Helmet, validação de input e CORS.

## Estado atual antes desta ADR

**Validação de input já está, em grande parte, coberta** desde a fase de autenticação (ADR 0002): `ValidationPipe` global em `main.ts` (`whitelist`, `forbidNonWhitelisted`, `transform`) + DTOs com `class-validator` em todo endpoint que recebe corpo. Esta ADR reforça isso onde fizer sentido, mas o trabalho novo de fato é rate limiting, Helmet e CORS.

## Decisão 1: Rate limiting com `@nestjs/throttler`

OWASP API Security Top 10 (referenciado no TCC) lista autenticação quebrada — incluindo força bruta de credenciais — como uma das vulnerabilidades mais críticas em APIs. `/auth/login` e `/auth/register` são os alvos óbvios (o segundo também serve como proteção contra spam de cadastros).

### Limites adotados

| Rota | Limite | Janela |
|---|---|---|
| Global (default) | 100 requisições | 60s por IP |
| `POST /auth/login` | 5 requisições | 60s por IP |
| `POST /auth/register` | 5 requisições | 60s por IP |

`/auth/refresh` fica no limite global — exige posse de um refresh token válido, o que já eleva bastante o custo de um ataque de força bruta ali, diferente de login/register que só exigem um e-mail.

### Onde o guard entra na cadeia

`ThrottlerGuard` é registrado como o **primeiro** guard global (antes de `JwtAuthGuard` e `RolesGuard`, ver ADR 0004) — uma requisição que excedeu o limite deve ser rejeitada (`429`) antes de gastar qualquer trabalho validando token ou papel.

### Consequências

- Os limites são constantes no código, não configuráveis por ambiente por enquanto — mesma lógica de simplificação de escopo já usada em outras decisões deste projeto (ex: horário de funcionamento fixo na ADR 0005).
- Rate limiting por IP tem uma limitação conhecida: múltiplos usuários atrás do mesmo NAT/proxy compartilham o limite. Aceitável para o escopo do TCC; mitigação real (rate limit por usuário autenticado, quando aplicável) fica como extensão futura.

### Correção feita após revisão: storage compartilhado (Redis)

A implementação original usava o storage padrão do `@nestjs/throttler` (em memória, por processo). Revisão de código apontou que isso viola a **RNF06** do TCC ("arquitetura compatível com sistemas distribuídos... permitindo escalabilidade horizontal"): cada réplica da API manteria seus próprios contadores, então um cliente poderia exceder o limite documentado espalhando requisições entre réplicas, e um restart zeraria tudo.

Corrigido com uma implementação própria de `ThrottlerStorage` sobre Redis (`src/common/redis-throttler-storage.ts`), reproduzindo o algoritmo original (janela deslizante via `ZSET` + bloqueio via chave com TTL, atômico por um script Lua — `blockDuration` não é zero por padrão no `@nestjs/throttler`, então o caminho "com bloqueio" é o que está em uso de fato, não um caso raro a ignorar). Novo serviço `redis` no `docker-compose.yml`.

Para não repetir o problema já visto com o `PrismaService` (ADR original de segurança — adapter criado em cima da hora, antes do `ConfigModule` carregar o `.env`), o storage é injetado via um módulo próprio (`RedisThrottlerStorageModule`) e o `ThrottlerModule` é registrado com `forRootAsync`, não `forRoot`.

**Validado de verdade:** duas instâncias da API em portas diferentes, apontando para o mesmo Redis, alternando requisições entre as duas — o limite de 5/min é respeitado no **total** somado das duas, não 5 por instância (o que aconteceria com o storage em memória).

**Efeito colateral encontrado e corrigido:** o `AppModule` passou a depender de `REDIS_URL` via `requireEnv()`, o que quebrou a suíte e2e (que não tinha essa variável no `test/setup-env.ts` nem mockava o storage) — o teste só não falhou por acaso, porque o `ConfigModule` carrega o `.env` real do disco por baixo dos panos, e nesta máquina havia um Redis rodando. Sem `.env`/Redis, a suíte quebrava por completo. Corrigido mockando `RedisThrottlerStorage` no e2e, do mesmo jeito que o `PrismaService` já era mockado — confirmado rodando a suíte com `.env` removido **e** o container do Redis parado.

## Decisão 2: Helmet

`app.use(helmet())` com a configuração padrão do pacote — define um conjunto de cabeçalhos HTTP de segurança (`X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security`, remoção do `X-Powered-By`, entre outros) sem nenhuma configuração específica do domínio da aplicação. Não há decisão de trade-off aqui: é a prática padrão de mercado para qualquer API Express/NestJS, sem custo de desenvolvimento.

## Decisão 3: CORS

### Decisão

CORS habilitado com origem(ns) configurável(is) via variável de ambiente (`CORS_ALLOWED_ORIGINS`, lista separada por vírgula). Padrão de desenvolvimento: `*` (qualquer origem), documentado explicitamente como inadequado para produção.

### Justificativa

O frontend (Nuxt.js, conforme o TCC) ainda não existe neste repositório, então não há uma origem real para restringir agora. Uma variável de ambiente evita hardcodar qualquer domínio e permite trancar para a origem real do frontend no dia em que ele existir, sem mudança de código — só de configuração.

### Consequências

- **Ação pendente e explícita:** antes de qualquer deploy real (`tst`/`prod`), `CORS_ALLOWED_ORIGINS` precisa ser definida com a origem real do frontend. Ficar em `*` em produção anularia parte do propósito de CORS. Isso fica registrado aqui para não ser esquecido — o mesmo tipo de lembrete que a ADR 0003 registrou sobre migrations.

## Referências

- [ADR 0002](0002-hash-senha-e-refresh-token.md) — `ValidationPipe` global já existente
- [ADR 0004](0004-rbac.md) — ordem de guards globais, `ThrottlerGuard` se soma à mesma cadeia
