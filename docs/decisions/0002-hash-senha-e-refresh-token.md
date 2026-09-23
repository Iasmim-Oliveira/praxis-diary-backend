# ADR 0002: Algoritmo de Hash de Senha e Estratégia de Refresh Token

**Status:** Aceito
**Data:** 2026-09-03

## Contexto

Iniciando a fase de autenticação (JWT + refresh token) do Praxis Diary, duas decisões precisavam ser tomadas antes da implementação:

1. Qual algoritmo usar para armazenar senhas de forma segura (nunca em texto puro)
2. Como implementar o mecanismo de refresh token — stateless ou stateful

## Decisão 1: Hash de senha com `argon2id`

### Alternativas consideradas

| Algoritmo | Prós | Contras |
|---|---|---|
| `bcrypt` | Extremamente maduro, usado na maioria dos tutoriais/projetos NestJS | Não é o mais resistente contra ataques com hardware especializado (GPU/ASIC) em comparação com alternativas mais recentes |
| **`argon2id`** *(escolhida)* | Vencedor da Password Hashing Competition; recomendação atual da OWASP como primeira escolha para hash de senha; resistente tanto a ataques de força bruta por GPU quanto a ataques por custo de memória (memory-hard) | Biblioteca um pouco menos onipresente em tutoriais introdutórios que `bcrypt` |

### Justificativa

Como o tema central do TCC é segurança de API, adotar o algoritmo atualmente recomendado pela OWASP (em vez do mais "tradicional") reforça a aderência a boas práticas contemporâneas — e é um ponto concreto e defensável na banca.

## Decisão 2: Refresh token stateless (JWT assinado)

### Alternativas consideradas

| Estratégia | Prós | Contras |
|---|---|---|
| **Stateless (JWT assinado)** *(escolhida)* | Simples de implementar; sem tabela extra no banco; sem necessidade de consultar o banco para validar o refresh token | Não é possível revogar um token individual antes da expiração — nem no logout, nem em caso de vazamento. A única forma de "cortar" o acesso é esperar a expiração ou invalidar o segredo de assinatura (o que derruba *todos* os usuários de uma vez) |
| Stateful com rotação | Permite revogar sessões individualmente; permite detectar reuso de um token já usado (indício de roubo) | Exige uma tabela extra (`RefreshToken`) e lógica de rotação a cada uso; mais complexidade de implementação |

### Justificativa

Optou-se pela simplicidade de implementação dado o prazo do TCC, aceitando conscientemente o trade-off de segurança envolvido.

### Consequências e mitigações

Como o refresh token stateless não pode ser revogado individualmente, a mitigação de risco recai sobre **tempo de vida curto**:

- **Access token:** vida curta (ex: 15 minutos) — é o que efetivamente autoriza cada requisição
- **Refresh token:** vida mais longa, porém limitada (ex: 7 dias) — reduz a janela de exposição em caso de vazamento

Essa limitação (impossibilidade de revogação individual, logout que não invalida de fato o refresh token no servidor) deve ser explicitamente registrada como um **trade-off assumido** no TCC — é material legítimo para a seção de limitações/trabalhos futuros, junto com a evolução natural: migrar para refresh token stateful com rotação como melhoria futura.

## Referências

- [[0001-multi-tenancy-e-orm]] — decisões de fundação anteriores
