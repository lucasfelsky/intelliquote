# IntelliQuote Sprint 01 Plan

Baseado no backlog de lancamento e no estado atual do projeto.

Data: 2026-03-25

## Assuncao de Trabalho

Este plano assume o caminho recomendado para a primeira entrega:

- `piloto interno` ou `single-tenant`
- sem `multi-tenant` na Sprint 01
- sem cobranca na Sprint 01
- foco em decidir o modelo de lancamento e substituir o login fake por autenticacao real

Se a decisao mudar para `SaaS multi-tenant`, este plano precisa ser refeito antes da implementacao do schema de auth.

## Objetivo da Sprint

Fechar `P0-01` e implementar a base tecnica de `P0-02`, deixando o sistema com:

- decisao formal de lancamento
- usuarios e perfis basicos
- login real
- sessao segura
- frontend autenticando na API
- base pronta para `P0-03` de permissoes

## Entregavel do Fim da Sprint

Ao final da Sprint 01, o time deve conseguir:

1. explicar em uma pagina qual e o modelo de lancamento escolhido
2. criar e autenticar um usuario real
3. entrar no frontend sem credencial hardcoded
4. consultar o usuario logado
5. derrubar sessao por logout
6. preparar o sistema para proteger rotas na sprint seguinte

## Fora de Escopo

- billing
- multi-tenant
- audit log completo
- anexos
- dashboard avancado
- historico completo de comparacao
- fluxo de aprovacao

## Decisao Recomendada de P0-01

### Recomendacao

Escolher `piloto interno / single-tenant`.

### Motivo

- o produto atual ainda nao possui isolamento por empresa
- ainda nao existe auth real nem RBAC
- o schema atual ainda esta em modo MVP
- entregar primeiro um uso real controlado reduz risco e acelera validacao

### Resultado esperado de P0-01

Ao final de `P0-01`, estas decisoes precisam estar registradas:

- modelo de lancamento: `piloto interno` ou `single-tenant`
- primeiro grupo de usuarios
- ambiente alvo da primeira homologacao
- politica de auth inicial
- lista de itens explicitamente adiados para depois da primeira entrega

## Sequencia da Sprint

1. Fechar a decisao de lancamento.
2. Desenhar o modelo tecnico de auth.
3. Evoluir schema Prisma.
4. Implementar backend de auth.
5. Integrar o frontend com login real.
6. Validar com testes e smoke test.

## Tarefas Executaveis

## Track A - P0-01

### S1-01 - Registrar decisao de lancamento

- Tipo: produto + tecnico
- Esforco: 0.5 dia
- Dependencias: nenhuma

Saida esperada:

- documento curto com a escolha entre:
  - `piloto interno`
  - `single-tenant`
  - `SaaS multi-tenant`
- recomendacao final: `piloto interno / single-tenant`
- justificativa tecnica e comercial

Criterio de aceite:

- o documento define claramente o alvo da primeira entrega
- existe uma lista curta de itens adiados
- existe um responsavel nomeado pela decisao

### S1-02 - Definir politica inicial de auth

- Tipo: decisao tecnica
- Esforco: 0.5 dia
- Dependencias: S1-01

Decisoes a fechar:

- login por `email + senha`
- sessao via `access token` curto + `refresh token` em cookie `HttpOnly`
- expiracao inicial:
  - `access token`: 15 min
  - `refresh token`: 7 dias
- reset de senha fora da Sprint 01, com reset manual administrativo se necessario

Criterio de aceite:

- expiracoes definidas
- formato de sessao definido
- local de armazenamento do refresh token definido
- estrategia de logout definida

### S1-03 - Definir usuarios e perfis iniciais

- Tipo: produto + tecnico
- Esforco: 0.5 dia
- Dependencias: S1-01

Escopo inicial:

- perfis:
  - `admin`
  - `comprador`
  - `gestor`
  - `viewer`
- um usuario admin seedado para homologacao

Criterio de aceite:

- nomes dos perfis fechados
- semantica minima de cada perfil definida
- usuario admin inicial definido para ambiente de homologacao

## Track B - P0-02 Backend

