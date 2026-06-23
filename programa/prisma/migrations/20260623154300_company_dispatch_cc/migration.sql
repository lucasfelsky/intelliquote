-- Adiciona CompanyProfile.dispatchCc: lista de e-mails fixos que recebem
-- copia automatica em TODOS os envios de cotacao da empresa.
--
-- O DispatchController agora mescla essa lista com os recipients escolhidos
-- no modal de envio (sempre adiciona, nunca substitui, dedup case-insensitive).
--
-- Valor default: array vazio (significa que o comportamento antigo
-- - somente os contatos selecionados recebem o e-mail - e preservado).

ALTER TABLE "CompanyProfile"
  ADD COLUMN "dispatchCc" TEXT NOT NULL DEFAULT '[]';
