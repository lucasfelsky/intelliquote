-- Aditiva: so CREATE TABLE/INDEX e FK nas tabelas novas; nenhuma tabela existente e alterada.

-- CreateTable
CREATE TABLE "ForecastSource" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "readinessDays" INTEGER,
    "holidaysDays" INTEGER,
    "shippingDays" INTEGER,
    "transitDays" INTEGER,
    "clearanceDays" INTEGER,
    "leadTimeDays" INTEGER,
    "supplierId" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ForecastSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForecastProduct" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "sheetOrder" INTEGER,
    "sourceId" INTEGER,
    "notes" TEXT,
    "fixedPriceFlag" BOOLEAN NOT NULL DEFAULT false,
    "fixedPrice" DECIMAL(14,4),
    "packaging" TEXT,
    "noFractioning" BOOLEAN NOT NULL DEFAULT false,
    "sampleQty" TEXT,
    "sampleRequestNote" TEXT,
    "familyId" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ForecastProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForecastProductCode" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "catalogItemId" INTEGER,

    CONSTRAINT "ForecastProductCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForecastMonthlySale" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "yearMonth" TEXT NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "sourceLabel" TEXT NOT NULL,
    "snapshotId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ForecastMonthlySale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForecastSnapshot" (
    "id" SERIAL NOT NULL,
    "label" TEXT NOT NULL,
    "baseDate" DATE NOT NULL,
    "half" INTEGER NOT NULL,
    "origin" TEXT NOT NULL,
    "months" JSONB NOT NULL,
    "products" JSONB NOT NULL,
    "inputs" JSONB NOT NULL,
    "expected" JSONB,
    "files" JSONB NOT NULL,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ForecastSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ForecastSource_normalizedName_key" ON "ForecastSource"("normalizedName");

-- CreateIndex
CREATE INDEX "ForecastSource_supplierId_idx" ON "ForecastSource"("supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "ForecastProduct_normalizedName_key" ON "ForecastProduct"("normalizedName");

-- CreateIndex
CREATE INDEX "ForecastProduct_sourceId_idx" ON "ForecastProduct"("sourceId");

-- CreateIndex
CREATE INDEX "ForecastProduct_familyId_idx" ON "ForecastProduct"("familyId");

-- CreateIndex
CREATE UNIQUE INDEX "ForecastProductCode_code_key" ON "ForecastProductCode"("code");

-- CreateIndex
CREATE INDEX "ForecastProductCode_catalogItemId_idx" ON "ForecastProductCode"("catalogItemId");

-- CreateIndex
CREATE UNIQUE INDEX "ForecastProductCode_productId_position_key" ON "ForecastProductCode"("productId", "position");

-- CreateIndex
CREATE INDEX "ForecastMonthlySale_yearMonth_idx" ON "ForecastMonthlySale"("yearMonth");

-- CreateIndex
CREATE UNIQUE INDEX "ForecastMonthlySale_code_yearMonth_key" ON "ForecastMonthlySale"("code", "yearMonth");

-- CreateIndex
CREATE INDEX "ForecastSnapshot_baseDate_idx" ON "ForecastSnapshot"("baseDate");

-- CreateIndex
CREATE INDEX "ForecastSnapshot_deletedAt_idx" ON "ForecastSnapshot"("deletedAt");

-- AddForeignKey
ALTER TABLE "ForecastSource" ADD CONSTRAINT "ForecastSource_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForecastProduct" ADD CONSTRAINT "ForecastProduct_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "ForecastSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForecastProduct" ADD CONSTRAINT "ForecastProduct_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "ItemFamily"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForecastProductCode" ADD CONSTRAINT "ForecastProductCode_productId_fkey" FOREIGN KEY ("productId") REFERENCES "ForecastProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForecastProductCode" ADD CONSTRAINT "ForecastProductCode_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "CatalogItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForecastMonthlySale" ADD CONSTRAINT "ForecastMonthlySale_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ForecastSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForecastSnapshot" ADD CONSTRAINT "ForecastSnapshot_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
