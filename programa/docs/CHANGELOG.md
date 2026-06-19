# Changelog — IntelliQuote

Todas as alteracoes relevantes do projeto sao documentadas aqui. O formato segue uma versao aproximada de [Keep a Changelog](https://keepachangelog.com/pt-BR/).

## [Unreleased] — Portal de Fornecedores (magic link)

### Adicionado
- Schema Prisma: tabelas `SupplierPortalToken`, `SupplierPortalResponse`, `DispatchEvent`, `SupplierPortalTokenLog`, alem de novas colunas em `Supplier` (status `inactive`/`active`, `acceptedIncoterms`, `lastResponseAt`) e `SupplierContact` (aceite de LGPD, ip do aceite).
- Servico `SupplierPortalService` com ciclo de vida do token: criacao, revogacao, validacao por hash SHA-256, expiracao configuravel e registro de log de acesso.
- Servico `SupplierPortalResponseService` para persistir e atualizar respostas com transacao, evitando perda de dados entre confirmacao e edicao.
- Controlador `DispatchController` com rotas de:
  - `POST /api/v1/quote-requests/:id/dispatch/preview` (200/400/404)
  - `POST /api/v1/quote-requests/:id/dispatch` (201/400/404)
  - `GET  /api/v1/quote-requests/:id/dispatch` (200)
  - `POST /api/v1/quote-requests/:id/dispatch/tokens/:tokenId/revoke` (200/404)
- Controlador publico `PortalRoutes` (sem autenticacao) com endpoints `GET/POST /api/portal/:token`, `/api/portal/:token/respond` e `/api/portal/_meta`. Suporta login anonimo por link magico e respostas com edicao posterior.
- Pagina publica `/portal.html` para o fornecedor responder e revisar respostas.
- Template de e-mail em Ingles (`src/mailer/templates/quote-dispatch.en.html`) com slot de mensagem personalizada e renderizador `renderQuoteDispatch` para HTML + texto.
- Configuracoes SMTP (placeholders em `.env.example`) alinhadas ao Portal COMEX e suporte a `MAILER_COMEX_CC_LIST` para manter a equipe do COMEX em copia.
- Modal no frontend (`openDispatchModal`) para listar contatos ativos, selecionar destinatarios, configurar prazo (1-30 dias) e disparar o envio.
- Tela de historico de disparos (`showDispatchHistory`) por cotacao com contadores de enviados, falhas e status de cada token.

### Alterado
- `MailerService.sendAndLog` aceita lista de CC padrao (`getComexCcList`) e expoe `MAILER_PORTAL_URL` para construir o link magico.
- `routes/index.ts` reorganizado para montar `portalRoutes` antes do roteador autenticado, garantindo que `/api/portal/*` nao exija login.
- Cobertura de testes expandida: 57 testes passando (incluindo suites para servico, rotas publicas e dispatch controller).

### Pendencias
- Escrever documentacao de uso no README (fluxo para o operador COMEX).
- Configurar SMTP real (remover placeholders em `.env` quando o usuario for colar credenciais).
