# Roadmap de Migracao do Frontend

Data: 2026-05-05

## Contexto

O frontend atual do IntelliQuote e uma aplicacao estatica em `public/index.html`, `public/app.js` e `public/styles.css` servida pelo proprio backend Express. Funciona bem para o MVP e para o piloto single-tenant, mas ja apresenta sinais de complexidade crescente:

- mais de 600 linhas de HTML, ~2800 linhas de JS em arquivo unico
- novos modulos (relatorios, ajuda, usuarios, anexos, contatos) exigem manipulacao direta de DOM em `state`/`elements`/`render*`
- estilizacao nova depende de classes espalhadas no `styles.css` (620+ linhas)
- o ciclo de teste manual segue crescendo a cada sprint

## Recomendacao

Adiar a migracao para um framework SPA/SSR ate que o piloto esteja estavel. Quando a migracao for inevitavel, seguir esta ordem:

1. **Fase 0 - estabilizar o atual (concluida)**:
   - desacoplar `state`/`elements`/`render*` em modulos por dominio (`suppliers.js`, `quotes.js`, etc.)
   - mover templates para `<template>` HTML ou strings em arquivos `.html` para reduzir string concat no JS
   - introduzir pelo menos lint e prettier no frontend

2. **Fase 1 - migracao assistida**:
   - framework alvo recomendado: **Next.js (App Router)** com React + TypeScript
   - motivacao: ecossistema, SSR para reduzir dependencia do Express servir estaticos, suporte a edge functions
   - estrategia: criar `web/` paralelo, consumir os mesmos endpoints `/api/v1` sem alteracao de backend
   - implementar auth client-side com cookies HttpOnly mantidos

3. **Fase 2 - componente de design proprio**:
   - extrair Design System (cores, tipografia, espacamentos) em `web/tokens` e `web/components`
   - remover dependencia de Bootstrap CDN quando a base estiver amadurecida

4. **Fase 3 - feature parity**:
   - migracao incremental: login > fornecedores > cotacoes > propostas > comparacao > relatorios > ajuda
   - smoke tests E2E com Playwright para garantir paridade com o legado

## Alternativas Consideradas

- **Vue 3 + Vite**: curva de aprendizado menor, mas o time ja possui mais experiencia com React.
- **SvelteKit**: bundle minimo, mas comunidade menor para os proximos 12-18 meses.
- **Migrar o backend para NestJS simultaneamente**: aumenta risco e escopo. Manter Express no piloto.

## Riscos

- manter dois frontends por algum tempo durante a migracao
- regressoes visuais e de fluxo (mitigar com testes E2E + capture de snapshots)
- custo de manutencao do `app.js` legado ate a migracao completa

## Criterio de Decisao

Adotar o roadmap quando:

- numero de modulos ativos > 12 OU
- tempo medio para adicionar uma nova tela > 1 sprint OU
- taxa de bugs relacionados a estado de UI > 2 por sprint

Ate la, manter o legado com disciplina de modularizacao.
