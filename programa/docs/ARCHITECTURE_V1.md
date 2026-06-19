# IntelliQuote Architecture V1

## Objetivo

Definir a arquitetura oficial do IntelliQuote para evolução de MVP académico para produto interno utilizável em ambiente empresarial.

## Princípios

- segurança antes de conveniência
- rastreabilidade de decisões
- backend como fonte de verdade
- frontend desacoplado e escalável
- modelo relacional explícito
- evolução incremental sem reescrita constante

## Escopo da V1

A V1 deve suportar operação real de uma equipa de compras/importação com múltiplos utilizadores, controlo de acesso, histórico e comparação formal de propostas.

Inclui:

- autenticação real
- perfis e permissões
- gestão de fornecedores
- gestão de pedidos de cotação
- gestão de propostas
- comparação e seleção de proposta vencedora
- histórico de alterações
- anexos de documentos
- dashboard operacional
- exportação de comparação

Não inclui nesta fase:

- envio automático de e-mails
- integração com ERP
- workflow complexo multi-aprovação
- motor de câmbio em tempo real

## Arquitetura Recomendada

### Frontend

- `Next.js`
- `TypeScript`
- `App Router`
- `Server Actions` apenas onde fizer sentido; regra geral, consumir API dedicada
- `TanStack Query` para cache e sincronização de dados
- `React Hook Form + Zod` para formulários
- biblioteca UI consistente com design system interno

### Backend

- `Node.js`
- `TypeScript`
- `NestJS` preferencialmente

Motivo:

- melhor estrutura modular
- validação nativa mais organizada
- guards/interceptors para segurança e auditoria
- manutenção superior para produto real multi-módulo

Alternativa aceitável:

- Express, mas apenas se for reorganizado com módulos, validação forte e camadas claras

### Base de Dados

- `PostgreSQL`
- `Prisma ORM`
- `Supabase` como fornecedor de Postgres pode continuar

### Infraestrutura

- frontend: `Vercel`
- backend: `Railway`, `Render`, `Fly.io` ou VPS gerida
- base de dados: `Supabase Postgres`
- ficheiros/anexos: `Supabase Storage` ou `S3`

## Módulos Funcionais

### 1. Auth

Responsabilidades:

- login
- logout
- refresh token
- recuperação de palavra-passe
- gestão de sessão
- auditoria de acessos

### 2. Users

Responsabilidades:

- criar utilizadores
- ativar/desativar utilizadores
- associar utilizadores a departamentos/equipas
- atribuir perfis

### 3. Suppliers

Responsabilidades:

- cadastro de fornecedores
- contactos
- incoterms aceites
- documentos associados
- estado do fornecedor

### 4. Quote Requests

Responsabilidades:

- criar pedido de cotação
- definir produto, quantidade e requisitos
- estado do processo
- anexos
- observações internas

### 5. Quote Responses

Responsabilidades:

- registar propostas por fornecedor
- preço, incoterm, prazo, moeda
- anexos da proposta
- versão da proposta

### 6. Comparison Engine

Responsabilidades:

- executar algoritmo de pontuação
- guardar resultado da comparação
- manter memória da fórmula aplicada
- marcar proposta vencedora

### 7. Audit

Responsabilidades:

- histórico de alterações por entidade
- utilizador responsável
- data/hora
- antes/depois em campos críticos

### 8. Dashboard

Responsabilidades:

- métricas operacionais
- propostas por fornecedor
- cotações abertas/fechadas
- taxa de adjudicação

## Perfis e Permissões

### Admin

- gestão total do sistema
- gestão de utilizadores
- acesso a todas as entidades

### Comprador

- cria e edita cotações
- regista propostas
- executa comparações
- não gere utilizadores

### Gestor

- consulta tudo
- aprova ou valida decisão final
- pode encerrar processo

### Viewer

- acesso apenas de leitura

## Modelo de Dados V1

### Entidades principais

- `User`
- `Role`
- `Supplier`
- `SupplierContact`
- `QuoteRequest`
- `QuoteRequestItem`
- `QuoteResponse`
- `QuoteComparison`
- `QuoteComparisonResult`
- `Attachment`
- `AuditLog`

### Ajustes importantes ao modelo atual

#### Supplier

Adicionar:

- `status`
- `country`
- `notes`
- `createdBy`

#### QuoteRequest

Adicionar:

- `requestCode`
- `description`
- `currency`
- `deadlineAt`
- `closedAt`
- `createdBy`

#### QuoteResponse

Adicionar:

- `currency`
- `leadTimeDays`
- `notes`
- `submittedAt`
- `version`

#### QuoteComparison

Nova entidade para persistir:

- cotação comparada
- utilizador que executou
- pesos utilizados
- timestamp
- proposta vencedora

#### AuditLog

Campos:

- `entityType`
- `entityId`
- `action`
- `performedBy`
- `beforeData`
- `afterData`
- `createdAt`

## Regras de Negócio V1

- apenas propostas da mesma cotação podem ser comparadas
- comparação gera registo próprio e auditável
- ao selecionar vencedora, o sistema não deve perder histórico de comparações anteriores
- cotações fechadas não aceitam novas propostas, salvo reabertura autorizada
- só perfis autorizados podem fechar ou reabrir cotação
- alterações críticas devem gerar audit log

## Segurança

### Autenticação

- `JWT access token`
- `refresh token`
- palavra-passe com hash `bcrypt`
- sessão com expiração controlada

### Autorização

- `RBAC` por perfil
- validação de permissões por rota e por ação

### Proteções mínimas

- validação de payload com `Zod` ou validadores do framework
- rate limit em auth
- CORS controlado
- headers de segurança
- logs sem exposição de segredos

## API Design

### Padrão

- `/api/v1/...`
- respostas consistentes
- paginação no backend
- filtros por query string
- erros padronizados

### Exemplos de módulos

- `/api/v1/auth`
- `/api/v1/users`
- `/api/v1/suppliers`
- `/api/v1/quote-requests`
- `/api/v1/quote-responses`
- `/api/v1/comparisons`
- `/api/v1/audit`

## Frontend V1

### Áreas principais

- login
- dashboard
- fornecedores
- cotações
- propostas
- comparação
- administração

### Requisitos de UX

- pesquisa global por módulo
- filtros persistentes
- feedback claro de estado
- formulários validados
- detalhe de cotação com timeline do processo

## Observabilidade e Qualidade

### Logs

- logs estruturados no backend
- correlation id por request

### Testes

- unit tests no algoritmo
- integration tests nas rotas críticas
- e2e dos fluxos principais

### Monitorização

- uptime monitor
- erro de backend
- falha de base de dados

## Ambientes

- `local`
- `staging`
- `production`

Cada ambiente deve ter:

- base de dados própria
- variáveis de ambiente próprias
- storage separado

## Roadmap de Implementação

### Fase 1

- reorganizar backend
- autenticação real
- users + roles
- schema relacional v1

### Fase 2

- frontend em Next.js
- CRUD completos
- dashboard inicial
- comparação persistida

### Fase 3

- audit log
- anexos
- exportações
- endurecimento de segurança

### Fase 4

- integrações
- aprovações
- melhorias analíticas

## Decisão Recomendada

Para produto real, a direção recomendada é:

- migrar o frontend atual para `Next.js`
- evoluir o backend para `NestJS`
- manter `Prisma + PostgreSQL`
- adotar `RBAC`, `audit log` e `comparison history` como pilares obrigatórios

## Próximo Passo

Depois deste documento, o próximo passo técnico correto é produzir:

1. schema relacional v1
2. mapa de módulos backend
3. backlog técnico priorizado
