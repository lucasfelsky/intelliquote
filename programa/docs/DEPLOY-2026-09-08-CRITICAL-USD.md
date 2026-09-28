# Deploy — correções críticas e ranking na moeda original

Publicado em 08/09/2026, aproximadamente 23:10 (America/Sao_Paulo), mediante autorização do usuário.

- Projeto: `sq-comex-updates-3d22f`.
- Cloud Build: `27761be1-b601-4a7e-85ba-778733c06db2` — SUCCESS.
- Imagem: `southamerica-east1-docker.pkg.dev/sq-comex-updates-3d22f/intelliquote/intelliquote-api:20260908-critical-usd`.
- Digest: `sha256:da29b94b7bceb4db064d875f7fce46bfd57420aa9b5ac4d2103a7a2876c3afcf`.
- Revisão ativa: `intelliquote-api-00132-kux`, com 100% do tráfego.
- Revisão anterior: `intelliquote-api-00131-lfl` (imagem `:109`).
- Frontend: Firebase Hosting, site `intelliquote`, configuração `firebase.intelliquote.json`.
- Domínio: https://intelliquote.portal-comex.com.

## Verificações

228 testes de backend e 98 de frontend passaram. Os 14 testes dependentes de banco permaneceram ignorados nesta execução. Builds de produção de backend e frontend passaram.

A revisão nova foi criada sem tráfego, validada em `/health` e `/health/ready`, e só então promovida. API de produção confirmou `buildTag=20260908-critical-usd` e `database=ok`. Domínios Firebase e customizado responderam HTTP 200 com o novo bundle. O SHA-256 do JavaScript baixado do domínio customizado corresponde ao build local:

`706B9708957C852A1FE967BBA8769EA428E549AF4B683D39DD95D726ADC79538`

Não houve alteração de schema/migrações neste conjunto. A inicialização padrão do container executa `prisma migrate deploy`. Não foram alterados segredos, permissões ou dimensionamento do serviço. Não houve teste de compra autenticada nem envio de mensagens reais durante a verificação.

## Escopo e rastreabilidade

Publicação do código local com as correções críticas/altas documentadas em `CORRECOES-CRITICAS-2026-09-08.md` e a regra atual descrita em `RANKING-MOEDA-ORIGINAL-2026-09-08.md`. Não foi criado commit ou tag Git. O pacote do Cloud Build contém somente os arquivos necessários ao backend; não inclui arquivos de ambiente ou documentos locais.

Para um eventual retorno, a revisão anterior está identificada acima e o histórico de releases do site está disponível no Firebase Hosting. Nenhum rollback foi executado.
