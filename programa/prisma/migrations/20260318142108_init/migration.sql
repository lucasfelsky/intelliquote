-- CreateEnum
CREATE TYPE "QuoteRequestStatus" AS ENUM ('open', 'closed');

-- CreateEnum
CREATE TYPE "Incoterm" AS ENUM ('EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP');

-- CreateTable
CREATE TABLE "Supplier" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "website" TEXT,
    "acceptedIncoterms" "Incoterm"[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteRequest" (
    "id" SERIAL NOT NULL,
    "productName" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "desiredIncoterm" "Incoterm" NOT NULL,
    "status" "QuoteRequestStatus" NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuoteRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteResponse" (
    "id" SERIAL NOT NULL,
    "quoteRequestId" INTEGER NOT NULL,
    "supplierId" INTEGER NOT NULL,
    "offeredPrice" DECIMAL(12,2) NOT NULL,
    "offeredIncoterm" "Incoterm" NOT NULL,
    "paymentTermsDays" INTEGER NOT NULL,
    "isWinner" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuoteResponse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_email_key" ON "Supplier"("email");

-- CreateIndex
CREATE INDEX "QuoteResponse_quoteRequestId_idx" ON "QuoteResponse"("quoteRequestId");

-- CreateIndex
CREATE INDEX "QuoteResponse_supplierId_idx" ON "QuoteResponse"("supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteResponse_quoteRequestId_supplierId_key" ON "QuoteResponse"("quoteRequestId", "supplierId");

-- AddForeignKey
ALTER TABLE "QuoteResponse" ADD CONSTRAINT "QuoteResponse_quoteRequestId_fkey" FOREIGN KEY ("quoteRequestId") REFERENCES "QuoteRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteResponse" ADD CONSTRAINT "QuoteResponse_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
