-- Aditiva e idempotente: documento do fornecedor sem vencimento (ex.: certificados sem validade).
-- DROP NOT NULL e idempotente; sem backfill e sem apagar dados.
-- Reversao so e segura enquanto nao houver documento sem vencimento gravado (SET NOT NULL falharia).
ALTER TABLE "SupplierDocument" ALTER COLUMN "expiresOn" DROP NOT NULL;
