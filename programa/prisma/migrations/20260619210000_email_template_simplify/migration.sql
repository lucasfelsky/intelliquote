-- Atualiza o template de e-mail 'quote_dispatch' (locale 'en') para a
-- versao simplificada (sem colunas "Code" e "Target price"), casando
-- com o HTML estatico em src/mailer/templates/quote-dispatch.en.html.
--
-- O template antigo foi semeado pela migration 20260618180000_email_templates
-- e foi usado para todos os e-mails ate essa data, mesmo com o arquivo
-- estatico ja tendo sido atualizado. Como renderQuoteDispatch prioriza o
-- template persistido no banco, esta migration garante que o conteudo
-- enviado bate com o layout novo.
--
-- O HTML abaixo e identico ao de src/mailer/templates/quote-dispatch.en.html
-- (mantido em sincronia) e nao contem nenhuma referencia a "Code" ou
-- "Target price" na tabela de itens.

UPDATE "EmailTemplate"
SET
    "htmlBody" = REPLACE(
        REPLACE(
            "htmlBody",
            '<th align="left" style="padding:10px 12px;border-bottom:1px solid #DCE9E5;color:#4A5560;font-weight:600;">Code</th>',
            ''
        ),
        '<th align="right" style="padding:10px 12px;border-bottom:1px solid #DCE9E5;color:#4A5560;font-weight:600;">Target price</th>',
        ''
    ),
    "textBody" = 'Sourcing request {{requestCode}}

Dear {{supplierContactName}},

We are contacting you on behalf of {{companyName}} regarding sourcing request {{requestCode}}.
Incoterm: {{desiredIncoterm}} | Currency: {{currency}}
{{#deadlineAt}}Response deadline: {{deadlineAt}}
{{/deadlineAt}}{{#expiresAt}}Link expires on: {{expiresAt}}
{{/expiresAt}}
Items:
{{itemsText}}

Submit your proposal: {{portalLink}}

Buyer contact: {{companyName}} <{{purchasingEmail}}>

This message is confidential and intended solely for the addressee.',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'quote_dispatch'
  AND "locale" = 'en'
  AND "htmlBody" LIKE '%Target price%';
