# Roadmap de Integracoes Externas

Data: 2026-05-05

## Visao Geral

O feedback dos potenciais usuarios deixou claro que o IntelliQuote precisa, no horizonte de 6-12 meses, oferecer integracoes com sistemas externos para ganhar tracacao como produto.

## Integracoes Priorizadas

### P0 - operacional (proximo trimestre)

- **SMTP/relay para envio de e-mail** (recuperacao de senha real, notificacoes de comparacao concluida, alerta de cotacao fechada).
  - opcoes: `nodemailer` + SMTP interno, AWS SES, Resend
  - esforco: medio (1-2 semanas)
- **Storage S3-compat para anexos** (substituir pasta local `uploads/attachments` por bucket gerenciado).
  - opcoes: AWS S3, Cloudflare R2, MinIO
  - esforco: medio (1-2 semanas)

### P1 - produto (1-2 trimestres)

- **SSO OIDC** (Google Workspace, Azure AD) para reduzir friccao de onboard de novos clientes.
  - usar `openid-client` integrado ao Express
  - manter login por email+senha como fallback
- **Webhooks de saida** (notificar ERP/planilha corporativa quando uma comparacao e concluida).
  - esquema: assinatura HMAC, fila com retry, endpoint por empresa
- **Importacao de fornecedores em massa via planilha** (CSV/XLSX) usando `exceljs`.

### P2 - longo prazo (3-4 trimestres)

- **Integracao com ERPs** (SAP, TOTVS, Omie) - requer contrato comercial, exige auth por empresa e fila dedicada.
- **Marketplace de moedas/cambio em tempo real** (ex.: AwesomeAPI, exchangerate.host) para preencher `exchangeRate` automaticamente.
- **Notificacoes via WhatsApp Business API** para alertas de prazo de cotacao.

## Decisoes Tomadas

- Manter o `frontend` desacoplado das integracoes: integracoes entram como servicos no backend (`src/services/integrations/*`) e o frontend continua consumindo apenas `/api/v1`.
- Toda integracao nova deve oferecer "modo simulacao" para que o piloto funcione sem dependencia externa habilitada.
- Segredos de integracao via `process.env` + `.env.example` no repo. Nunca hardcoded.

## Riscos

- Custos recorrentes (SES, S3, etc.) que ainda nao estao orcados.
- Bloqueio de cronograma do piloto por dependencia externa instavel.
- LGPD: qualquer integracao precisa passar por avaliacao do DPO antes de producao.

## Criterio de Replanejamento

A ordem sera revista em revisao trimestral. Novas demandas registradas em `programa/docs/BACKLOG.md`.
