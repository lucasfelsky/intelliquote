# IntelliQuote Launch Backlog

Baseado na analise do codigo atual, dos documentos de produto e da arquitetura V1.

Data da analise: 2026-03-25

## Estado Atual

- `build` funcionando
- backend sobe e responde em `/health`
- CRUD de fornecedores, cotacoes e propostas funcionando
- comparador e exportacao CSV funcionando
- migracao Prisma alinhada com a base atual
- frontend atual serve bem para demo

Resumo objetivo:

- pronto para demo academica
- perto de um piloto interno controlado
- ainda nao pronto para lancamento comercial pago

## Decisao de Lancamento

Antes de executar o backlog, precisamos fixar qual e o alvo:

1. `Piloto interno ou cliente unico`
2. `Produto comercial single-tenant por cliente`
3. `SaaS multi-tenant`

Se o objetivo for `SaaS multi-tenant`, isolamento por empresa/workspace vira item obrigatorio de `P0`.

## Criterio de Prioridade

- `P0`: bloqueia piloto ou lancamento
- `P1`: necessario para operar bem e vender com seguranca
- `P2`: melhoria importante, mas pode entrar depois do go-live inicial

## P0

| ID | Item | Entregaveis | Esforco | Dependencias | Necessario para |
| --- | --- | --- | --- | --- | --- |
| P0-01 | Definir modelo de lancamento | decisao documentada entre piloto interno, single-tenant ou SaaS multi-tenant; definicao de quem e o primeiro usuario pagante | 1 a 2 dias | nenhuma | todo o resto |
| P0-02 | Autenticacao real e gestao de usuarios | login real, hash de senha, sessao/JWT, logout, recuperacao basica de acesso, tabela `User` e `Role` | 5 a 8 dias | P0-01 | piloto e comercial |
| P0-03 | Permissoes e protecao de rotas | RBAC por perfil (`admin`, `comprador`, `gestor`, `viewer`), middleware/guard por rota e por acao | 3 a 5 dias | P0-02 | piloto e comercial |
| P0-04 | Endurecimento minimo da API | validacao de payload, erros padronizados, `CORS`, headers de seguranca, rate limit em auth, sanitizacao basica, logs sem segredos | 3 a 5 dias | P0-02 | piloto e comercial |
| P0-05 | Evolucao minima do schema para operacao real | campos de negocio minimos em `Supplier`, `QuoteRequest` e `QuoteResponse`; `createdBy`; status; moeda; prazo; observacoes; `requestCode` | 4 a 6 dias | P0-01 | piloto e comercial |
| P0-06 | Persistencia da comparacao e historico | entidades `QuoteComparison` e `QuoteComparisonResult`; pesos usados; usuario executor; timestamp; vencedor persistido sem perder historico | 4 a 6 dias | P0-05 | piloto e comercial |
| P0-07 | Regras de negocio criticas | impedir proposta em cotacao fechada, controlar reabertura, garantir comparacao so entre respostas da mesma cotacao, impedir alteracoes invalidas | 3 a 4 dias | P0-05, P0-06 | piloto e comercial |
| P0-08 | Audit log minimo | `AuditLog` para create/update/delete e acoes criticas como comparar, fechar e reabrir cotacao | 3 a 5 dias | P0-02, P0-05 | piloto e comercial |
| P0-09 | Ajuste do frontend para operacao real | remover login fake, integrar auth real, esconder acoes por permissao, tratar expiracao de sessao, melhorar erros e estados vazios | 4 a 6 dias | P0-02, P0-03 | piloto e comercial |
| P0-10 | Testes do fluxo critico | unitario do algoritmo, integracao das rotas criticas, smoke e2e do fluxo cadastrar -> receber proposta -> comparar -> fechar | 4 a 6 dias | P0-04 a P0-09 | piloto e comercial |
| P0-11 | Deploy, ambientes e operacao | `staging` e `production`, pipeline de build/deploy, variaveis por ambiente, backup, health checks, monitoracao minima, runbook | 4 a 6 dias | P0-10 | piloto e comercial |
| P0-12 | Isolamento por conta/empresa | entidade `Account` ou `Workspace`, ownership dos dados, filtros globais por tenant, seeds separados e onboarding por conta | 5 a 8 dias | P0-01 | SaaS multi-tenant |

### Observacoes de P0

- O frontend atual usa credencial hardcoded no navegador. Isso precisa sair antes de qualquer uso real.
- O schema atual ainda e de MVP. Para uso real, faltam entidades de usuario, historico e auditoria.
- O comparador atual decide vencedor, mas nao preserva memoria auditavel da formula aplicada.

## P1

