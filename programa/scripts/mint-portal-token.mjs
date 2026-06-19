import { PrismaClient } from '@prisma/client';
import { SupplierPortalService } from '../src/services/SupplierPortalService.js';

const prisma = new PrismaClient();

(async () => {
  const arg = Number(process.argv[2]);
  if (!arg) {
    console.error('usage: node scripts/mint-portal-token.mjs <contactId> [quoteRequestId]');
    process.exit(1);
  }
  const contactId = arg;
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
    if (!latest) {
      console.error('no open quote request');
      process.exit(1);
    }
    quoteRequestId = latest.id;
  }
  const token = await SupplierPortalService.createToken({
    quoteRequestId,
    supplierId: contact.supplierId,
    supplierContactId: contact.id,
    createdById: 1,
    ttlDays: 14,
  });
  console.log(JSON.stringify({
    tokenId: token.id,
    rawToken: token.rawToken,
    supplierId: contact.supplierId,
    supplierName: contact.supplier.name,
    contactName: contact.name,
    contactEmail: contact.email,
    quoteRequestId,
  }, null, 2));
  await prisma.$disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});