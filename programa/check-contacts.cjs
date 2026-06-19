const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const r = await p.supplierContact.findMany({ orderBy: { id: 'desc' }, take: 10 });
  console.log(JSON.stringify(r, null, 2));
  await p.$disconnect();
})().catch((e) => {
  console.error(e.message);
  return p.$disconnect();
});