| ID | Item | Entregaveis | Esforco | Dependencias | Necessario para |
| --- | --- | --- | --- | --- | --- |
| P1-01 | Paginacao, filtros e busca no backend | query params, ordenacao, resposta paginada e filtros server-side | 3 a 4 dias | P0-04 | comercial |
| P1-02 | Anexos e storage | upload de arquivos, vinculacao a fornecedor/cotacao/proposta, regras de acesso e exclusao segura | 4 a 6 dias | P0-02, P0-05 | comercial |
| P1-03 | Envio de solicitacoes de cotacao | disparo de e-mails ou links, templates, rastreio de envio e status por fornecedor | 4 a 7 dias | P0-02, P0-05 | comercial |
| P1-04 | Dashboard e relatorios reais | economia gerada, tempo medio de resposta, fornecedores mais competitivos, historico por periodo | 5 a 8 dias | P0-06, P0-08 | comercial |
| P1-05 | Cobranca e planos | planos free/pago, limites de uso, integracao de assinatura, bloqueios e upgrade de conta | 5 a 8 dias | P0-02, P0-12 se SaaS | comercial pago |
| P1-06 | Fluxo de aprovacao simples | validacao final por gestor, trilha de aprovacao, bloqueio de encerramento sem perfil correto | 4 a 6 dias | P0-03, P0-08 | comercial |
| P1-07 | Itemizacao de cotacao | multiplos itens por cotacao, somatorios, moeda e comparacao por item ou consolidada | 5 a 8 dias | P0-05 | comercial |
| P1-08 | Observabilidade melhorada | logs estruturados, correlation id, error tracking, alertas de falha de banco/API | 2 a 4 dias | P0-11 | comercial |
| P1-09 | Onboarding e administracao | tela de usuarios, convites, reset de senha, configuracoes de empresa, seeds de onboarding | 4 a 6 dias | P0-02, P0-03 | comercial |

## P2

| ID | Item | Entregaveis | Esforco | Dependencias | Necessario para |
| --- | --- | --- | --- | --- | --- |
| P2-01 | Migracao do frontend para Next.js | nova camada de app, auth mais forte, UX mais escalavel | 8 a 12 dias | P0 completo | pos go-live |
| P2-02 | Migracao do backend para NestJS | modulos, guards, DTOs, estrutura mais preparada para escala | 8 a 12 dias | P0 completo | pos go-live |
| P2-03 | Workflow avancado de aprovacao | multi-aprovacao, alcadas, escalonamento e regras por valor | 6 a 10 dias | P1-06 | pos go-live |
| P2-04 | Integracoes externas | ERP, fornecedores, storage corporativo, SSO | 6 a 15 dias | P0/P1 conforme escopo | pos go-live |
| P2-05 | Motor de cambio e custo landed | cambio, frete, impostos estimados e custo total de importacao | 6 a 10 dias | P1-07 | pos go-live |
| P2-06 | Analytics avancado | previsao, recomendacoes, benchmark por fornecedor e sazonalidade | 8 a 15 dias | P1-04 | pos go-live |

## Ordem Recomendada de Execucao

1. Fechar `P0-01` e decidir o modelo de lancamento.
2. Implementar `P0-02` e `P0-03` para remover o login fake e proteger a API.
3. Entregar `P0-05`, `P0-06`, `P0-07` e `P0-08` para tornar o processo auditavel e consistente.
4. Ajustar o frontend com `P0-09`.
5. Cobrir tudo com `P0-10`.
6. Subir `staging` e `production` com `P0-11`.
7. Se o produto for SaaS, executar `P0-12` antes de abrir para mais de uma empresa.
8. Depois do piloto validado, puxar `P1-01` ate `P1-09` conforme estrategia comercial.

## Gate de Piloto Interno

O piloto interno pode comecar quando estes itens estiverem concluidos:

- `P0-01` ate `P0-11`
- onboarding basico de usuarios
- checklist de backup e restauracao validado
- um ambiente `staging` para homologacao
- testes do fluxo principal verdes

## Gate de Lancamento Comercial

Para vender de forma segura, o minimo recomendado e:

- tudo do `Gate de Piloto Interno`
- `P1-01`, `P1-02`, `P1-04`, `P1-08`, `P1-09`
- `P1-05` se houver cobranca recorrente
- `P0-12` se houver mais de uma empresa no mesmo produto

## Estimativa de Horizonte

Assumindo 1 dev full stack focado e poucas interrupcoes:

- `Piloto interno`: 4 a 6 semanas
- `Lancamento comercial single-tenant`: 6 a 9 semanas
- `SaaS multi-tenant`: 8 a 12+ semanas

Se houver 2 pessoas com backend e frontend divididos, o prazo pode cair bem, mas auth, schema, comparacao historica e deploy continuam no caminho critico.

## Recomendacao Objetiva

Melhor caminho agora:

1. lancar primeiro um `piloto interno` ou `single-tenant`
2. endurecer o stack atual em vez de reescrever tudo agora
3. deixar migracao para `Next.js` e `NestJS` como `P2`, salvo se a equipe quiser investir em reestruturacao antes do go-live

Isso preserva o que ja funciona, reduz risco e coloca o produto em uso real mais rapido.