### S1-04 - Adicionar dependencias e variaveis de ambiente

- Tipo: backend
- Esforco: 0.5 dia
- Dependencias: S1-02

Pacotes recomendados:

- `bcryptjs`
- `jsonwebtoken`
- `cookie-parser`
- `zod`

Variaveis novas:

- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_SECRET`
- `JWT_ACCESS_EXPIRES_IN`
- `JWT_REFRESH_EXPIRES_IN`
- `COOKIE_SECURE`

Arquivos provaveis:

- `package.json`
- `.env.example`
- `src/app.ts`

Criterio de aceite:

- dependencias instaladas
- app inicializa com as novas envs
- cookie parser habilitado

### S1-05 - Evoluir schema Prisma para auth

- Tipo: backend/database
- Esforco: 1 dia
- Dependencias: S1-03

Modelos recomendados:

- `User`
- `Role`
- `Session`

Campos minimos recomendados:

- `User`
  - `id`
  - `name`
  - `email`
  - `passwordHash`
  - `isActive`
  - `roleId`
  - `createdAt`
  - `updatedAt`
- `Role`
  - `id`
  - `name`
  - `createdAt`
- `Session`
  - `id`
  - `userId`
  - `refreshTokenHash`
  - `expiresAt`
  - `revokedAt`
  - `createdAt`

Arquivos provaveis:

- `prisma/schema.prisma`
- `prisma/migrations/...`

Criterio de aceite:

- schema compila
- migration gera sem erro
- relacionamento `User -> Role` existe
- sessao pode ser revogada sem apagar historico

### S1-06 - Atualizar seed e bootstrap inicial

- Tipo: backend/database
- Esforco: 0.5 dia
- Dependencias: S1-05

Entregas:

- criar roles iniciais
- criar admin inicial com senha hasheada
- manter seed de fornecedores/cotacoes/propostas sem quebrar demo

Arquivos provaveis:

- `prisma/seed.ts`

Criterio de aceite:

- seed sobe banco limpo
- roles existem
- admin inicial e criado com hash, nunca com senha em texto puro

### S1-07 - Criar utilitarios de senha e token

- Tipo: backend
- Esforco: 0.5 dia
- Dependencias: S1-04

Arquivos sugeridos:

- `src/utils/password.ts`
- `src/utils/tokens.ts`

Funcoes minimas:

- hash de senha
- comparacao segura de senha
- gerar access token
- gerar refresh token
- validar access token
- validar refresh token

Criterio de aceite:

- utilitarios cobertos por teste unitario
- segredo ausente falha de forma explicita

### S1-08 - Implementar servico e controller de auth

- Tipo: backend
- Esforco: 1 dia
- Dependencias: S1-05, S1-06, S1-07

Rotas recomendadas:

- `POST /api/v1/auth/login`
- `POST /api/v1/auth/logout`
- `POST /api/v1/auth/refresh`
- `GET /api/v1/auth/me`

Arquivos sugeridos:

- `src/controllers/AuthController.ts`
- `src/services/AuthService.ts`
- `src/routes/AuthRoutes.ts`
- `src/routes/index.ts`

Comportamento minimo:

- login valida usuario ativo
- logout revoga sessao
- refresh emite novo access token
- `me` retorna usuario autenticado sem `passwordHash`

Criterio de aceite:

- login invalido retorna `401`
- login valido cria sessao
- refresh com token revogado falha
- `me` so funciona autenticado

### S1-09 - Middleware de autenticacao

- Tipo: backend
- Esforco: 0.5 dia
- Dependencias: S1-08

Arquivos sugeridos:

- `src/middlewares/auth.ts`
- `src/types/express.d.ts`

Entrega:

- `requireAuth`
- anexar usuario autenticado em `req.user`

Decisao de rollout:

- proteger primeiro apenas `GET /api/v1/auth/me`
- preparar a aplicacao para proteger os modulos de negocio na sprint seguinte

Criterio de aceite:

- middleware identifica token ausente, invalido e expirado
- tipagem de `req.user` funciona no TypeScript

## Track C - Frontend

### S1-10 - Remover login hardcoded do frontend

- Tipo: frontend
- Esforco: 1 dia
- Dependencias: S1-08

Trocas necessarias:

- remover `DEMO_USER`
- remover validacao local de credencial
- trocar por chamada ao backend
- persistir sessao sem guardar segredo no browser

Arquivos provaveis:

- `public/app.js`
- `public/index.html`

Criterio de aceite:

- login chama `/api/v1/auth/login`
- logout chama `/api/v1/auth/logout`
- frontend consegue obter `me`
- mensagem de erro de login invalido aparece de forma amigavel

### S1-11 - Ajustar boot da app para sessao real

- Tipo: frontend
- Esforco: 0.5 dia
- Dependencias: S1-10

Entregas:

- no carregamento, frontend consulta `/api/v1/auth/me`
- se autenticado, mostra app
- se nao autenticado, mostra tela de login
- se receber `401`, limpa estado local

Arquivos provaveis:

- `public/app.js`

Criterio de aceite:

- refresh de pagina mantem sessao valida
- sessao expirada redireciona para login

## Track D - Qualidade

### S1-12 - Criar testes do fluxo de auth

- Tipo: qualidade
- Esforco: 1 dia
- Dependencias: S1-07, S1-08, S1-09

Cobertura minima:

- hash e compare de senha
- login com credencial valida
- login com senha invalida
- refresh com token valido
- refresh com token revogado
- `me` sem auth retorna `401`

Observacao:

- hoje o projeto nao possui stack de testes. Esta tarefa inclui escolher e instalar a base minima de teste.

Stack sugerida:

- `vitest`
- `supertest`

Criterio de aceite:

- suite roda por comando unico
- auth critica fica automatizada

### S1-13 - Smoke test final da sprint

- Tipo: validacao
- Esforco: 0.5 dia
- Dependencias: S1-10, S1-11, S1-12

Checklist:

1. migrar banco
2. seedar roles e admin
3. subir app
4. logar no frontend
5. consultar `me`
6. fazer logout
7. validar bloqueio de `me` apos logout

Criterio de aceite:

- checklist executado sem erro
- resultado registrado em documento curto ou PR

## Ordem Tecnica Recomendada

1. `S1-01`
2. `S1-02`
3. `S1-03`
4. `S1-04`
5. `S1-05`
6. `S1-06`
7. `S1-07`
8. `S1-08`
9. `S1-09`
10. `S1-10`
11. `S1-11`
12. `S1-12`
13. `S1-13`

## Estrutura Sugerida de Arquivos Novos

- `src/controllers/AuthController.ts`
- `src/services/AuthService.ts`
- `src/routes/AuthRoutes.ts`
- `src/middlewares/auth.ts`
- `src/utils/password.ts`
- `src/utils/tokens.ts`
- `src/types/express.d.ts`

## Ajustes Esperados em Arquivos Existentes

- `package.json`
- `.env.example`
- `prisma/schema.prisma`
- `prisma/seed.ts`
- `src/app.ts`
- `src/routes/index.ts`
- `public/app.js`
- `public/index.html`

## Riscos da Sprint

- introduzir auth sem quebrar a demo atual
- decidir cedo demais uma modelagem que precise mudar para multi-tenant
- tentar fazer RBAC completo nesta sprint e estourar prazo
- nao instalar testes e deixar auth sem cobertura minima

## Anti-Escopo

Se qualquer um destes itens entrar no meio da Sprint 01, o prazo vai escorregar:

- billing
- multi-tenant
- reescrita para Next.js
- reescrita para NestJS
- audit log completo
- anexos

## Definicao de Pronto da Sprint

A Sprint 01 so deve ser considerada concluida quando:

- `P0-01` estiver documentado e aprovado
- o login fake tiver sido removido
- existir usuario admin real
- auth de backend estiver funcional
- frontend estiver integrado com auth real
- testes minimos de auth estiverem rodando
- smoke test final estiver verde

## Proxima Sprint Recomendada

Depois desta sprint, a proxima mais logica e:

- `P0-03` Permissoes e protecao de rotas
- `P0-04` Endurecimento minimo da API

Essas duas aproveitam diretamente a fundacao criada aqui.
