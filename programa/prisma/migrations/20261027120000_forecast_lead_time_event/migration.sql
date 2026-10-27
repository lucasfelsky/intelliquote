-- Aditiva e idempotente: ocasioes que afetam o lead time (feriado, greve, fechamento de porto) + pais da fonte. Coluna nula e
-- tabela nova, sem backfill e sem tocar em dados existentes; reversivel com DROP TABLE "ForecastLeadTimeEvent" e
-- DROP COLUMN "countryCode" de "ForecastSource".
-- AlterTable
ALTER TABLE "ForecastSource" ADD COLUMN IF NOT EXISTS "countryCode" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "ForecastLeadTimeEvent" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "scopeType" TEXT NOT NULL,
    "countryCode" TEXT,
    "sourceId" INTEGER,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "recurrence" TEXT NOT NULL DEFAULT 'nenhuma',
    "component" TEXT NOT NULL DEFAULT 'total',
    "effectKind" TEXT NOT NULL DEFAULT 'dias',
    "effectValue" DECIMAL(8,2) NOT NULL,
    "coverWithStock" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ForecastLeadTimeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ForecastLeadTimeEvent_isActive_startDate_idx" ON "ForecastLeadTimeEvent"("isActive", "startDate");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ForecastLeadTimeEvent_sourceId_idx" ON "ForecastLeadTimeEvent"("sourceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ForecastLeadTimeEvent_scopeType_countryCode_idx" ON "ForecastLeadTimeEvent"("scopeType", "countryCode");

-- AddForeignKey (ADD CONSTRAINT nao tem IF NOT EXISTS: a guarda ignora so o objeto ja existente)
DO $$ BEGIN
  ALTER TABLE "ForecastLeadTimeEvent" ADD CONSTRAINT "ForecastLeadTimeEvent_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "ForecastSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
