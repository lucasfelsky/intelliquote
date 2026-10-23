-- Aditiva: grupos de equivalencia de produtos do Forecast (PR 6b). Tabela nova + coluna nula em ForecastProduct, sem tocar
-- em dados existentes; reversivel com DROP COLUMN "equivalenceGroupId" e DROP TABLE "ForecastEquivalenceGroup".
-- AlterTable
ALTER TABLE "ForecastProduct" ADD COLUMN     "equivalenceGroupId" INTEGER;

-- CreateTable
CREATE TABLE "ForecastEquivalenceGroup" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "notes" TEXT,
    "principalProductId" INTEGER,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ForecastEquivalenceGroup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ForecastEquivalenceGroup_normalizedName_key" ON "ForecastEquivalenceGroup"("normalizedName");

-- CreateIndex
CREATE INDEX "ForecastEquivalenceGroup_principalProductId_idx" ON "ForecastEquivalenceGroup"("principalProductId");

-- CreateIndex
CREATE INDEX "ForecastProduct_equivalenceGroupId_idx" ON "ForecastProduct"("equivalenceGroupId");

-- AddForeignKey
ALTER TABLE "ForecastProduct" ADD CONSTRAINT "ForecastProduct_equivalenceGroupId_fkey" FOREIGN KEY ("equivalenceGroupId") REFERENCES "ForecastEquivalenceGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForecastEquivalenceGroup" ADD CONSTRAINT "ForecastEquivalenceGroup_principalProductId_fkey" FOREIGN KEY ("principalProductId") REFERENCES "ForecastProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;
