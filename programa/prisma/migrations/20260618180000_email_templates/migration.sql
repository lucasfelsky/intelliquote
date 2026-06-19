-- Armazena templates de e-mail editaveis pelo painel administrativo.
-- Substituem o HTML estatico em src/mailer/templates/quote-dispatch.en.html.
CREATE TABLE IF NOT EXISTS "EmailTemplate" (
    "id"          SERIAL PRIMARY KEY,
    "key"         TEXT NOT NULL,
    "locale"      TEXT NOT NULL DEFAULT 'en',
    "subject"     TEXT NOT NULL,
    "htmlBody"    TEXT NOT NULL,
    "textBody"    TEXT NOT NULL,
    "isActive"    BOOLEAN NOT NULL DEFAULT true,
    "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedById" INTEGER REFERENCES "User"("id") ON DELETE SET NULL,
    UNIQUE ("key", "locale")
);

-- Seed inicial: copia o template estatico para a tabela para que o admin
-- possa edita-lo via UI sem perder o conteudo atual.
INSERT INTO "EmailTemplate" ("key", "locale", "subject", "htmlBody", "textBody", "updatedAt")
VALUES (
    'quote_dispatch',
    'en',
    'Sourcing request {{requestCode}} - {{productName}}',
    '<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{{subject}}</title>
  </head>
  <body style="margin:0;padding:0;background:#F4F8F7;font-family:Helvetica Neue,Arial,sans-serif;color:#0E1B26;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F8F7;padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 8px 28px rgba(0,40,40,0.08);">
          <tr><td style="background:linear-gradient(135deg,#184054 0%,#133848 100%);padding:28px 32px;color:#ffffff;">
            <div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#5FE0BF;margin-bottom:6px;">SQ Quimica &middot; Sourcing Request</div>
            <div style="font-size:22px;font-weight:600;line-height:1.3;">{{subject}}</div>
          </td></tr>
          <tr><td style="padding:28px 32px 8px 32px;">
            <p style="margin:0 0 12px 0;font-size:15px;line-height:1.55;">Dear <strong>{{supplierContactName}}</strong>,</p>
            <p style="margin:0 0 12px 0;font-size:15px;line-height:1.55;">We are contacting you on behalf of <strong>{{companyName}}</strong> regarding sourcing request <strong>{{requestCode}}</strong> for <strong>{{productName}}</strong> ({{quantity}} {{unit}}).</p>
            <p style="margin:0 0 18px 0;font-size:14px;line-height:1.55;color:#4A5560;"><strong>Please note:</strong> this link is unique to you. It is bound to your contact and to this specific request. Please do not share it with third parties.</p>
          </td></tr>
          <tr><td style="padding:0 32px 18px 32px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;">
              <thead><tr style="background:#F8FBFA;">
                <th align="left" style="padding:10px 12px;border-bottom:1px solid #DCE9E5;color:#4A5560;font-weight:600;">Code</th>
                <th align="left" style="padding:10px 12px;border-bottom:1px solid #DCE9E5;color:#4A5560;font-weight:600;">Product</th>
                <th align="right" style="padding:10px 12px;border-bottom:1px solid #DCE9E5;color:#4A5560;font-weight:600;">Qty</th>
                <th align="right" style="padding:10px 12px;border-bottom:1px solid #DCE9E5;color:#4A5560;font-weight:600;">Target price</th>
              </tr></thead>
              <tbody>{{itemsRows}}</tbody>
            </table>
          </td></tr>
          <tr><td style="padding:0 32px;">
            <div style="text-align:center;margin:18px 0 8px 0;">
              <a href="{{portalLink}}" style="display:inline-block;background:linear-gradient(135deg,#184054 0%,#133848 100%);color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:14px 32px;border-radius:999px;">Submit your proposal</a>
            </div>
            <p style="text-align:center;font-size:12px;color:#4A5560;margin:8px 0 18px 0;">Or copy and paste this link into your browser:<br /><a href="{{portalLink}}" style="color:#00AE91;word-break:break-all;">{{portalLink}}</a></p>
          </td></tr>
          <tr><td style="padding:18px 32px 8px 32px;">
            <div style="font-size:12px;text-transform:uppercase;letter-spacing:1.5px;color:#00AE91;font-weight:600;padding-bottom:8px;">Buyer contact</div>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F8FBFA;border:1px solid #DCE9E5;border-radius:14px;padding:14px 18px;font-size:13px;line-height:1.55;margin-bottom:8px;"><tr><td>
              <strong>{{companyName}}</strong>{{#tradeName}}<br /><span style="color:#4A5560;">{{tradeName}}</span>{{/tradeName}}<br />
              {{#taxId}}<span style="color:#4A5560;">Tax ID:</span> {{taxId}}<br />{{/taxId}}
              {{#addressLine1}}{{addressLine1}}{{/addressLine1}}{{#addressLine2}}, {{addressLine2}}{{/addressLine2}}<br />
              {{#city}}{{city}}{{/city}}{{#state}} / {{state}}{{/state}}{{#postalCode}} &middot; {{postalCode}}{{/postalCode}}{{#country}} &middot; {{country}}{{/country}}<br />
              <span style="color:#4A5560;">Purchasing:</span> <a href="mailto:{{purchasingEmail}}" style="color:#00AE91;">{{purchasingEmail}}</a>{{#purchasingPhone}} &middot; {{purchasingPhone}}{{/purchasingPhone}}
            </td></tr></table>
          </td></tr>
          <tr><td style="padding:8px 32px 28px 32px;font-size:11px;color:#7A848C;line-height:1.5;">
            <p style="margin:0 0 6px 0;">This message and any attachments are confidential and intended solely for the addressee. If you have received it in error, please notify the sender and delete the message.</p>
            <p style="margin:0;">Request reference: {{requestCode}}</p>
            <!--CUSTOM_MESSAGE_SLOT-->
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>',
    'Sourcing request {{requestCode}} - {{productName}}

Dear {{supplierContactName}},

We are contacting you on behalf of {{companyName}} regarding sourcing request {{requestCode}}.
Product: {{productName}} | Qty: {{quantity}} {{unit}} | Incoterm: {{desiredIncoterm}} | Currency: {{currency}}
Response deadline: {{deadlineAt}}
Link expires on: {{expiresAt}}

Items:
{{itemsText}}

Submit your proposal: {{portalLink}}

Buyer contact: {{companyName}} <{{purchasingEmail}}>

This message is confidential and intended solely for the addressee.',
    CURRENT_TIMESTAMP
) ON CONFLICT ("key", "locale") DO NOTHING;
