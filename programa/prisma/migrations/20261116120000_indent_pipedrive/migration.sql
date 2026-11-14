-- IQ Indent PR 5a.2 (integracao Pipedrive, SO LEITURA): configuracao, espelho de negocios, eventos e fila de vinculo.
-- Migration ADITIVA: 2 enums e 4 tabelas novas (todas com prefixo Indent), colunas novas e NULAS (ou com default) em "IndentRequest" e
-- "IndentRequestItem", e a relaxacao de 3 colunas de "IndentRequest" para aceitar nulo (processNumber/processYear/processSeq: "Referencia
-- pendente"; as restricoes unicas seguem valendo e o Postgres aceita varios NULL). Sem backfill, sem remocao de dado, sem tabela do IQ principal
-- tocada; as unicas FKs apontam para tabelas Indent. Linha unica da configuracao (id = 1) e criada pelo servico na 1a leitura.
-- Rollback (so comentario, nao executar em producao sem plano): remover as 4 tabelas novas e os 2 enums e as colunas acrescentadas abaixo;
-- restaurar o NOT NULL das 3 colunas so se nenhuma solicitacao tiver referencia pendente.

-- CreateEnum
CREATE TYPE "IndentPipedriveEventSource" AS ENUM ('WEBHOOK', 'SWEEP', 'MANUAL');

-- CreateEnum
CREATE TYPE "IndentPendingOrgStatus" AS ENUM ('OPEN', 'RESOLVED');

-- AlterTable
ALTER TABLE "IndentRequest" ADD COLUMN     "noteChangedAt" TIMESTAMP(3),
ADD COLUMN     "noteDestination" TEXT,
ADD COLUMN     "noteHash" TEXT,
ADD COLUMN     "noteIncoterm" TEXT,
ADD COLUMN     "noteSupplierHint" TEXT,
ADD COLUMN     "referenceAlert" TEXT,
ADD COLUMN     "revisionAlertAt" TIMESTAMP(3),
ALTER COLUMN "processNumber" DROP NOT NULL,
ALTER COLUMN "processYear" DROP NOT NULL,
ALTER COLUMN "processSeq" DROP NOT NULL;

-- AlterTable
ALTER TABLE "IndentRequestItem" ADD COLUMN     "noteLine" INTEGER,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'MANUAL';

-- CreateTable
CREATE TABLE "IndentIntegrationConfig" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "pipelineId" INTEGER,
    "pipelineName" TEXT,
    "stageId" INTEGER,
    "stageName" TEXT,
    "slaBusinessDays" INTEGER NOT NULL DEFAULT 2,
    "connectionStatus" TEXT NOT NULL DEFAULT 'not_configured',
    "connectionCheckedAt" TIMESTAMP(3),
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncSource" "IndentPipedriveEventSource",
    "lastSyncNewDeals" INTEGER NOT NULL DEFAULT 0,
    "lastSyncErrors" INTEGER NOT NULL DEFAULT 0,
    "lastSyncMissed" INTEGER NOT NULL DEFAULT 0,
    "lastWebhookAt" TIMESTAMP(3),
    "dailyTokensRemaining" INTEGER,
    "dailyTokensLimit" INTEGER,
    "sweepLockedUntil" TIMESTAMP(3),
    "updatedById" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IndentIntegrationConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndentPipedriveDeal" (
    "id" SERIAL NOT NULL,
    "dealId" INTEGER NOT NULL,
    "requestId" INTEGER,
    "title" TEXT NOT NULL,
    "parsedNumber" TEXT,
    "currentRevision" INTEGER,
    "revisionHistory" JSONB NOT NULL DEFAULT '[]',
    "pipelineId" INTEGER,
    "stageId" INTEGER,
    "inSourceStage" BOOLEAN NOT NULL DEFAULT false,
    "stageEnteredAt" TIMESTAMP(3),
    "dealUpdateTime" TIMESTAMP(3),
    "orgIds" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "ownerId" INTEGER,
    "noteId" INTEGER,
    "noteHash" TEXT,
    "noteCheckedAt" TIMESTAMP(3),
    "leftStageAt" TIMESTAMP(3),
    "notFoundAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IndentPipedriveDeal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndentPipedriveEvent" (
    "id" SERIAL NOT NULL,
    "source" "IndentPipedriveEventSource" NOT NULL,
    "deliveryKey" TEXT,
    "dealId" INTEGER,
    "requestId" INTEGER,
    "result" TEXT NOT NULL,
    "errorCode" TEXT,
    "durationMs" INTEGER,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IndentPipedriveEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndentPendingOrg" (
    "id" SERIAL NOT NULL,
    "requestId" INTEGER NOT NULL,
    "dealId" INTEGER NOT NULL,
    "candidates" JSONB NOT NULL,
    "status" "IndentPendingOrgStatus" NOT NULL DEFAULT 'OPEN',
    "resolvedClientId" INTEGER,
    "resolvedOrgId" INTEGER,
    "resolvedById" INTEGER,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IndentPendingOrg_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IndentPipedriveDeal_dealId_key" ON "IndentPipedriveDeal"("dealId");

-- CreateIndex
CREATE INDEX "IndentPipedriveDeal_requestId_idx" ON "IndentPipedriveDeal"("requestId");

-- CreateIndex
CREATE INDEX "IndentPipedriveDeal_inSourceStage_idx" ON "IndentPipedriveDeal"("inSourceStage");

-- CreateIndex
CREATE UNIQUE INDEX "IndentPipedriveEvent_deliveryKey_key" ON "IndentPipedriveEvent"("deliveryKey");

-- CreateIndex
CREATE INDEX "IndentPipedriveEvent_dealId_receivedAt_idx" ON "IndentPipedriveEvent"("dealId", "receivedAt");

-- CreateIndex
CREATE INDEX "IndentPipedriveEvent_receivedAt_idx" ON "IndentPipedriveEvent"("receivedAt");

-- CreateIndex
CREATE INDEX "IndentPipedriveEvent_result_idx" ON "IndentPipedriveEvent"("result");

-- CreateIndex
CREATE INDEX "IndentPendingOrg_status_idx" ON "IndentPendingOrg"("status");

-- CreateIndex
CREATE INDEX "IndentPendingOrg_requestId_idx" ON "IndentPendingOrg"("requestId");

-- AddForeignKey
ALTER TABLE "IndentPipedriveDeal" ADD CONSTRAINT "IndentPipedriveDeal_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "IndentRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IndentPendingOrg" ADD CONSTRAINT "IndentPendingOrg_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "IndentRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IndentPendingOrg" ADD CONSTRAINT "IndentPendingOrg_resolvedClientId_fkey" FOREIGN KEY ("resolvedClientId") REFERENCES "IndentClient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

