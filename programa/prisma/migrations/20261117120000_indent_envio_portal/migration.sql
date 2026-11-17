-- IQ Indent PR 4: envio por e-mail e portal do fornecedor (aditiva).
-- CreateEnum
CREATE TYPE "IndentMailKind" AS ENUM ('REQUEST', 'REVISION', 'RESEND');

-- AlterTable
ALTER TABLE "IndentSupplier" ADD COLUMN     "contactEmails" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "IndentPortalToken" (
    "id" SERIAL NOT NULL,
    "quoteId" INTEGER NOT NULL,
    "supplierId" INTEGER NOT NULL,
    "recipientEmail" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "showClientName" BOOLEAN NOT NULL DEFAULT false,
    "destinationPort" TEXT NOT NULL,
    "message" TEXT,
    "firstSeenAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "accessCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IndentPortalToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndentPortalResponse" (
    "id" SERIAL NOT NULL,
    "quoteId" INTEGER NOT NULL,
    "lastTokenId" INTEGER,
    "currency" TEXT NOT NULL,
    "productionLeadTimeDays" INTEGER NOT NULL,
    "paymentTerms" TEXT NOT NULL,
    "validUntil" DATE NOT NULL,
    "manufacturer" TEXT,
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "submittedAt" TIMESTAMP(3) NOT NULL,
    "submitterIp" TEXT,
    "submitterUserAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IndentPortalResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndentPortalResponseItem" (
    "id" SERIAL NOT NULL,
    "responseId" INTEGER NOT NULL,
    "quoteItemId" INTEGER NOT NULL,
    "packaging" TEXT NOT NULL,
    "fobPricePerKg" DECIMAL(14,4) NOT NULL,
    "cfrPricePerKg" DECIMAL(14,4) NOT NULL,

    CONSTRAINT "IndentPortalResponseItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndentPortalResponseRevision" (
    "id" SERIAL NOT NULL,
    "responseId" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL,
    "supersededAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IndentPortalResponseRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndentPortalAttachment" (
    "id" SERIAL NOT NULL,
    "quoteId" INTEGER NOT NULL,
    "tokenId" INTEGER,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IndentPortalAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndentPortalAttachmentFile" (
    "attachmentId" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,

    CONSTRAINT "IndentPortalAttachmentFile_pkey" PRIMARY KEY ("attachmentId")
);

-- CreateTable
CREATE TABLE "IndentPortalAccessLog" (
    "id" SERIAL NOT NULL,
    "tokenId" INTEGER,
    "kind" TEXT NOT NULL,
    "reason" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IndentPortalAccessLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndentMailLog" (
    "id" SERIAL NOT NULL,
    "quoteId" INTEGER NOT NULL,
    "tokenId" INTEGER,
    "kind" "IndentMailKind" NOT NULL,
    "toEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "status" "MailLogStatus" NOT NULL DEFAULT 'queued',
    "providerMessageId" TEXT,
    "errorMessage" TEXT,
    "hasPartnership" BOOLEAN NOT NULL,
    "showClientName" BOOLEAN NOT NULL,
    "attachmentNames" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "attachmentsConfirmedAt" TIMESTAMP(3),
    "attachmentsConfirmedById" INTEGER,
    "sentById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "IndentMailLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IndentPortalToken_tokenHash_key" ON "IndentPortalToken"("tokenHash");

-- CreateIndex
CREATE INDEX "IndentPortalToken_quoteId_idx" ON "IndentPortalToken"("quoteId");

-- CreateIndex
CREATE INDEX "IndentPortalToken_expiresAt_idx" ON "IndentPortalToken"("expiresAt");

-- CreateIndex
CREATE INDEX "IndentPortalToken_revokedAt_idx" ON "IndentPortalToken"("revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "IndentPortalResponse_quoteId_key" ON "IndentPortalResponse"("quoteId");

-- CreateIndex
CREATE INDEX "IndentPortalResponseItem_quoteItemId_idx" ON "IndentPortalResponseItem"("quoteItemId");

-- CreateIndex
CREATE UNIQUE INDEX "IndentPortalResponseItem_responseId_quoteItemId_key" ON "IndentPortalResponseItem"("responseId", "quoteItemId");

-- CreateIndex
CREATE UNIQUE INDEX "IndentPortalResponseRevision_responseId_version_key" ON "IndentPortalResponseRevision"("responseId", "version");

-- CreateIndex
CREATE INDEX "IndentPortalAttachment_tokenId_idx" ON "IndentPortalAttachment"("tokenId");

-- CreateIndex
CREATE UNIQUE INDEX "IndentPortalAttachment_quoteId_sha256_key" ON "IndentPortalAttachment"("quoteId", "sha256");

-- CreateIndex
CREATE INDEX "IndentPortalAccessLog_tokenId_idx" ON "IndentPortalAccessLog"("tokenId");

-- CreateIndex
CREATE INDEX "IndentPortalAccessLog_occurredAt_idx" ON "IndentPortalAccessLog"("occurredAt");

-- CreateIndex
CREATE INDEX "IndentPortalAccessLog_kind_idx" ON "IndentPortalAccessLog"("kind");

-- CreateIndex
CREATE INDEX "IndentMailLog_quoteId_idx" ON "IndentMailLog"("quoteId");

-- CreateIndex
CREATE INDEX "IndentMailLog_toEmail_idx" ON "IndentMailLog"("toEmail");

-- CreateIndex
CREATE INDEX "IndentMailLog_status_idx" ON "IndentMailLog"("status");

-- AddForeignKey
ALTER TABLE "IndentPortalToken" ADD CONSTRAINT "IndentPortalToken_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "IndentQuote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IndentPortalToken" ADD CONSTRAINT "IndentPortalToken_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "IndentSupplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IndentPortalResponse" ADD CONSTRAINT "IndentPortalResponse_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "IndentQuote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IndentPortalResponse" ADD CONSTRAINT "IndentPortalResponse_lastTokenId_fkey" FOREIGN KEY ("lastTokenId") REFERENCES "IndentPortalToken"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IndentPortalResponseItem" ADD CONSTRAINT "IndentPortalResponseItem_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES "IndentPortalResponse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IndentPortalResponseItem" ADD CONSTRAINT "IndentPortalResponseItem_quoteItemId_fkey" FOREIGN KEY ("quoteItemId") REFERENCES "IndentQuoteItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IndentPortalResponseRevision" ADD CONSTRAINT "IndentPortalResponseRevision_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES "IndentPortalResponse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IndentPortalAttachment" ADD CONSTRAINT "IndentPortalAttachment_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "IndentQuote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IndentPortalAttachment" ADD CONSTRAINT "IndentPortalAttachment_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "IndentPortalToken"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IndentPortalAttachmentFile" ADD CONSTRAINT "IndentPortalAttachmentFile_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "IndentPortalAttachment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IndentPortalAccessLog" ADD CONSTRAINT "IndentPortalAccessLog_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "IndentPortalToken"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IndentMailLog" ADD CONSTRAINT "IndentMailLog_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "IndentQuote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IndentMailLog" ADD CONSTRAINT "IndentMailLog_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "IndentPortalToken"("id") ON DELETE SET NULL ON UPDATE CASCADE;

