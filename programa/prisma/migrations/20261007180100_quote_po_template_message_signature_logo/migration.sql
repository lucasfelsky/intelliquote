-- Leva o logo da SQ, a mensagem do modal (logo apos "Dear all,") e a assinatura do
-- usuario para o template `quote_po` (Ordem de Compra) que vive no BANCO.
-- So UPDATEs guardados e idempotentes: cada um so atua se o placeholder AINDA NAO
-- existe e se a ancora esperada esta presente. Template customizado sem as
-- ancoras fica intacto (a regra de compatibilidade do renderer cobre esse caso).

-- H1: {{message}} logo apos o paragrafo "Dear all,".
UPDATE "EmailTemplate"
SET "htmlBody" = regexp_replace("htmlBody", '(<p[^>]*>\s*Dear[^<]*</p>)', '\1{{message}}')
WHERE "key"='quote_po' AND "locale"='en'
  AND "htmlBody" NOT LIKE '%{{message}}%'
  AND "htmlBody" ~ '<p[^>]*>\s*Dear[^<]*</p>';

-- H2: o marcador <!--CUSTOM_MESSAGE_SLOT--> vira {{senderSignature}}. So se a mensagem
-- ja tem placeholder proprio ({{message}}) - senao a mensagem perderia o lugar.
UPDATE "EmailTemplate"
SET "htmlBody" = REPLACE("htmlBody", '<!--CUSTOM_MESSAGE_SLOT-->', '{{senderSignature}}')
WHERE "key"='quote_po' AND "locale"='en'
  AND "htmlBody" LIKE '%<!--CUSTOM_MESSAGE_SLOT-->%'
  AND "htmlBody" LIKE '%{{message}}%'
  AND "htmlBody" NOT LIKE '%{{senderSignature}}%';

-- H3: {{companyLogo}} antes do eyebrow "SQ Quimica - Purchase Order" do cabecalho.
UPDATE "EmailTemplate"
SET "htmlBody" = regexp_replace("htmlBody", '(<div[^>]*>\s*SQ Quimica (&#183;|·) Purchase Order)', '{{companyLogo}}\1')
WHERE "key"='quote_po' AND "locale"='en'
  AND "htmlBody" NOT LIKE '%{{companyLogo}}%'
  AND "htmlBody" ~ '<div[^>]*>\s*SQ Quimica (&#183;|·) Purchase Order';

-- T1: {{messageText}} logo apos a saudacao no corpo texto puro.
UPDATE "EmailTemplate"
SET "textBody" = regexp_replace("textBody", '(Dear[^\r\n]*(\r?\n){2})', '\1{{messageText}}')
WHERE "key"='quote_po' AND "locale"='en'
  AND "textBody" NOT LIKE '%{{messageText}}%'
  AND "textBody" ~ 'Dear[^\r\n]*(\r?\n){2}';

-- T2: {{senderSignatureText}} antes de "PO reference:" no corpo texto puro.
UPDATE "EmailTemplate"
SET "textBody" = regexp_replace("textBody", '((\r?\n){2})(PO reference: )', '\1{{senderSignatureText}}\3')
WHERE "key"='quote_po' AND "locale"='en'
  AND "textBody" NOT LIKE '%{{senderSignatureText}}%'
  AND "textBody" ~ '(\r?\n){2}PO reference: ';
