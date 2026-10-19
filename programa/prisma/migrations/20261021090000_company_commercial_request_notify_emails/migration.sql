-- Adiciona CompanyProfile.commercialRequestNotifyEmails: lista propria de
-- destinatarios do aviso "nova solicitacao do comercial".
--
-- Aditiva. Default '[]' = lista vazia = comportamento anterior preservado
-- (aviso vai para INTELLIQUOTE_COMEX_CC_LIST + dispatchCc).

ALTER TABLE "CompanyProfile"
  ADD COLUMN "commercialRequestNotifyEmails" TEXT NOT NULL DEFAULT '[]';
