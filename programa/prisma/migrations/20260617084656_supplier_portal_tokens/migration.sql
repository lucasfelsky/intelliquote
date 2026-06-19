-- Supplier portal: tokens, responses, logs, mail log
-- Magic-link flow: each (quoteRequest, supplierContact) pair gets one signed token
-- stored as SHA-256 hash. The raw token is delivered by e-mail and never persisted.

-- ============== ENUMS ==============
DO $$ BEGIN
  CREATE TYPE "MailLogStatus" AS ENUM ('queued', 'sent', 'failed', 'bounced', 'suppressed');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- ============== CompanyProfile (singleton) ==============
-- Holds SQ Quimica identity shown to suppliers in the e-mail and the portal page.
CREATE TABLE IF NOT EXISTS "CompanyProfile" (
  "id"                 SERIAL PRIMARY KEY,
  "companyName"        TEXT NOT NULL DEFAULT 'SQ Quimica',
  "tradeName"          TEXT,
  "taxId"              TEXT,
  "addressLine1"       TEXT,
  "addressLine2"       TEXT,
  "city"               TEXT,
  "state"              TEXT,
  "postalCode"         TEXT,
  "country"            TEXT NOT NULL DEFAULT 'Brazil',
  "purchasingEmail"    TEXT,
  "purchasingPhone"    TEXT,
  "website"            TEXT,
  "logoUrl"            TEXT,
  "updatedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedById"        INTEGER
);

-- ============== SupplierPortalToken ==============
CREATE TABLE "SupplierPortalToken" (
  "id"                  SERIAL PRIMARY KEY,
  "quoteRequestId"      INTEGER NOT NULL,
  "supplierId"          INTEGER NOT NULL,
  "supplierContactId"   INTEGER NOT NULL,
  "tokenHash"           TEXT NOT NULL UNIQUE,
  "expiresAt"           TIMESTAMP(3) NOT NULL,
  "revokedAt"           TIMESTAMP(3),
  "firstSeenAt"         TIMESTAMP(3),
  "lastSeenAt"          TIMESTAMP(3),
  "accessCount"         INTEGER NOT NULL DEFAULT 0,
  "respondedAt"         TIMESTAMP(3),
  "responseId"          INTEGER UNIQUE,
  "createdById"         INTEGER NOT NULL,
  "dispatchEventId"     INTEGER,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupplierPortalToken_quoteRequestId_fkey"
    FOREIGN KEY ("quoteRequestId") REFERENCES "QuoteRequest"("id") ON DELETE CASCADE,
  CONSTRAINT "SupplierPortalToken_supplierId_fkey"
    FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE,
  CONSTRAINT "SupplierPortalToken_supplierContactId_fkey"
    FOREIGN KEY ("supplierContactId") REFERENCES "SupplierContact"("id") ON DELETE CASCADE,
  CONSTRAINT "SupplierPortalToken_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT
);

CREATE INDEX "SupplierPortalToken_quoteRequestId_idx" ON "SupplierPortalToken"("quoteRequestId");
CREATE INDEX "SupplierPortalToken_supplierId_idx"       ON "SupplierPortalToken"("supplierId");
CREATE INDEX "SupplierPortalToken_supplierContactId_idx" ON "SupplierPortalToken"("supplierContactId");
CREATE INDEX "SupplierPortalToken_expiresAt_idx"       ON "SupplierPortalToken"("expiresAt");
CREATE INDEX "SupplierPortalToken_revokedAt_idx"       ON "SupplierPortalToken"("revokedAt");
CREATE INDEX "SupplierPortalToken_respondedAt_idx"     ON "SupplierPortalToken"("respondedAt");
CREATE INDEX "SupplierPortalToken_dispatchEventId_idx" ON "SupplierPortalToken"("dispatchEventId");

-- ============== SupplierPortalResponse ==============
CREATE TABLE "SupplierPortalResponse" (
  "id"                 SERIAL PRIMARY KEY,
  "portalTokenId"      INTEGER NOT NULL UNIQUE,
  "quoteRequestId"     INTEGER NOT NULL,
  "supplierId"         INTEGER NOT NULL,
  "supplierContactId"  INTEGER NOT NULL,
  "currency"           TEXT NOT NULL DEFAULT 'USD',
  "incoterm"           "Incoterm" NOT NULL,
  "paymentTermsDays"   INTEGER NOT NULL DEFAULT 30,
  "leadTimeDays"       INTEGER,
  "totalPrice"         DECIMAL(14,2) NOT NULL,
  "totalPriceCurrency" TEXT NOT NULL DEFAULT 'USD',
  "validityDays"       INTEGER NOT NULL DEFAULT 30,
  "notes"              TEXT,
  "submittedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "submitterIp"        TEXT,
  "submitterUserAgent" TEXT,
  CONSTRAINT "SupplierPortalResponse_portalTokenId_fkey"
    FOREIGN KEY ("portalTokenId") REFERENCES "SupplierPortalToken"("id") ON DELETE CASCADE,
  CONSTRAINT "SupplierPortalResponse_quoteRequestId_fkey"
    FOREIGN KEY ("quoteRequestId") REFERENCES "QuoteRequest"("id") ON DELETE CASCADE,
  CONSTRAINT "SupplierPortalResponse_supplierId_fkey"
    FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE,
  CONSTRAINT "SupplierPortalResponse_supplierContactId_fkey"
    FOREIGN KEY ("supplierContactId") REFERENCES "SupplierContact"("id") ON DELETE CASCADE
);

