-- Aditiva: so CREATE TABLE/INDEX e FK nas tabelas novas; nenhuma tabela existente e alterada.

-- CreateTable
CREATE TABLE "SupplierPortalReminder" (
    "id" SERIAL NOT NULL,
    "quoteRequestId" INTEGER NOT NULL,
    "supplierContactId" INTEGER NOT NULL,
    "reminderDate" TEXT NOT NULL,
    "tokenId" INTEGER NOT NULL,
    "freshTokenId" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'claimed',
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "SupplierPortalReminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierPortalReminderAddress" (
    "id" SERIAL NOT NULL,
    "addressHash" TEXT NOT NULL,
    "reminderDate" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'claimed',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierPortalReminderAddress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupplierPortalReminder_reminderDate_idx" ON "SupplierPortalReminder"("reminderDate");

-- CreateIndex
CREATE INDEX "SupplierPortalReminder_supplierContactId_idx" ON "SupplierPortalReminder"("supplierContactId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierPortalReminder_qr_contact_date_key" ON "SupplierPortalReminder"("quoteRequestId", "supplierContactId", "reminderDate");

-- CreateIndex
CREATE INDEX "SupplierPortalReminderAddress_reminderDate_idx" ON "SupplierPortalReminderAddress"("reminderDate");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierPortalReminderAddress_addressHash_reminderDate_key" ON "SupplierPortalReminderAddress"("addressHash", "reminderDate");

-- AddForeignKey
ALTER TABLE "SupplierPortalReminder" ADD CONSTRAINT "SupplierPortalReminder_quoteRequestId_fkey" FOREIGN KEY ("quoteRequestId") REFERENCES "QuoteRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPortalReminder" ADD CONSTRAINT "SupplierPortalReminder_supplierContactId_fkey" FOREIGN KEY ("supplierContactId") REFERENCES "SupplierContact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
