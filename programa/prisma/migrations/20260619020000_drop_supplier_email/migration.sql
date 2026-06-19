-- Drop the Supplier.email column. Each contact already has its own email,
-- and the supplier form no longer asks for a generic one.
ALTER TABLE "Supplier" DROP COLUMN "email";
