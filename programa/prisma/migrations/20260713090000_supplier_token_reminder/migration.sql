-- F5 (backlog 2026-07-12): lembrete automatico pre-deadline.
-- reminderSentAt marca que o token original ja gerou lembrete (claim
-- atomico via updateMany garante 1 lembrete mesmo com multiplas replicas).
ALTER TABLE "SupplierPortalToken" ADD COLUMN "reminderSentAt" TIMESTAMP(3);
