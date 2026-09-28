# Ranking pelo valor dos itens

A partir desta alteração, o critério Preço e seu desempate usam a soma de preço unitário × quantidade de todos os itens, na moeda original das propostas. Nas cotações em USD, a interface exibe **Total dos itens (US$)**. Não entram conversão cambial, frete adicional, seguro, taxas ou estimativas tributárias. Custos já incluídos no preço do fornecedor conforme o Incoterm permanecem nesse preço.

Motivo: a integração tributária por NCM ainda não está disponível; mostrar um custo final de importação no ranking induziria a uma precisão que o sistema não tem. Os demais critérios selecionáveis continuam funcionando com seus pesos.

As propostas devem usar a mesma moeda. Cotações existentes em BRL ou outras moedas mantêm sua unidade, explicitamente identificada, sem conversão automática nem números de moedas diferentes comparados entre si. Propostas parciais continuam bloqueadas.

O limite de aprovação permanece em BRL, separado do ranking. O snapshot de landed cost continua disponível para histórico/alçada. Quando existe alçada e falta câmbio, a adjudicação exige aprovação de gestor/admin, inclusive na escolha manual; a ausência de taxa não equivale a uma compra de valor zero. O ranking pode ser consultado sem câmbio.

Comparações históricas não são reescritas. Não há migração de banco. Esta nota substitui a descrição anterior de landed cost como base do ranking em `CORRECOES-CRITICAS-2026-09-08.md`.

Validação: regressões para inversão de vencedor por impostos/câmbio, moedas diferentes, ausência de câmbio com alçada, comparação por API e exibição do total em USD.
