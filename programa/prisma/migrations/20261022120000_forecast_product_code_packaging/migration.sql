-- Aditiva: so ADD COLUMN (nulas ou com default) e 1 indice unico parcial em "ForecastProductCode". Nenhum dado existente muda.
ALTER TABLE "ForecastProductCode" ADD COLUMN "packagingQtyKg" DECIMAL(18,6),
ADD COLUMN "packagingLabel" TEXT,
ADD COLUMN "packagingIsPrimary" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "packagingSource" TEXT,
ADD COLUMN "packagingUpdatedAt" TIMESTAMP(3);

-- No maximo uma embalagem principal por produto. Prisma nao expressa indice parcial
-- (precedente: "SupplierContact_single_primary_per_supplier" em 20260422143000_landed_cost_pilot).
CREATE UNIQUE INDEX "ForecastProductCode_single_primary_packaging_per_product" ON "ForecastProductCode"("productId") WHERE "packagingIsPrimary" = true;
