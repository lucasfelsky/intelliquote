-- AlterTable
ALTER TABLE "CompanyProfile" ADD COLUMN     "awardApprovalThreshold" DECIMAL(14,2);

-- AlterTable
ALTER TABLE "QuoteComparison" ADD COLUMN     "approvalStatus" TEXT NOT NULL DEFAULT 'not_required',
ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" INTEGER;

-- AddForeignKey
ALTER TABLE "QuoteComparison" ADD CONSTRAINT "QuoteComparison_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
