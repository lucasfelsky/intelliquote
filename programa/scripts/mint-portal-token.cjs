// CommonJS variant: uses Prisma directly and mints a portal token by reading
// the raw hash from the DB, simulating what the controller does.
const { PrismaClient } = require('@prisma/client');
const crypto = require('node:crypto');

const prisma = new PrismaClient();
const TOKEN_RANDOM_BYTES = 32;

function generateRawToken() {
  return crypto.randomBytes(TOKEN_RANDOM_BYTES).toString('base64url');
}
function hashToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

(async () => {
  const arg = Number(process.argv[2]);
  const contactId = arg;
  if (!contactId) {
    console.error('usage: node scripts/mint-portal-token.cjs <contactId> [quoteRequestId]');
    process.exit(1);
  }
  const contact = await prisma.supplierContact.findUnique({
    where: { id: contactId },
    include: { supplier: true },
  });
  if (!contact) {
    console.error('contact not found');
    process.exit(1);
  }
  let quoteRequestId = Number(process.argv[3]);
  if (!quoteRequestId) {
    const latest = await prisma.quoteRequest.findFirst({
      orderBy: { id: 'desc' },
      where: { status: 'open' },
    });
    quoteRequestId = latest.id;
  }
  // Revoke active tokens for this contact
  await prisma.supplierPortalToken.updateMany({
    where: {
      quoteRequestId,
      supplierContactId: contact.id,
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  });
  const rawToken = generateRawToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  const created = await prisma.supplierPortalToken.create({
    data: {
      quoteRequestId,
      supplierId: contact.supplierId,
      supplierContactId: contact.id,
      tokenHash,
      expiresAt,
      createdById: 1,
    },
  });
  console.log(JSON.stringify({
    tokenId: created.id,
    rawToken,
    supplierId: contact.supplierId,
    supplierName: contact.supplier.name,
    contactName: contact.name,
    contactEmail: contact.email,
    quoteRequestId,
    expiresAt: expiresAt.toISOString(),
  }, null, 2));
  await prisma.$disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});