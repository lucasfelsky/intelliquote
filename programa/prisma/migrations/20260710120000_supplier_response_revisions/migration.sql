-- Permite que o fornecedor revise o preco de uma resposta ja enviada,
-- sobrescrevendo a resposta corrente e preservando as versoes anteriores.
--
-- 1) Contador de versao na resposta corrente (default 1 para linhas existentes).
ALTER TABLE "SupplierPortalResponse"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

-- 2) Historico append-only de versoes anteriores (itens serializados em JSON).
CREATE TABLE "SupplierPortalResponseRevision" (
  "id" SERIAL NOT NULL,
  "portalTokenId" INTEGER NOT NULL,
  "version" INTEGER NOT NULL,
  "currency" TEXT NOT NULL,
  "incoterm" "Incoterm" NOT NULL,
  "paymentTermsDays" INTEGER NOT NULL,
  "totalPrice" DECIMAL(14,2) NOT NULL,
  "totalPriceCurrency" TEXT NOT NULL,
  "validityDays" INTEGER NOT NULL,
  "notes" TEXT,
  "items" JSONB NOT NULL,
  "submittedAt" TIMESTAMP(3) NOT NULL,
  "supersededAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupplierPortalResponseRevision_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SupplierPortalResponseRevision_portalTokenId_idx"
  ON "SupplierPortalResponseRevision"("portalTokenId");

CREATE INDEX "SupplierPortalResponseRevision_supersededAt_idx"
  ON "SupplierPortalResponseRevision"("supersededAt");

ALTER TABLE "SupplierPortalResponseRevision"
  ADD CONSTRAINT "SupplierPortalResponseRevision_portalTokenId_fkey"
  FOREIGN KEY ("portalTokenId") REFERENCES "SupplierPortalToken"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
