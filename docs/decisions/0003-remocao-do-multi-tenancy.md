# ADR 0003: Remoção do Multi-tenancy

**Status:** Aceito
**Data:** 2026-09-18
**Supera parcialmente:** [ADR 0001](0001-multi-tenancy-e-orm.md) (Decisão 1: estratégia de multi-tenancy). A Decisão 2 (Prisma como ORM) continua valendo.

## Contexto

A ADR 0001 adotou isolamento multi-tenant por schema compartilhado com `tenantId`, com RLS do PostgreSQL como camada extra de segurança. A fundação e a autenticação (ADR 0002) foram implementadas já com esse modelo: tabela `Tenant`, `tenantId` no `User` e no payload do JWT, unicidade de e-mail por tenant e login dependente do tenant.

Ao longo da implementação ficou claro que o multi-tenancy tem um custo de escopo alto e recorrente:

- Toda entidade nova precisa de `tenantId` e todo acesso precisa filtrar por ele (ou depender de RLS, que exige roles e políticas fora do Prisma).
- O fluxo de autenticação ganha problemas de produto que não existiam: como o usuário informa a organização no login (hoje via `tenantId` explícito, simplificação já registrada como limitação), como convidar usuários para um tenant existente, o que fazer ao remover um tenant.
- Aparece uma frente de testes própria (isolamento entre tenants).

O objetivo central do TCC é uma **API segura e observável** (autenticação, autorização, rate limiting, logs estruturados, métricas, dashboards). O multi-tenancy não é o foco e consome tempo que pertence a esses pilares.

## Decisão

Remover o multi-tenancy do projeto. A aplicação passa a ter um único espaço de dados, sem entidade `Tenant`.

Mudanças decorrentes:

- **Schema:** remoção do model `Tenant`; `User` perde `tenantId`, a relação com `Tenant` e os índices associados; `email` passa a ser `@unique` globalmente.
- **Banco:** a migration `init` foi recriada do zero, sem migration de remoção. O projeto não está em produção e não há dados a preservar, então o histórico não carrega uma tabela que nunca existiu na versão final.
- **Autenticação:** o registro cria apenas o usuário (sem transação); o login usa `email` e `password`; o payload do JWT deixa de conter `tenantId`.
- **Autorização:** o RBAC (fase 4) passa a ser o principal mecanismo de controle de acesso.

## Alternativas consideradas

| Alternativa | Por que não |
|---|---|
| Manter o multi-tenancy e adiar as partes complexas (RLS, convites, resolução por subdomínio) | Deixa um modelo de dados pela metade: o custo de `tenantId` em toda entidade permanece e o benefício de segurança não é entregue |
| Manter apenas o `tenantId` no schema, sem usá-lo | Complexidade sem função; qualquer leitor do código esperaria isolamento que não existe |

## Consequências

- **Simplificação:** autenticação, schema e testes ficam mais simples; o tempo liberado vai para observabilidade e segurança de API.
- **Unicidade de e-mail global:** a constraint no banco continua sendo a proteção contra race condition no cadastro, agora sobre uma única coluna. O `ConflictException` (409) passa a ser o caminho normal de e-mail duplicado.
- **Escopo do TCC:** o resumo menciona "isolamento lógico de dados entre organizações" e "multi-tenant". Esse texto precisa ser alinhado com a nova decisão (a alinhar com o orientador).
- **Limitações anteriores resolvidas:** deixam de existir a limitação do `/auth/register` sempre criar um tenant novo e a do `tenantId` obrigatório no login.
- **Reversibilidade:** reintroduzir multi-tenancy no futuro é possível (a ADR 0001 documenta a estratégia), mas exigiria migration de dados e revisão de auth. Fica como trabalho futuro, não como requisito do TCC.

## Referências

- [ADR 0001](0001-multi-tenancy-e-orm.md) — estratégia de multi-tenancy e escolha do ORM
- [ADR 0002](0002-hash-senha-e-refresh-token.md) — hash de senha e refresh token
