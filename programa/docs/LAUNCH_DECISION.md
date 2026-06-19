# IntelliQuote Launch Decision

Data: 2026-03-25

## Decisao

O alvo da primeira entrega do IntelliQuote sera:

- `piloto interno / single-tenant`

Nao sera:

- `SaaS multi-tenant` na primeira entrega
- `produto comercial com cobranca recorrente` na primeira entrega

## Justificativa

- o produto atual ainda nao possui isolamento por empresa
- a autenticacao real estava ausente e precisou entrar antes da abertura do produto
- o modelo de dados ainda esta em transicao de MVP academico para produto operacional
- validar primeiro com um ambiente controlado reduz risco tecnico e acelera aprendizagem real de uso

## Politica Inicial de Auth

- login por `email + password`
- `access token` curto por cookie `HttpOnly`
- `refresh token` por cookie `HttpOnly`
- expiracao inicial do access token: `15m`
- expiracao inicial do refresh token: `7d`
- logout com revogacao de sessao

## Perfis Iniciais

- `admin`
- `comprador`
- `gestor`
- `viewer`

## Primeiro Grupo de Usuarios

Primeira onda recomendada:

- equipa interna de compras/importacao
- 1 administrador funcional
- 1 a 3 utilizadores operacionais para validacao do fluxo principal

## Itens Explicitamente Adiados

- multi-tenant
- billing e paywall
- anexos
- audit log completo
- fluxo de aprovacao avancado
- migracao para `Next.js`
- migracao para `NestJS`

## Ambiente Alvo da Primeira Homologacao

- `staging` com base de dados dedicada

## Owner Inicial Sugerido

- `Lucas Felsky`, ate que exista definicao formal de produto/operacao
