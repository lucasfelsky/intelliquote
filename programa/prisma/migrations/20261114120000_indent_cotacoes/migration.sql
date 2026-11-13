-- IQ Indent PR 3 (cotacoes): oferta do fornecedor e datas do ciclo em "IndentQuote"; embalagem e precos FOB/CFR por kg em "IndentQuoteItem".
-- Migration ADITIVA: so ALTER TABLE ... ADD COLUMN (todas nulas, sem backfill), 2 indices e a FK "baseQuoteId" -> "IndentQuote" (auto-relacao
-- da cadeia de revisoes; ON DELETE RESTRICT). Nenhuma tabela nova, nenhum enum novo, nenhuma tabela do IQ principal tocada.
-- Sem indice unico parcial para "uma cotacao ACEITA por solicitacao": a garantia e a trava de linha do servico (nao modelavel no Prisma).
-- Rollback (so comentario, nao executar em producao sem plano): remover a restricao "IndentQuote_baseQuoteId_fkey", os indices
-- "IndentQuote_baseQuoteId_idx" e "IndentQuote_requestId_status_idx" e as colunas acrescentadas abaixo.

-- AlterTable
ALTER TABLE "IndentQuote" ADD COLUMN     "baseQuoteId" INTEGER,
ADD COLUMN     "decidedAt" TIMESTAMP(3),
ADD COLUMN     "manufacturer" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "paymentTerms" TEXT,
ADD COLUMN     "productionLeadTimeDays" INTEGER,
ADD COLUMN     "respondedAt" TIMESTAMP(3),
ADD COLUMN     "sentAt" TIMESTAMP(3),
ADD COLUMN     "validUntil" DATE;

-- AlterTable
ALTER TABLE "IndentQuoteItem" ADD COLUMN     "cfrPricePerKg" DECIMAL(14,4),
ADD COLUMN     "fobPricePerKg" DECIMAL(14,4),
ADD COLUMN     "packaging" TEXT;

-- CreateIndex
CREATE INDEX "IndentQuote_baseQuoteId_idx" ON "IndentQuote"("baseQuoteId");

-- CreateIndex
CREATE INDEX "IndentQuote_requestId_status_idx" ON "IndentQuote"("requestId", "status");

-- AddForeignKey
ALTER TABLE "IndentQuote" ADD CONSTRAINT "IndentQuote_baseQuoteId_fkey" FOREIGN KEY ("baseQuoteId") REFERENCES "IndentQuote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
