-- IQ Indent H0: CNPJ do cliente passa a ser opcional ("CNPJ pendente"). Migration ADITIVA e sem perda de dados:
-- so remove a restricao NOT NULL da coluna. O indice unico "IndentClient_cnpj_key" permanece (o Postgres aceita
-- varios NULL em indice unico; CNPJ preenchido continua unico). Nenhum backfill, nenhuma outra tabela tocada.
-- Rollback (so comentario, nao executar em producao sem plano): so e possivel se nenhum cliente tiver "cnpj" nulo;
-- depois de preencher/remover esses clientes: ALTER TABLE "IndentClient" ALTER COLUMN "cnpj" SET NOT NULL;

-- AlterTable
ALTER TABLE "IndentClient" ALTER COLUMN "cnpj" DROP NOT NULL;
