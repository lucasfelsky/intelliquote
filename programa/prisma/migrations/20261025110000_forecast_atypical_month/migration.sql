-- Aditiva: meses de venda atipica por produto (PR 6c). Tabela nova, sem tocar em dados existentes; reversivel com DROP TABLE.
-- CreateTable
CREATE TABLE "ForecastAtypicalMonth" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "yearMonth" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ForecastAtypicalMonth_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ForecastAtypicalMonth_productId_yearMonth_key" ON "ForecastAtypicalMonth"("productId", "yearMonth");

-- AddForeignKey
ALTER TABLE "ForecastAtypicalMonth" ADD CONSTRAINT "ForecastAtypicalMonth_productId_fkey" FOREIGN KEY ("productId") REFERENCES "ForecastProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

