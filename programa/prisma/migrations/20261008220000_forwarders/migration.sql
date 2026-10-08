-- CreateTable
CREATE TABLE "Forwarder" (
    "id" SERIAL NOT NULL,
    "companyName" TEXT NOT NULL,
    "address" TEXT,
    "website" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Forwarder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForwarderContact" (
    "id" SERIAL NOT NULL,
    "forwarderId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ForwarderContact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Forwarder_isActive_idx" ON "Forwarder"("isActive");

-- CreateIndex
CREATE INDEX "Forwarder_isDefault_idx" ON "Forwarder"("isDefault");

-- CreateIndex
CREATE INDEX "Forwarder_createdById_idx" ON "Forwarder"("createdById");

-- CreateIndex
CREATE INDEX "Forwarder_deletedAt_idx" ON "Forwarder"("deletedAt");

-- CreateIndex
CREATE INDEX "ForwarderContact_forwarderId_idx" ON "ForwarderContact"("forwarderId");

-- AddForeignKey
ALTER TABLE "Forwarder" ADD CONSTRAINT "Forwarder_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForwarderContact" ADD CONSTRAINT "ForwarderContact_forwarderId_fkey" FOREIGN KEY ("forwarderId") REFERENCES "Forwarder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
