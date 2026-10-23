-- Aditiva: 1 coluna com default constante (sem reescrita da tabela no PG 11+). Produtos existentes viram 'planilha'.
ALTER TABLE "ForecastProduct" ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'planilha';
