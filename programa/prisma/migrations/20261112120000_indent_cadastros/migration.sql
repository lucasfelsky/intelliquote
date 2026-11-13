-- IQ Indent PR 1 (cadastros): 3 enums e 5 tabelas Indent*. Migration ADITIVA: so CREATE TYPE/TABLE/INDEX e FKs
-- ENTRE tabelas Indent. Nenhuma FK para tabela existente, nenhum ALTER em tabela existente, sem backfill.
-- Reuso do enum existente "Incoterm" apenas como tipo de coluna.
-- Rollback (so comentario, nao executar em producao sem plano): remover as tabelas "IndentSupplierProduct",
-- "IndentClientSupplierRule", "IndentClient", "IndentSupplier" e "IndentProduct" (nessa ordem) e depois os tipos
-- "IndentSupplierRuleMode", "IndentSupplierType" e "IndentProductOrigin".

-- CreateEnum
CREATE TYPE "IndentSupplierRuleMode" AS ENUM ('LIVRE', 'APROVADOS', 'BLOQUEIO');

-- CreateEnum
CREATE TYPE "IndentSupplierType" AS ENUM ('FABRICANTE', 'TRADING', 'IMPORTADO');

-- CreateEnum
CREATE TYPE "IndentProductOrigin" AS ENUM ('CADASTRADO', 'LIVRE');

-- CreateTable
CREATE TABLE "IndentClient" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "cnpj" TEXT NOT NULL,
    "city" TEXT,
    "ownerName" TEXT,
    "pipedriveOrgId" INTEGER,
    "supplierRuleMode" "IndentSupplierRuleMode" NOT NULL DEFAULT 'LIVRE',
    "ruleReason" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IndentClient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndentClientSupplierRule" (
    "id" SERIAL NOT NULL,
    "clientId" INTEGER NOT NULL,
    "supplierId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IndentClientSupplierRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndentSupplier" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "country" TEXT,
    "contactName" TEXT,
    "type" "IndentSupplierType" NOT NULL DEFAULT 'TRADING',
    "defaultCurrency" TEXT NOT NULL DEFAULT 'USD',
    "defaultIncoterm" "Incoterm" NOT NULL DEFAULT 'CFR',
    "hasPartnership" BOOLEAN NOT NULL DEFAULT false,
    "importedFromIq" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IndentSupplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndentProduct" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "acronym" TEXT,
    "manufacturer" TEXT,
    "cas" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'kg',
    "synonyms" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "origin" "IndentProductOrigin" NOT NULL DEFAULT 'CADASTRADO',
    "sourceRequestNumber" TEXT,
    "importedFromIq" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IndentProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndentSupplierProduct" (
    "id" SERIAL NOT NULL,
    "supplierId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IndentSupplierProduct_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IndentClient_cnpj_key" ON "IndentClient"("cnpj");

-- CreateIndex
CREATE UNIQUE INDEX "IndentClient_pipedriveOrgId_key" ON "IndentClient"("pipedriveOrgId");

-- CreateIndex
CREATE INDEX "IndentClient_isActive_idx" ON "IndentClient"("isActive");

-- CreateIndex
CREATE INDEX "IndentClient_name_idx" ON "IndentClient"("name");

-- CreateIndex
CREATE INDEX "IndentClientSupplierRule_supplierId_idx" ON "IndentClientSupplierRule"("supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "IndentClientSupplierRule_clientId_supplierId_key" ON "IndentClientSupplierRule"("clientId", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "IndentSupplier_nameKey_key" ON "IndentSupplier"("nameKey");

-- CreateIndex
CREATE INDEX "IndentSupplier_isActive_idx" ON "IndentSupplier"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "IndentProduct_nameKey_key" ON "IndentProduct"("nameKey");

-- CreateIndex
CREATE INDEX "IndentProduct_isActive_idx" ON "IndentProduct"("isActive");

-- CreateIndex
CREATE INDEX "IndentProduct_origin_idx" ON "IndentProduct"("origin");

-- CreateIndex
CREATE INDEX "IndentSupplierProduct_productId_idx" ON "IndentSupplierProduct"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "IndentSupplierProduct_supplierId_productId_key" ON "IndentSupplierProduct"("supplierId", "productId");

-- AddForeignKey
ALTER TABLE "IndentClientSupplierRule" ADD CONSTRAINT "IndentClientSupplierRule_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "IndentClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IndentClientSupplierRule" ADD CONSTRAINT "IndentClientSupplierRule_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "IndentSupplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IndentSupplierProduct" ADD CONSTRAINT "IndentSupplierProduct_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "IndentSupplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IndentSupplierProduct" ADD CONSTRAINT "IndentSupplierProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "IndentProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

