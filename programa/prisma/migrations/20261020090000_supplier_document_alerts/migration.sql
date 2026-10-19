-- Aditiva: so CREATE TABLE/INDEX e FK na tabela nova; nenhuma tabela existente e alterada.

-- CreateTable
CREATE TABLE "SupplierDocumentAlert" (
    "id" SERIAL NOT NULL,
    "documentId" INTEGER NOT NULL,
    "alertCycle" INTEGER NOT NULL,
    "milestone" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'claimed',
    "runId" TEXT NOT NULL,
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "SupplierDocumentAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupplierDocumentAlert_documentId_alertCycle_milestone_key" ON "SupplierDocumentAlert"("documentId", "alertCycle", "milestone");

-- CreateIndex
CREATE INDEX "SupplierDocumentAlert_status_claimedAt_idx" ON "SupplierDocumentAlert"("status", "claimedAt");

-- CreateIndex
CREATE INDEX "SupplierDocumentAlert_runId_idx" ON "SupplierDocumentAlert"("runId");

-- AddForeignKey
ALTER TABLE "SupplierDocumentAlert" ADD CONSTRAINT "SupplierDocumentAlert_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "SupplierDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
