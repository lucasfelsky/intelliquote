# Changelog IntelliQuote

## 2026-06-16 - Linguagem visual alinhada ao Portal COMEX

### Alterado
- `public/styles.css` totalmente repaginado para a paleta do Portal COMEX: verde-petróleo `#00AE91` + azul-marinho `#184054` como primárias, fundo em gradiente teal/mint, tipografia `Roboto` adicionada (além de `Manrope`/`Space Grotesk` para destaques numéricos), cards com `border-radius` 22-32px, sombras difusas teal, hover animado com `translateY(-1/-2px)`, botões primários em gradiente marinho (`#184054 -> #133848`), pílulas e chips com raio 999px, `eyebrow` em uppercase teal, `status-dot` com glow, formulário com `focus-ring` teal translúcido. A versão anterior foi preservada em `public/styles.legacy.css` para reversão rápida.
- `public/index.html` ganhou a fonte `Roboto` no `preconnect` para herdar a tipografia do Portal COMEX.
- Mantida a navegação por abas no topo (workspace-tabs), agora com container arredondado `999px` e estado ativo em gradiente marinho, alinhado com o `nav__link--active` do COMEX.

### Não alterado
- Backend, contratos de API, testes automatizados (46 passing) e fluxos JS do `app.js`.

## 2026-05-05 - Pacote de correcoes e melhorias (feedback dos usuarios)

### Adicionado
- Modulo de contatos secundarios por fornecedor (`SupplierContact`) com CRUD e regra de "principal" exclusivo.
- Modulo de anexos (`Attachment`) com upload base64, limite de 5MB, download auditado e exclusao fisica.
- Recuperao de senha via token de uso unico (TTL 1h) e endpoint administrativo para listar tokens ativos.
- Modulo de relatorios gerenciais: visao geral, economia estimada, lead time medio, top fornecedores e taxa de adjudicacao.
- Central de ajuda in-app com 10 artigos categorizados (fornecedor, cotacao, proposta, comparacao, etc.).
- Painel de onboarding em 3 passos (visivel ate ser dispensado).
- Wizard de 4 etapas no registo de propostas (identificacao, preco+Incoterm, custos adicionais, impostos+observacoes).
- Campos extras em fornecedores (pais, status, notas) e cotacoes (codigo, moeda, prazo, descricao).
- Modulo Usuarios com listagem paginada, edicao e redefinicao de senha (admin).
- Migracao `20260505120000_password_recovery_tokens` para a tabela `PasswordResetToken`.

### Alterado
- `routes/index.ts` agora registra as novas rotas (Attachment, SupplierContact, Report) em `/api/v1` e `/api`; rotas administrativas (`user`, `audit`) movidas para o final da pilha para evitar colisao de middlewares.
- `AuthRoutes` passou a oferecer `forgot-password`, `reset-password` e listagem administrativa de tokens.
- `validators/domain.ts` adicionou schemas `attachmentCreateSchema`, `supplierContactCreateSchema`, `reportQuerySchema` e schemas de recuperacao de senha.
- `UserController` retorna dados serializados sem `passwordHash`.
- Frontend (`index.html`/`app.js`/`styles.css`) ganhou 4 novas abas, formulario de recuperacao, painel de anexos, painel de contatos, onboarding, wizard e exibicao dos relatorios.

### Corrigido
- Rotas `/api/v1/...` que caiam em RBAC errado (suppliers/audit/relatorios) por ordem de middleware.
- Validacao previa em `QuoteResponseController.update` para impedir marcacao manual de `isWinner` fora do fluxo de comparacao.
- Criacao de anexos passa a validar `entityType`/`entityId` antes de gravar.

## 2026-03-25 - Piloto de custo landed

- Adicionado modelo `LandedCost` e `LandedCostItem`, validacoes Zod correspondentes e UI dedicada.
- Refactor do `QuoteResponseController` para centralizar calculo de custo total e snapshots auditaveis.

## 2026-02-12 - Auth + Auditoria

- Migracao para autenticacao JWT com cookies HttpOnly (access + refresh).
- Implementacao do servico de auditoria com snapshot antes/depois.
