-- IQ Indent PR 2 (solicitacoes): 3 enums e 5 tabelas Indent*. Migration ADITIVA: so CREATE TYPE/TABLE/INDEX e FKs
-- ENTRE tabelas Indent (IndentRequest -> IndentClient, IndentRequestItem -> IndentProduct, IndentQuote -> IndentSupplier).
-- Nenhuma FK para tabela do IQ principal, nenhum ALTER em tabela existente, sem backfill. createdById/exceptionById sem FK.
-- Reuso do enum existente "Incoterm" apenas como tipo de coluna.
-- Rollback (so comentario, nao executar em producao sem plano): remover as tabelas "IndentQuoteItem", "IndentQuote",
-- "IndentRequestItem", "IndentRequest" e "IndentSequence" (nessa ordem) e depois os tipos "IndentRequestOrigin",
-- "IndentRequestStatus" e "IndentQuoteStatus".

-- CreateEnum
CREATE TYPE "IndentRequestOrigin" AS ENUM ('PIPEDRIVE', 'IQ_INDENT');

-- CreateEnum
CREATE TYPE "IndentRequestStatus" AS ENUM ('NOVA', 'COTACAO', 'RESPONDIDA', 'CONVERTIDA', 'PERDIDA');

-- CreateEnum
CREATE TYPE "IndentQuoteStatus" AS ENUM ('RASCUNHO', 'ENVIADA', 'RESPONDIDA', 'ACEITA', 'RECUSADA', 'REVISADA');

-- CreateTable
CREATE TABLE "IndentSequence" (
    "year" INTEGER NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IndentSequence_pkey" PRIMARY KEY ("year")
);

-- CreateTable
CREATE TABLE "IndentRequest" (
    "id" SERIAL NOT NULL,
    "processNumber" TEXT NOT NULL,
    "processYear" INTEGER NOT NULL,
    "processSeq" INTEGER NOT NULL,
    "origin" "IndentRequestOrigin" NOT NULL,
    "pipedriveDealId" INTEGER,
    "dealTitle" TEXT,
    "clientId" INTEGER,
    "ownerName" TEXT NOT NULL,
    "status" "IndentRequestStatus" NOT NULL DEFAULT 'NOVA',
    "statusChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stageEnteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rawNote" TEXT,
    "dealType" TEXT,
    "createdById" INTEGER,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IndentRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndentRequestItem" (
    "id" SERIAL NOT NULL,
    "requestId" INTEGER NOT NULL,
    "productId" INTEGER,
    "description" TEXT NOT NULL,
    "quantityKg" DECIMAL(14,3) NOT NULL,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IndentRequestItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndentQuote" (
    "id" SERIAL NOT NULL,
    "requestId" INTEGER NOT NULL,
    "supplierId" INTEGER NOT NULL,
    "status" "IndentQuoteStatus" NOT NULL DEFAULT 'RASCUNHO',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "currency" TEXT NOT NULL,
    "incoterm" "Incoterm" NOT NULL,
    "destination" TEXT,
    "exceptionReason" TEXT,
    "exceptionById" INTEGER,
    "exceptionByName" TEXT,
    "exceptionAt" TIMESTAMP(3),
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IndentQuote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndentQuoteItem" (
    "id" SERIAL NOT NULL,
    "quoteId" INTEGER NOT NULL,
    "requestItemId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IndentQuoteItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IndentRequest_processNumber_key" ON "IndentRequest"("processNumber");

-- CreateIndex
CREATE UNIQUE INDEX "IndentRequest_pipedriveDealId_key" ON "IndentRequest"("pipedriveDealId");

-- CreateIndex
CREATE INDEX "IndentRequest_status_idx" ON "IndentRequest"("status");

-- CreateIndex
CREATE INDEX "IndentRequest_clientId_idx" ON "IndentRequest"("clientId");

-- CreateIndex
CREATE INDEX "IndentRequest_origin_idx" ON "IndentRequest"("origin");

-- CreateIndex
CREATE INDEX "IndentRequest_createdAt_idx" ON "IndentRequest"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "IndentRequest_processYear_processSeq_key" ON "IndentRequest"("processYear", "processSeq");

-- CreateIndex
CREATE INDEX "IndentRequestItem_requestId_idx" ON "IndentRequestItem"("requestId");

-- CreateIndex
CREATE INDEX "IndentRequestItem_productId_idx" ON "IndentRequestItem"("productId");

-- CreateIndex
CREATE INDEX "IndentQuote_supplierId_idx" ON "IndentQuote"("supplierId");

-- CreateIndex
CREATE INDEX "IndentQuote_status_idx" ON "IndentQuote"("status");

-- CreateIndex
CREATE UNIQUE INDEX "IndentQuote_requestId_supplierId_revision_key" ON "IndentQuote"("requestId", "supplierId", "revision");

-- CreateIndex
CREATE INDEX "IndentQuoteItem_requestItemId_idx" ON "IndentQuoteItem"("requestItemId");

-- CreateIndex
CREATE UNIQUE INDEX "IndentQuoteItem_quoteId_requestItemId_key" ON "IndentQuoteItem"("quoteId", "requestItemId");

-- AddForeignKey
ALTER TABLE "IndentRequest" ADD CONSTRAINT "IndentRequest_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "IndentClient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IndentRequestItem" ADD CONSTRAINT "IndentRequestItem_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "IndentRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IndentRequestItem" ADD CONSTRAINT "IndentRequestItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "IndentProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IndentQuote" ADD CONSTRAINT "IndentQuote_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "IndentRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IndentQuote" ADD CONSTRAINT "IndentQuote_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "IndentSupplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IndentQuoteItem" ADD CONSTRAINT "IndentQuoteItem_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "IndentQuote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IndentQuoteItem" ADD CONSTRAINT "IndentQuoteItem_requestItemId_fkey" FOREIGN KEY ("requestItemId") REFERENCES "IndentRequestItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
