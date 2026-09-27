# ADR 0001: Estratégia de Multi-tenancy e Escolha de ORM

**Status:** Aceito
**Data:** 2026-08-08

## Contexto

O Praxis Diary é uma plataforma SaaS multi-tenant de agendamento e gestão de clientes, desenvolvida como TCC com foco em **API segura** e **observabilidade**. Duas decisões de fundação precisavam ser tomadas antes de iniciar a implementação:

1. Como isolar os dados entre diferentes organizações (tenants) no banco de dados
2. Qual ferramenta de acesso a dados (ORM) usar para o PostgreSQL

Essas decisões impactam diretamente a complexidade de implementação, a facilidade de demonstrar observabilidade (foco do trabalho) e o prazo disponível para o TCC.

## Decisão 1: Isolamento multi-tenant via schema compartilhado + `tenant_id`

### Alternativas consideradas

| Estratégia | Descrição | Prós | Contras |
|---|---|---|---|
| **Database-per-tenant** | Um banco de dados PostgreSQL inteiro por organização | Isolamento máximo | Provisionamento de banco a cada novo tenant; migrations precisam rodar em N bancos; monitoramento (Prometheus) precisa agregar métricas de múltiplos bancos — inviável no prazo de um TCC |
| **Schema-per-tenant** | Um schema Postgres separado por organização (ex: `tenant_abc.clientes`) | Bom isolamento, único servidor de banco | Migrations ainda precisam rodar por schema; complexidade cresce com o número de tenants; pouco ganho didático em relação ao tema do trabalho |
| **Schema compartilhado + `tenant_id`** *(escolhida)* | Uma única tabela por entidade, com coluna `tenant_id` identificando o dono de cada linha | Um único schema, migrations simples, superfície de observação enxuta, é a abordagem mais usada em SaaS reais (Slack, Notion no início) | Exige disciplina: toda query precisa filtrar por `tenant_id` |

### Decisão

Adotar **schema único compartilhado**, com toda tabela multi-tenant contendo uma coluna `tenant_id`, aplicada de forma consistente em todas as queries via um mecanismo central (interceptor/middleware no NestJS), evitando repetição manual de `WHERE tenant_id = ...` espalhada pelo código.

Como camada adicional de segurança, será avaliado o uso de **Row Level Security (RLS)** do PostgreSQL: o próprio banco passa a impedir fisicamente que uma query vaze dados de outro tenant, mesmo que a aplicação tenha uma falha e esqueça o filtro. Isso funciona como uma segunda linha de defesa (defesa em profundidade) e é um diferencial relevante para o capítulo de segurança do TCC.

### Justificativa

- **Prazo de TCC:** é a estratégia mais simples de implementar e operar corretamente no tempo disponível.
- **Observabilidade (foco do trabalho):** um único banco/schema significa uma superfície de métricas mais simples e coerente para expor no Prometheus/Grafana, sem precisar agregar dados de múltiplas instâncias.
- **Relevância de mercado:** é a abordagem adotada pela maioria dos SaaS reais em fase inicial/crescimento, o que reforça a aderência do trabalho a práticas contemporâneas de engenharia (um dos objetivos declarados no resumo do TCC).
- **RLS como bônus:** permite discutir defesa em profundidade na banca, sem exigir a complexidade operacional de bancos/schemas separados.

### Consequências

- Todo endpoint que manipula dados de tenant precisa garantir a filtragem por `tenant_id` — será centralizado (ex: guard/interceptor que injeta o tenant do JWT no contexto de cada query).
- Testes de isolamento entre tenants (garantir que o tenant A nunca acesse dados do tenant B) tornam-se um caso de teste crítico e um bom experimento a reportar nos resultados do TCC.
- Caso o RLS seja adotado, é necessário configurar roles de banco e políticas (`CREATE POLICY`) alinhadas ao `tenant_id` da sessão.

## Decisão 2: Prisma como ORM

### Alternativas consideradas

| Ferramenta | Prós | Contras |
|---|---|---|
| **TypeORM** | Integração "nativa" com NestJS, padrão mais próximo de Java/Spring (decorators em entidades) | Migrations menos previsíveis historicamente, API mais verbosa para quem está começando |
| **Prisma** *(escolhida)* | Schema declarativo único (`.prisma`), fácil de ler/apresentar; migrations automáticas e versionadas; type-safety completo com TypeScript; Prisma Studio para inspecionar dados sem escrever SQL | Menos "flexível" que SQL cru para queries muito complexas (contornável com `$queryRaw` quando necessário) |

### Decisão

Adotar **Prisma** como ORM/camada de acesso a dados.

### Justificativa

- **Curva de aprendizado:** como o desenvolvedor está iniciando em backend, o schema declarativo do Prisma e o autocomplete type-safe reduzem erros comuns e aceleram o aprendizado.
- **Migrations confiáveis e versionadas:** essencial para demonstrar evolução do modelo de dados ao longo do TCC.
- **Didática para a banca:** o arquivo `schema.prisma` funciona como documentação viva do modelo de dados, útil para apresentação.
- **Prisma Studio:** facilita inspecionar visualmente o isolamento entre tenants durante o desenvolvimento e testes.

### Consequências

- Regras de RLS (se adotadas) precisam ser configuradas fora do Prisma (via migration SQL manual), já que o Prisma não gerencia políticas de RLS nativamente.
- Queries muito específicas de performance/observabilidade (ex: métricas agregadas para o Grafana) podem exigir `$queryRaw` pontualmente.

## Referências
