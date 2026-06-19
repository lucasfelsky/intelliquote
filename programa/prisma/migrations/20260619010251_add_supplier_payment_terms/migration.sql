-- DropForeignKey
ALTER TABLE "DispatchEvent" DROP CONSTRAINT "DispatchEvent_createdById_fkey";

-- DropForeignKey
ALTER TABLE "DispatchEvent" DROP CONSTRAINT "DispatchEvent_quoteRequestId_fkey";

-- DropForeignKey
ALTER TABLE "EmailTemplate" DROP CONSTRAINT "EmailTemplate_updatedById_fkey";

-- DropForeignKey
ALTER TABLE "PasswordResetToken" DROP CONSTRAINT "PasswordResetToken_userId_fkey";

-- DropForeignKey
ALTER TABLE "SupplierPortalResponse" DROP CONSTRAINT "SupplierPortalResponse_portalTokenId_fkey";

-- DropForeignKey
ALTER TABLE "SupplierPortalResponse" DROP CONSTRAINT "SupplierPortalResponse_quoteRequestId_fkey";

-- DropForeignKey
ALTER TABLE "SupplierPortalResponse" DROP CONSTRAINT "SupplierPortalResponse_supplierContactId_fkey";

-- DropForeignKey
ALTER TABLE "SupplierPortalResponse" DROP CONSTRAINT "SupplierPortalResponse_supplierId_fkey";

-- DropForeignKey
ALTER TABLE "SupplierPortalResponseItem" DROP CONSTRAINT "SupplierPortalResponseItem_quoteRequestItemId_fkey";

-- DropForeignKey
ALTER TABLE "SupplierPortalResponseItem" DROP CONSTRAINT "SupplierPortalResponseItem_responseId_fkey";

-- DropForeignKey
ALTER TABLE "SupplierPortalToken" DROP CONSTRAINT "SupplierPortalToken_createdById_fkey";

-- DropForeignKey
ALTER TABLE "SupplierPortalToken" DROP CONSTRAINT "SupplierPortalToken_dispatchEventId_fkey";

-- DropForeignKey
ALTER TABLE "SupplierPortalToken" DROP CONSTRAINT "SupplierPortalToken_quoteRequestId_fkey";

-- DropForeignKey
ALTER TABLE "SupplierPortalToken" DROP CONSTRAINT "SupplierPortalToken_supplierContactId_fkey";

-- DropForeignKey
ALTER TABLE "SupplierPortalToken" DROP CONSTRAINT "SupplierPortalToken_supplierId_fkey";

-- DropForeignKey
ALTER TABLE "SupplierPortalTokenLog" DROP CONSTRAINT "SupplierPortalTokenLog_tokenId_fkey";

-- AlterTable
ALTER TABLE "CompanyProfile" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "EmailTemplate" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN     "paymentTermsDays" INTEGER NOT NULL DEFAULT 30;

-- CreateIndex
CREATE INDEX "EmailTemplate_key_idx" ON "EmailTemplate"("key");

-- CreateIndex
CREATE INDEX "PasswordResetToken_expiresAt_idx" ON "PasswordResetToken"("expiresAt");

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyProfile" ADD CONSTRAINT "CompanyProfile_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchEvent" ADD CONSTRAINT "DispatchEvent_quoteRequestId_fkey" FOREIGN KEY ("quoteRequestId") REFERENCES "QuoteRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchEvent" ADD CONSTRAINT "DispatchEvent_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailTemplate" ADD CONSTRAINT "EmailTemplate_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPortalToken" ADD CONSTRAINT "SupplierPortalToken_quoteRequestId_fkey" FOREIGN KEY ("quoteRequestId") REFERENCES "QuoteRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPortalToken" ADD CONSTRAINT "SupplierPortalToken_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPortalToken" ADD CONSTRAINT "SupplierPortalToken_supplierContactId_fkey" FOREIGN KEY ("supplierContactId") REFERENCES "SupplierContact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPortalToken" ADD CONSTRAINT "SupplierPortalToken_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPortalToken" ADD CONSTRAINT "SupplierPortalToken_dispatchEventId_fkey" FOREIGN KEY ("dispatchEventId") REFERENCES "DispatchEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPortalResponse" ADD CONSTRAINT "SupplierPortalResponse_portalTokenId_fkey" FOREIGN KEY ("portalTokenId") REFERENCES "SupplierPortalToken"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPortalResponse" ADD CONSTRAINT "SupplierPortalResponse_quoteRequestId_fkey" FOREIGN KEY ("quoteRequestId") REFERENCES "QuoteRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPortalResponse" ADD CONSTRAINT "SupplierPortalResponse_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPortalResponse" ADD CONSTRAINT "SupplierPortalResponse_supplierContactId_fkey" FOREIGN KEY ("supplierContactId") REFERENCES "SupplierContact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPortalResponseItem" ADD CONSTRAINT "SupplierPortalResponseItem_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES "SupplierPortalResponse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPortalResponseItem" ADD CONSTRAINT "SupplierPortalResponseItem_quoteRequestItemId_fkey" FOREIGN KEY ("quoteRequestItemId") REFERENCES "QuoteRequestItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPortalTokenLog" ADD CONSTRAINT "SupplierPortalTokenLog_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "SupplierPortalToken"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "MailLog_relatedEntity_idx" RENAME TO "MailLog_relatedEntityType_relatedEntityId_idx";
