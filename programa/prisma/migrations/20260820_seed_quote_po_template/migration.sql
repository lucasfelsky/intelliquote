-- Seed do template `quote_po` (Ordem de Compra, PR4) -- copia o HTML/texto
-- estatico de src/mailer/templates/quote-po.en.html para a tabela
-- EmailTemplate, para o admin poder editar via Templates.tsx sem perder o
-- conteudo atual. Idempotente: nao sobrescreve edicao do admin se a linha
-- ja existir (mesmo padrao do seed de quote_dispatch).
INSERT INTO "EmailTemplate" ("key", "locale", "subject", "htmlBody", "textBody", "updatedAt")
VALUES (
    'quote_po',
    'en',
    'Purchase Order - {{requestCode}}',
    '<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="x-apple-disable-message-reformatting" />
    <meta name="format-detection" content="telephone=no,date=no,address=no,email=no,url=no" />
    <!--[if mso]>
    <style type="text/css">
      table, td, div, h1, h2, h3, p, a { font-family: Arial, sans-serif !important; }
      .body-text { font-family: Arial, sans-serif; }
      .h1 { font-size: 20px; line-height: 26px; font-weight: bold; }
    </style>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
        <o:AllowPNG />
      </o:OfficeDocumentSettings>
    </xml>
    <![endif]-->
    <title>{{subject}}</title>
  </head>
  <body class="body-text" style="margin:0;padding:0;background-color:#F4F8F7;-webkit-text-size-adjust:100%;">
    <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#F4F8F7;">
      Purchase Order for {{requestCode}} — {{supplierContactName}}.
    </div>

    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" bgcolor="#F4F8F7" style="background-color:#F4F8F7;">
      <tr>
        <td align="center" style="padding:24px 12px;">

          <!--[if mso]>
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="600" bgcolor="#ffffff"><tr><td>
          <![endif]-->
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="640" style="width:640px;max-width:640px;background-color:#ffffff;border:1px solid #DCE9E5;" bgcolor="#ffffff">
            <!--[if mso]>
            </td></tr></table>
            <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="600"><tr><td>
            <![endif]-->

            <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" bgcolor="#184054" style="background-color:#184054;">
              <tr>
                <td align="left" style="padding:24px 32px;color:#ffffff;font-family:Arial,sans-serif;">
                  <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#5FE0BF;margin:0 0 8px 0;">
                    SQ Quimica &#183; Purchase Order
                  </div>
                  <div class="h1" style="font-size:20px;line-height:26px;font-weight:bold;color:#ffffff;margin:0;">
                    {{subject}}
                  </div>
                </td>
              </tr>
            </table>

            <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" bgcolor="#ffffff" style="background-color:#ffffff;">
              <tr>
                <td style="padding:24px 32px 8px 32px;font-family:Arial,sans-serif;font-size:15px;line-height:22px;color:#1F2933;">
                  <p style="margin:0 0 12px 0;">Dear all,</p>
                  <p style="margin:0 0 12px 0;">Attached is our PO. We look forward to receiving the PI soon.<br />Please inform estimated cargo delivery date:</p>
                  <p style="margin:0;">Please note the original BL copies should be issued at destination, please coordinate with our forwarder accordingly</p>
                </td>
              </tr>
            </table>

            <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" bgcolor="#ffffff" style="background-color:#ffffff;">
              <tr>
                <td style="padding:8px 32px 8px 32px;font-family:Arial,sans-serif;font-size:15px;line-height:22px;color:#1F2933;">
                  <p style="margin:0 0 8px 0;font-weight:bold;">SHIPPING INSTRUCTION:</p>
                  <p style="margin:0 0 8px 0;">LABEL: Consider small labels and neutral package with the description according to our PO.</p>
                  <p style="margin:0;">PALLETS: Goods must be sent on pallets. Consider using processed wooden pallet, plastic pallet or treated and certificate (with stamp and original certificate in English). If you cannot provide pallet, please ask the agent to do so.<br />*Pallets size must have no more than 112CM in order to be loaded on a 40''NOR.</p>
                </td>
              </tr>
            </table>

            <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" bgcolor="#ffffff" style="background-color:#ffffff;">
              <tr>
                <td style="padding:8px 32px 8px 32px;font-family:Arial,sans-serif;font-size:15px;line-height:22px;color:#1F2933;">
                  <p style="margin:0 0 8px 0;font-weight:bold;">SHIPPING DOCUMENTS:</p>
                  <p style="margin:0 0 8px 0;">Please make sure to include all the data below on both Invoice and Packing list;</p>
                  <ul style="margin:0;padding-left:18px;">
                    <li>SQ QUIMICA''s complete information including tax number: CNPJ: 14.111.367/0001-97;</li>
                    <li>SQ QUIMICA''s Internal Product Code followed by Product Description on the Invoice according to our PO;</li>
                    <li>Exporter''s TAX ID/TIN NUMBER must be mentioned on shipper''s info;</li>
                    <li>Port of Destination: as agreed.</li>
                    <li>CBM; N.W and G.W per Package and TOTAL; Pallet Weight;</li>
                    <li>Quantity of pallets and packages with description (Pallets and other types: Bags, drums, etc.);</li>
                    <li>HS CODE/NCM (according to our PO);</li>
                    <li>Manufacturer information (If same as exporter, please inform it on the Invoice) including TAX ID/TIN NUMBER;</li>
                    <li>Country of Origin, Acquisition and Provenance;</li>
                    <li>Bank Info: Swift Code, Bank Address and Beneficiary IS MANDATORY ON INVOICE</li>
                  </ul>
                </td>
              </tr>
            </table>

            <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" bgcolor="#ffffff" style="background-color:#ffffff;">
              <tr>
                <td style="padding:8px 32px 8px 32px;font-family:Arial,sans-serif;font-size:15px;line-height:22px;color:#1F2933;">
                  <p style="margin:0 0 8px 0;font-weight:bold;">CERTIFICATE OF ANALYSIS.</p>
                  <p style="margin:0 0 8px 0;">Please make sure to include all the data below on every COA;</p>
                  <ul style="margin:0;padding-left:18px;">
                    <li>Product''s name according to INVOICE;</li>
                    <li>Batches/Lot numbers;</li>
                    <li>Shipped quantity for every Batch/Lot;</li>
                    <li>Manufacturing date and Expiring/Validity date</li>
                    <li>All data must be digital (handwritten will no longer be accepted).</li>
                  </ul>
                </td>
              </tr>
            </table>

            <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" bgcolor="#ffffff" style="background-color:#ffffff;">
              <tr>
                <td style="padding:8px 32px 16px 32px;font-family:Arial,sans-serif;font-size:15px;line-height:22px;color:#1F2933;">
                  <p style="margin:0 0 12px 0;">Port of Destination: NAVEGANTES, BRAZIL.<br />*FCL: ITAPOA, BRAZIL.</p>
                  <p style="margin:0 0 6px 0;">Here below is the forwarder''s contact info:</p>
                  <p style="margin:0;">{{forwarderInfo}}</p>
                </td>
              </tr>
            </table>

            <!--CUSTOM_MESSAGE_SLOT-->

            <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" bgcolor="#ffffff" style="background-color:#ffffff;">
              <tr>
                <td style="padding:0 32px 24px 32px;font-family:Arial,sans-serif;font-size:11px;line-height:16px;color:#7A848C;border-top:1px solid #DCE9E5;padding-top:12px;">
                  <p style="margin:0;">PO reference: {{requestCode}}</p>
                </td>
              </tr>
            </table>

          </table>

        </td>
      </tr>
    </table>
  </body>
</html>',
    'Dear all,

Attached is our PO. We look forward to receiving the PI soon.
Please inform estimated cargo delivery date:

Please note the original BL copies should be issued at destination, please coordinate with our forwarder accordingly

SHIPPING INSTRUCTION:
LABEL: Consider small labels and neutral package with the description according to our PO.
PALLETS: Goods must be sent on pallets. Consider using processed wooden pallet, plastic pallet or treated and certificate (with stamp and original certificate in English). If you cannot provide pallet, please ask the agent to do so.
*Pallets size must have no more than 112CM in order to be loaded on a 40''NOR.

SHIPPING DOCUMENTS:
Please make sure to include all the data below on both Invoice and Packing list;

- SQ QUIMICA''s complete information including tax number: CNPJ: 14.111.367/0001-97;
- SQ QUIMICA''s Internal Product Code followed by Product Description on the Invoice according to our PO;
- Exporter''s TAX ID/TIN NUMBER must be mentioned on shipper''s info;
- Port of Destination: as agreed.
- CBM; N.W and G.W per Package and TOTAL; Pallet Weight;
- Quantity of pallets and packages with description (Pallets and other types: Bags, drums, etc.);
- HS CODE/NCM (according to our PO);
- Manufacturer information (If same as exporter, please inform it on the Invoice) including TAX ID/TIN NUMBER;
- Country of Origin, Acquisition and Provenance;
- Bank Info: Swift Code, Bank Address and Beneficiary IS MANDATORY ON INVOICE

CERTIFICATE OF ANALYSIS.
Please make sure to include all the data below on every COA;

- Product''s name according to INVOICE;
- Batches/Lot numbers;
- Shipped quantity for every Batch/Lot;
- Manufacturing date and Expiring/Validity date
- All data must be digital (handwritten will no longer be accepted).

Port of Destination: NAVEGANTES, BRAZIL.
*FCL: ITAPOA, BRAZIL.

Here below is the forwarder''s contact info:
{{forwarderInfoText}}

PO reference: {{requestCode}}',
    CURRENT_TIMESTAMP
) ON CONFLICT ("key", "locale") DO NOTHING;
