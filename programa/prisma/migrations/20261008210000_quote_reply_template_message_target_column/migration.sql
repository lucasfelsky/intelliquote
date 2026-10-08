-- Leva a mensagem do modal "Responder" (logo apos "Dear ...,") e a coluna TARGET PRICE
-- para o template `quote_reply` que vive no BANCO (se alguem o salvou na tela Templates).
-- So UPDATEs guardados e idempotentes: cada um so atua se o placeholder AINDA NAO
-- existe e se a ancora esperada esta presente. Template customizado sem as ancoras
-- fica intacto (o renderer cobre esse caso no modo legado). Sem DDL.
-- Nao remove o marcador <!--CUSTOM_MESSAGE_SLOT--> nem o bloco {{#targetPriceStr}}:
-- o renderer neutraliza os dois quando o template ja tem os placeholders novos.

-- H1: {{message}} logo apos o paragrafo "Dear ...,".
UPDATE "EmailTemplate"
SET "htmlBody" = regexp_replace("htmlBody", '(<p[^>]*>\s*Dear[^<]*</p>)', '\1{{message}}')
WHERE "key"='quote_reply' AND "locale"='en'
  AND "htmlBody" NOT LIKE '%{{message}}%'
  AND "htmlBody" ~ '<p[^>]*>\s*Dear[^<]*</p>';

-- H2: o <tr> do <thead> vira {{itemsHeaderRow}} (cabecalho gerado em codigo, junto com
-- as linhas). So se as linhas sao dinamicas ({{itemsRows}}) e o thead tem exatamente
-- os 5 <th> padrao (ITEM, INCOTERM, QUANTITY, UNIT PRICE, TOTAL); corpo com linhas
-- congeladas fica intacto.
UPDATE "EmailTemplate"
SET "htmlBody" = regexp_replace(
  "htmlBody",
  '<thead>\s*<tr[^>]*>\s*<th[^>]*>\s*ITEM\s*</th>\s*<th[^>]*>\s*INCOTERM\s*</th>\s*<th[^>]*>\s*QUANTITY\s*</th>\s*<th[^>]*>\s*UNIT PRICE\s*</th>\s*<th[^>]*>\s*TOTAL\s*</th>\s*</tr>\s*</thead>',
  '<thead>{{itemsHeaderRow}}</thead>'
)
WHERE "key"='quote_reply' AND "locale"='en'
  AND "htmlBody" NOT LIKE '%{{itemsHeaderRow}}%'
  AND "htmlBody" LIKE '%{{itemsRows}}%'
  AND "htmlBody" ~ '<thead>\s*<tr[^>]*>\s*<th[^>]*>\s*ITEM\s*</th>\s*<th[^>]*>\s*INCOTERM\s*</th>\s*<th[^>]*>\s*QUANTITY\s*</th>\s*<th[^>]*>\s*UNIT PRICE\s*</th>\s*<th[^>]*>\s*TOTAL\s*</th>\s*</tr>\s*</thead>';

-- T1: {{messageText}} logo apos a saudacao no corpo texto puro.
UPDATE "EmailTemplate"
SET "textBody" = regexp_replace("textBody", '(Dear[^\r\n]*(\r?\n){2})', '\1{{messageText}}')
WHERE "key"='quote_reply' AND "locale"='en'
  AND "textBody" NOT LIKE '%{{messageText}}%'
  AND "textBody" ~ 'Dear[^\r\n]*(\r?\n){2}';
