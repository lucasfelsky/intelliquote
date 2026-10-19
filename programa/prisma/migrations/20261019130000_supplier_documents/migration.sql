-- Aditiva: nenhuma tabela existente e alterada (so CREATE TABLE/INDEX e FKs nas tabelas novas).

-- CreateTable
CREATE TABLE "SupplierDocument" (
    "id" SERIAL NOT NULL,
    "supplierId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "expiresOn" DATE NOT NULL,
    "notes" TEXT,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "alertCycle" INTEGER NOT NULL DEFAULT 1,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "SupplierDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierDocumentFile" (
    "documentId" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,

    CONSTRAINT "SupplierDocumentFile_pkey" PRIMARY KEY ("documentId")
);

-- CreateIndex
CREATE INDEX "SupplierDocument_supplierId_idx" ON "SupplierDocument"("supplierId");

-- CreateIndex
CREATE INDEX "SupplierDocument_expiresOn_idx" ON "SupplierDocument"("expiresOn");

-- CreateIndex
CREATE INDEX "SupplierDocument_createdById_idx" ON "SupplierDocument"("createdById");

-- CreateIndex
CREATE INDEX "SupplierDocument_deletedAt_idx" ON "SupplierDocument"("deletedAt");

-- AddForeignKey
ALTER TABLE "SupplierDocument" ADD CONSTRAINT "SupplierDocument_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierDocument" ADD CONSTRAINT "SupplierDocument_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierDocumentFile" ADD CONSTRAINT "SupplierDocumentFile_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "SupplierDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