CREATE INDEX "SupplierPortalResponse_quoteRequestId_idx"    ON "SupplierPortalResponse"("quoteRequestId");
CREATE INDEX "SupplierPortalResponse_supplierId_idx"        ON "SupplierPortalResponse"("supplierId");
CREATE INDEX "SupplierPortalResponse_supplierContactId_idx" ON "SupplierPortalResponse"("supplierContactId");

-- ============== SupplierPortalResponseItem ==============
CREATE TABLE "SupplierPortalResponseItem" (
  "id"                 SERIAL PRIMARY KEY,
  "responseId"         INTEGER NOT NULL,
  "quoteRequestItemId" INTEGER NOT NULL,
  "unitPrice"          DECIMAL(14,2) NOT NULL,
  "quantity"           INTEGER NOT NULL,
  "totalPrice"         DECIMAL(14,2) NOT NULL,
  "leadTimeDays"       INTEGER,
  "notes"              TEXT,
  CONSTRAINT "SupplierPortalResponseItem_responseId_fkey"
    FOREIGN KEY ("responseId") REFERENCES "SupplierPortalResponse"("id") ON DELETE CASCADE,
  CONSTRAINT "SupplierPortalResponseItem_quoteRequestItemId_fkey"
    FOREIGN KEY ("quoteRequestItemId") REFERENCES "QuoteRequestItem"("id") ON DELETE CASCADE
);

CREATE INDEX "SupplierPortalResponseItem_responseId_idx"         ON "SupplierPortalResponseItem"("responseId");
CREATE INDEX "SupplierPortalResponseItem_quoteRequestItemId_idx" ON "SupplierPortalResponseItem"("quoteRequestItemId");

-- ============== SupplierPortalTokenLog (audit) ==============
CREATE TABLE "SupplierPortalTokenLog" (
  "id"          SERIAL PRIMARY KEY,
  "tokenId"     INTEGER NOT NULL,
  "kind"        TEXT NOT NULL,
  "ip"          TEXT,
  "userAgent"   TEXT,
  "meta"        JSONB,
  "occurredAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupplierPortalTokenLog_tokenId_fkey"
    FOREIGN KEY ("tokenId") REFERENCES "SupplierPortalToken"("id") ON DELETE CASCADE
);

CREATE INDEX "SupplierPortalTokenLog_tokenId_idx"     ON "SupplierPortalTokenLog"("tokenId");
CREATE INDEX "SupplierPortalTokenLog_occurredAt_idx"  ON "SupplierPortalTokenLog"("occurredAt");
CREATE INDEX "SupplierPortalTokenLog_kind_idx"        ON "SupplierPortalTokenLog"("kind");

-- ============== DispatchEvent (one per dispatch action) ==============
CREATE TABLE "DispatchEvent" (
  "id"              SERIAL PRIMARY KEY,
  "quoteRequestId"  INTEGER NOT NULL,
  "createdById"     INTEGER NOT NULL,
  "recipientsCount" INTEGER NOT NULL,
  "subject"         TEXT NOT NULL,
  "ccList"          TEXT,
  "locale"          TEXT NOT NULL DEFAULT 'en',
  "status"          TEXT NOT NULL DEFAULT 'completed',
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DispatchEvent_quoteRequestId_fkey"
    FOREIGN KEY ("quoteRequestId") REFERENCES "QuoteRequest"("id") ON DELETE CASCADE,
  CONSTRAINT "DispatchEvent_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT
);

CREATE INDEX "DispatchEvent_quoteRequestId_idx" ON "DispatchEvent"("quoteRequestId");
CREATE INDEX "DispatchEvent_createdById_idx"    ON "DispatchEvent"("createdById");
CREATE INDEX "DispatchEvent_createdAt_idx"      ON "DispatchEvent"("createdAt");

ALTER TABLE "SupplierPortalToken"
  ADD CONSTRAINT "SupplierPortalToken_dispatchEventId_fkey"
  FOREIGN KEY ("dispatchEventId") REFERENCES "DispatchEvent"("id") ON DELETE SET NULL;

-- ============== MailLog (e-mail delivery audit) ==============
CREATE TABLE "MailLog" (
  "id"                  SERIAL PRIMARY KEY,
  "provider"            TEXT NOT NULL,
  "providerMessageId"   TEXT,
  "fromAddress"         TEXT NOT NULL,
  "toEmail"             TEXT NOT NULL,
  "toName"              TEXT,
  "ccList"              TEXT,
  "subject"             TEXT NOT NULL,
  "templateId"          TEXT,
  "templateVars"        JSONB,
  "status"              "MailLogStatus" NOT NULL DEFAULT 'queued',
  "sentAt"              TIMESTAMP(3),
  "errorMessage"        TEXT,
  "relatedEntityType"   TEXT,
  "relatedEntityId"     TEXT,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "MailLog_status_idx"              ON "MailLog"("status");
CREATE INDEX "MailLog_provider_idx"            ON "MailLog"("provider");
CREATE INDEX "MailLog_relatedEntity_idx"       ON "MailLog"("relatedEntityType","relatedEntityId");
CREATE INDEX "MailLog_toEmail_idx"             ON "MailLog"("toEmail");
CREATE INDEX "MailLog_createdAt_idx"           ON "MailLog"("createdAt");

-- ============== Seed singleton CompanyProfile ==============
INSERT INTO "CompanyProfile" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING;
SELECT setval(pg_get_serial_sequence('"CompanyProfile"', 'id'), GREATEST((SELECT MAX("id") FROM "CompanyProfile"), 1));
