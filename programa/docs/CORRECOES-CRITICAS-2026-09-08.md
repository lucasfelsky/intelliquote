# Correções críticas e altas — 08/09/2026

Escopo autorizado: ranking multi-item, lembrete, aprovação por valor e exclusão de propostas. Alterações locais; publicação não faz parte desta execução. Nenhuma migração nova foi necessária.

## Ranking e moeda

O portal passa a gravar `offeredPrice` como soma de preço unitário × quantidade de todos os itens. Preview e comparação persistida recalculam pelos itens, corrigindo também propostas antigas cujo agregado continha apenas o preço do primeiro item. Comparações históricas não são reescritas.

A comparação automática exige exatamente os itens ativos da cotação e suas quantidades, sem repetição. Respostas parciais permanecem disponíveis para negociação, mas a API informa a inconsistência antes de calcular um ranking. Cotações legadas que não possuem detalhamento de itens continuam usando o contrato agregado.

O envio público confere os totais por item e o total geral e exige a mesma moeda no total. O fallback de câmbio não reutiliza uma taxa de outra moeda. BRL sempre usa fator 1. A tabela mostra o custo total em reais, coerente com a classificação, e exibe o motivo retornado pela API quando a cesta não pode ser comparada.

Entradas: `src/utils/quoteBasket.ts`, `SupplierPortalResponseService`, `QuoteComparisonService`, `QuoteResponseController`, `ComparacaoTab`.

## Lembrete

Somente `status: sent` do transporte permite revogar o token original e contabilizar envio. Retornos `failed`/`queued` e exceções preservam o link original. O claim continua consumido para evitar duplicidade entre réplicas; não foi criada uma política nova de retry do sweep. Aceitação SMTP não é garantia de entrega na caixa postal.

## Aprovação por valor

O limite é mantido. A interface mantém as ações da proposta recomendada e solicita aprovação explícita de gestor/admin antes de continuar a ação que gerou uma comparação pendente. Cancelamento, erro ou perfil comprador impedem prosseguir. Como cada ação persiste uma nova comparação, uma nova adjudicação acima do limite pede aprovação novamente.

A aprovação atualiza a proposta e o vencedor no snapshot na mesma transação. Uma proposta excluída não pode ser aprovada por um registro antigo. A escolha manual acima do limite também exige gestor/admin; a auditoria registra essa condição. O campo de limite da empresa passa a ser efetivamente persistido, só pode ser alterado por gestor/admin e não é apagado quando omitido em outra atualização do perfil.

## Exclusão e histórico

Excluir uma proposta define `deletedAt`, limpa `isWinner`, arquiva logicamente seus itens e revoga os links existentes desse fornecedor na cotação. A auditoria integra a transação. Listagens, detalhes operacionais, comparação e indicadores filtram exclusões. Indicadores desconsideram comparações afetadas por propostas excluídas; o endpoint de histórico mantém os snapshots.

A unicidade `(quoteRequestId, supplierId)` é preservada: cadastrar novamente após exclusão inicia outra versão no mesmo vínculo, com novos itens ativos e os antigos arquivados. Reenvio por um novo token também preserva os itens anteriores. Tokens revogados não podem efetivar uma submissão, inclusive se a revogação ocorrer após a validação inicial. Os previews de e-mail usam somente os itens ativos.

## Verificação reproduzível

- Backend: `npm test -- --maxWorkers=2` e `npm run build`.
- Frontend, em `web`: `npm test -- --maxWorkers=2` e `npm run build`.
- Integração real isolada: `node scripts/test-critical-local.mjs`.

O último comando cria um PostgreSQL descartável em porta local livre, aplica as 34 migrações existentes, executa `tests/critical-fixes-db.test.ts` e encerra o cluster. Sobrescreve as URLs de banco no ambiente do processo e usa transporte console; não utiliza o banco configurado no `.env`. Os testes de integração recusam qualquer banco que não seja o destino local específico do runner.

O runner depende dos binários de `embedded-postgres` já instalados no projeto. No Windows, usa `pg_ctl` para complementar o encerramento quando `taskkill` da biblioteca não funciona no sandbox.

## Resultado da validação

- Backend: 225 testes passaram na suíte padrão. Os 8 testes novos de banco, pulados nessa execução, passaram no runner isolado. Os 6 testes de banco anteriores continuam fora dessa execução padrão.
- Frontend: 97 testes passaram, incluindo aprovação confirmada, cancelada, rejeitada por erro e bloqueada para comprador.
- PostgreSQL descartável: 8 cenários passaram, incluindo cálculo antigo, proposta parcial, exclusão/restauração, snapshots, permissões, rollback com token revogado e câmbio de outra moeda.
- Após a revisão final, os 10 testes de relatórios e os 26 testes de e-mail/ordem de compra foram repetidos com sucesso. Essas repetições não são contadas como testes adicionais.
- Builds do backend e frontend concluídos; `git diff --check` sem erros. O build web exigiu execução fora do sandbox por uma restrição de leitura do esbuild.

Total de casos distintos aprovados: **330**. Não houve deploy, execução de migrações no banco de produção ou envio de e-mails reais.

## Fora deste lote

Garantia operacional dos crons, padronização de lead time, limite de PDF/base64 e consulta automática de alíquotas por NCM continuam fora do escopo. Comparações antigas conservam os valores históricos anteriores à correção; para obter a nova avaliação, é necessário executar uma comparação atual.
