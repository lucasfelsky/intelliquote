-- AlterTable
ALTER TABLE "SupplierPortalTokenLog" ADD COLUMN     "creditSupportRequestId" INTEGER;

-- CreateTable
CREATE TABLE "CreditSupportRequest" (
    "id" SERIAL NOT NULL,
    "quoteRequestId" INTEGER NOT NULL,
    "quoteResponseId" INTEGER NOT NULL,
    "supplierId" INTEGER NOT NULL,
    "creditPartnerId" INTEGER NOT NULL,
    "creditPartnerContactId" INTEGER,
    "recipientEmails" TEXT NOT NULL DEFAULT '[]',
    "emailSubject" TEXT NOT NULL,
    "emailMessage" TEXT,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "firstSeenAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "accessCount" INTEGER NOT NULL DEFAULT 0,
    "sourceResponseVersion" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "offeredIncoterm" "Incoterm" NOT NULL,
    "originalPaymentTermsDays" INTEGER NOT NULL,
    "originalTotalPrice" DECIMAL(14,2) NOT NULL,
    "originPort" TEXT,
    "respondedAt" TIMESTAMP(3),
    "responseVersion" INTEGER NOT NULL DEFAULT 0,
    "partnerPaymentTermsDays" INTEGER,
    "partnerValidityDays" INTEGER,
    "partnerNotes" TEXT,
    "partnerTotalPrice" DECIMAL(14,2),
    "submitterIp" TEXT,
    "submitterUserAgent" TEXT,
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditSupportRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditSupportRequestItem" (
    "id" SERIAL NOT NULL,
    "requestId" INTEGER NOT NULL,
    "quoteRequestItemId" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "productName" TEXT NOT NULL,
    "itemCode" TEXT,
    "unit" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "originalUnitPrice" DECIMAL(14,2) NOT NULL,
    "originalTotalPrice" DECIMAL(14,2) NOT NULL,
    "isUnavailable" BOOLEAN NOT NULL DEFAULT false,
    "originPort" TEXT,
    "isDangerousGood" BOOLEAN NOT NULL DEFAULT false,
    "partnerUnitPrice" DECIMAL(14,2),
    "partnerTotalPrice" DECIMAL(14,2),

    CONSTRAINT "CreditSupportRequestItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CreditSupportRequest_tokenHash_key" ON "CreditSupportRequest"("tokenHash");

-- CreateIndex
CREATE INDEX "CreditSupportRequest_quoteRequestId_idx" ON "CreditSupportRequest"("quoteRequestId");

-- CreateIndex
CREATE INDEX "CreditSupportRequest_quoteResponseId_idx" ON "CreditSupportRequest"("quoteResponseId");

-- CreateIndex
CREATE INDEX "CreditSupportRequest_creditPartnerId_idx" ON "CreditSupportRequest"("creditPartnerId");

-- CreateIndex
CREATE INDEX "CreditSupportRequest_creditPartnerContactId_idx" ON "CreditSupportRequest"("creditPartnerContactId");

-- CreateIndex
CREATE INDEX "CreditSupportRequest_createdById_idx" ON "CreditSupportRequest"("createdById");

-- CreateIndex
CREATE INDEX "CreditSupportRequest_expiresAt_idx" ON "CreditSupportRequest"("expiresAt");

-- CreateIndex
CREATE INDEX "CreditSupportRequest_revokedAt_idx" ON "CreditSupportRequest"("revokedAt");

-- CreateIndex
CREATE INDEX "CreditSupportRequestItem_quoteRequestItemId_idx" ON "CreditSupportRequestItem"("quoteRequestItemId");

-- CreateIndex
CREATE UNIQUE INDEX "CreditSupportRequestItem_requestId_quoteRequestItemId_key" ON "CreditSupportRequestItem"("requestId", "quoteRequestItemId");

-- CreateIndex
CREATE INDEX "SupplierPortalTokenLog_creditSupportRequestId_idx" ON "SupplierPortalTokenLog"("creditSupportRequestId");

-- AddForeignKey
ALTER TABLE "SupplierPortalTokenLog" ADD CONSTRAINT "SupplierPortalTokenLog_creditSupportRequestId_fkey" FOREIGN KEY ("creditSupportRequestId") REFERENCES "CreditSupportRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditSupportRequest" ADD CONSTRAINT "CreditSupportRequest_quoteRequestId_fkey" FOREIGN KEY ("quoteRequestId") REFERENCES "QuoteRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditSupportRequest" ADD CONSTRAINT "CreditSupportRequest_quoteResponseId_fkey" FOREIGN KEY ("quoteResponseId") REFERENCES "QuoteResponse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditSupportRequest" ADD CONSTRAINT "CreditSupportRequest_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditSupportRequest" ADD CONSTRAINT "CreditSupportRequest_creditPartnerId_fkey" FOREIGN KEY ("creditPartnerId") REFERENCES "CreditPartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditSupportRequest" ADD CONSTRAINT "CreditSupportRequest_creditPartnerContactId_fkey" FOREIGN KEY ("creditPartnerContactId") REFERENCES "CreditPartnerContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditSupportRequest" ADD CONSTRAINT "CreditSupportRequest_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditSupportRequestItem" ADD CONSTRAINT "CreditSupportRequestItem_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "CreditSupportRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditSupportRequestItem" ADD CONSTRAINT "CreditSupportRequestItem_quoteRequestItemId_fkey" FOREIGN KEY ("quoteRequestItemId") REFERENCES "QuoteRequestItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

