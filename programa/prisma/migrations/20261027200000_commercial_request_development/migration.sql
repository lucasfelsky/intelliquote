-- Aditiva e idempotente: solicitacao de desenvolvimento (item novo sem catalogo) e anexos tecnicos (TDS/MSDS).
-- Sem backfill e sem apagar dados. Reversao segura enquanto nao houver item novo gravado: ver PLAN.md (Riscos).

-- Flags de desenvolvimento
ALTER TABLE "CommercialRequest" ADD COLUMN IF NOT EXISTS "isDevelopment" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "QuoteRequest" ADD COLUMN IF NOT EXISTS "isDevelopment" BOOLEAN NOT NULL DEFAULT false;

-- Item novo (sem catalogo): catalogItemId passa a aceitar NULL (DROP NOT NULL e idempotente)
ALTER TABLE "CommercialRequestItem" ALTER COLUMN "catalogItemId" DROP NOT NULL;
ALTER TABLE "CommercialRequestItem" ADD COLUMN IF NOT EXISTS "proposedName" TEXT;
ALTER TABLE "CommercialRequestItem" ADD COLUMN IF NOT EXISTS "proposedNameKey" TEXT;
ALTER TABLE "CommercialRequestItem" ADD COLUMN IF NOT EXISTS "notes" TEXT;

-- Todo item tem catalogo OU nome proposto (ADD CONSTRAINT nao tem IF NOT EXISTS: guarda por duplicate_object)
DO $$ BEGIN
  ALTER TABLE "CommercialRequestItem" ADD CONSTRAINT "CommercialRequestItem_catalog_or_proposed_check"
    CHECK ("catalogItemId" IS NOT NULL OR "proposedName" IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- Mesmo item novo nao se repete na mesma solicitacao (indice parcial: fica so na migration, como SupplierContact_single_primary_per_supplier)
CREATE UNIQUE INDEX IF NOT EXISTS "CommercialRequestItem_commercialRequestId_proposedNameKey_key"
  ON "CommercialRequestItem"("commercialRequestId", "proposedNameKey") WHERE "proposedNameKey" IS NOT NULL;

-- Anexos tecnicos (metadados)
CREATE TABLE IF NOT EXISTS "CommercialRequestAttachment" (
    "id" SERIAL NOT NULL,
    "commercialRequestId" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "uploadedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CommercialRequestAttachment_pkey" PRIMARY KEY ("id")
);

-- Bytes em tabela separada (lista nunca carrega bytea), como SupplierDocumentFile
CREATE TABLE IF NOT EXISTS "CommercialRequestAttachmentFile" (
    "attachmentId" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    CONSTRAINT "CommercialRequestAttachmentFile_pkey" PRIMARY KEY ("attachmentId")
);

CREATE INDEX IF NOT EXISTS "CommercialRequestAttachment_commercialRequestId_idx" ON "CommercialRequestAttachment"("commercialRequestId");
CREATE INDEX IF NOT EXISTS "CommercialRequestAttachment_uploadedById_idx" ON "CommercialRequestAttachment"("uploadedById");
CREATE UNIQUE INDEX IF NOT EXISTS "CommercialRequestAttachment_commercialRequestId_sha256_key" ON "CommercialRequestAttachment"("commercialRequestId", "sha256");

DO $$ BEGIN
  ALTER TABLE "CommercialRequestAttachment" ADD CONSTRAINT "CommercialRequestAttachment_kind_check"
    CHECK ("kind" IN ('TDS', 'MSDS', 'OUTRO'));
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "CommercialRequestAttachment" ADD CONSTRAINT "CommercialRequestAttachment_commercialRequestId_fkey" FOREIGN KEY ("commercialRequestId") REFERENCES "CommercialRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "CommercialRequestAttachment" ADD CONSTRAINT "CommercialRequestAttachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "CommercialRequestAttachmentFile" ADD CONSTRAINT "CommercialRequestAttachmentFile_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "CommercialRequestAttachment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
