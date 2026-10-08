-- CreateTable
CREATE TABLE "CreditPartner" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "taxId" TEXT,
    "website" TEXT,
    "country" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "CreditPartner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditPartnerContact" (
    "id" SERIAL NOT NULL,
    "creditPartnerId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "position" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditPartnerContact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CreditPartner_isActive_idx" ON "CreditPartner"("isActive");

-- CreateIndex
CREATE INDEX "CreditPartner_createdById_idx" ON "CreditPartner"("createdById");

-- CreateIndex
CREATE INDEX "CreditPartner_deletedAt_idx" ON "CreditPartner"("deletedAt");

-- CreateIndex
CREATE INDEX "CreditPartnerContact_creditPartnerId_idx" ON "CreditPartnerContact"("creditPartnerId");

-- AddForeignKey
ALTER TABLE "CreditPartner" ADD CONSTRAINT "CreditPartner_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditPartnerContact" ADD CONSTRAINT "CreditPartnerContact_creditPartnerId_fkey" FOREIGN KEY ("creditPartnerId") REFERENCES "CreditPartner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

