import 'dotenv/config';
import { Incoterm, Prisma, PrismaClient } from '@prisma/client';
import { authEnv, demoEnv } from '../src/config/env';
import { QuoteComparisonService } from '../src/services/QuoteComparisonService';
import { hashPassword } from '../src/utils/password';

// Seed da AREA DE TESTE (demo): espelha os padroes de prisma/seed.ts
// (upserts idempotentes, hashPassword, QuoteComparisonService para o
// landed cost) mas roda contra o schema `demo` (instancia com
// DATABASE_URL/DIRECT_URL apontando pra la). Enxuto de proposito: poucos
// itens por familia, poucos fornecedores, poucas cotacoes — o objetivo e
// demonstrar o produto, nao estressar o banco.
//
// Exportado como funcao (`seedDemo`) para ser reutilizavel dentro da
// transacao do DemoController (reset). O bloco `require.main === module`
// no fim so roda quando o arquivo e executado diretamente
// (`npm run prisma:seed-demo`), nunca quando importado.

export const DEMO_USER_EMAIL = 'demo@intelliquote.demo';
const DEMO_USER_NAME = 'Usuário Demo IntelliQuote';

type DemoClient = PrismaClient | Prisma.TransactionClient;

export interface SeedDemoResult {
  roles: number;
  users: number;
  families: number;
  catalogItems: number;
  suppliers: number;
  supplierContacts: number;
  quoteRequests: number;
  quoteResponses: number;
}

interface SupplierDefinition {
  name: string;
  country: string;
  website: string;
  contactEmail: string;
  acceptedIncoterms: Incoterm[];
}

export async function seedDemo(client: DemoClient): Promise<SeedDemoResult> {
  const roles = await Promise.all([
    client.role.upsert({ where: { name: 'admin' }, update: {}, create: { name: 'admin' } }),
    client.role.upsert({
      where: { name: 'comprador' },
      update: {},
      create: { name: 'comprador' },
    }),
    client.role.upsert({ where: { name: 'gestor' }, update: {}, create: { name: 'gestor' } }),
    client.role.upsert({ where: { name: 'viewer' }, update: {}, create: { name: 'viewer' } }),
  ]);

  const adminRole = roles.find((role) => role.name === 'admin');
  if (!adminRole) {
    throw new Error('Role admin nao foi criada corretamente no seed demo.');
  }

  const demoPasswordHash = await hashPassword(demoEnv.userPassword ?? authEnv.adminSeedPassword);

  const demoUser = await client.user.upsert({
    where: { email: DEMO_USER_EMAIL },
    update: {
      name: DEMO_USER_NAME,
      passwordHash: demoPasswordHash,
      roleId: adminRole.id,
      isActive: true,
    },
    create: {
      name: DEMO_USER_NAME,
      email: DEMO_USER_EMAIL,
      passwordHash: demoPasswordHash,
      roleId: adminRole.id,
    },
  });

  const familyPumps = await client.itemFamily.upsert({
    where: { name: 'Bombas e Motores (Demo)' },
    update: { isActive: true },
    create: { name: 'Bombas e Motores (Demo)' },
  });
  const familySeals = await client.itemFamily.upsert({
    where: { name: 'Vedações e Insumos (Demo)' },
    update: { isActive: true },
    create: { name: 'Vedações e Insumos (Demo)' },
  });

  const catalogItemDefs = [
    {
      commercialName: 'Bomba Centrífuga Demo 5HP',
      marketName: 'DEMO-BOMBA-5HP',
      familyId: familyPumps.id,
      isDangerousGood: false,
    },
    {
      commercialName: 'Motor Elétrico Trifásico Demo',
      marketName: 'DEMO-MOTOR-TRI',
      familyId: familyPumps.id,
      isDangerousGood: false,
    },
    {
      commercialName: 'Kit de Vedação Demo Standard',
      marketName: 'DEMO-VED-STD',
      familyId: familySeals.id,
      isDangerousGood: false,
    },
    {
      commercialName: 'Solvente Industrial Demo',
      marketName: 'DEMO-SOLV-IND',
      familyId: familySeals.id,
      isDangerousGood: true,
    },
  ];

  const catalogItems = await Promise.all(
    catalogItemDefs.map((item) =>
      client.catalogItem.upsert({
        where: { marketName: item.marketName },
        update: {
          commercialName: item.commercialName,
          familyId: item.familyId,
          isDangerousGood: item.isDangerousGood,
          isActive: true,
        },
        create: item,
      }),
    ),
  );

  const [bombaItem, motorItem, vedacaoItem] = catalogItems;

  const supplierDefs: SupplierDefinition[] = [
    {
      name: 'Demo Supplier Asia',
      country: 'China',
      website: 'https://demo-supplier-asia.example.com',
      contactEmail: 'buyer.asia@example.com',
      acceptedIncoterms: ['FOB', 'CIF', 'DDP'],
    },
    {
      name: 'Demo Supplier Europa',
      country: 'Portugal',
      website: 'https://demo-supplier-europa.example.com',
      contactEmail: 'buyer.europa@example.com',
      acceptedIncoterms: ['EXW', 'FOB', 'CIF'],
    },
    {
      name: 'Demo Supplier India',
      country: 'India',
      website: 'https://demo-supplier-india.example.com',
      contactEmail: 'buyer.india@example.com',
      acceptedIncoterms: ['FCA', 'CIF', 'DDP'],
    },
    {
      name: 'Demo Supplier Brasil',
      country: 'Brazil',
      website: 'https://demo-supplier-brasil.example.com',
      contactEmail: 'buyer.brasil@example.com',
      acceptedIncoterms: ['EXW', 'CIF'],
    },
  ];

  const familyConnect = [{ id: familyPumps.id }, { id: familySeals.id }];
  const suppliers: Awaited<ReturnType<typeof client.supplier.create>>[] = [];
  const supplierContacts: Awaited<ReturnType<typeof client.supplierContact.create>>[] = [];

  for (const def of supplierDefs) {
    const existingSupplier = await client.supplier.findFirst({ where: { name: def.name } });
    const supplier = existingSupplier
      ? await client.supplier.update({
          where: { id: existingSupplier.id },
          data: {
            website: def.website,
            status: 'active',
            country: def.country,
            notes: 'Fornecedor fictício da área de teste (não usar em produção).',
            acceptedIncoterms: def.acceptedIncoterms,
            families: { set: familyConnect },
          },
        })
      : await client.supplier.create({
          data: {
            name: def.name,
            website: def.website,
            status: 'active',
            country: def.country,
            notes: 'Fornecedor fictício da área de teste (não usar em produção).',
            acceptedIncoterms: def.acceptedIncoterms,
            createdById: demoUser.id,
            families: { connect: familyConnect },
          },
        });
    suppliers.push(supplier);

    const existingContact = await client.supplierContact.findFirst({
      where: { supplierId: supplier.id, email: def.contactEmail },
    });
    const contact = existingContact
      ? await client.supplierContact.update({
          where: { id: existingContact.id },
          data: { name: `Comprador ${def.name}`, isPrimary: true },
        })
      : await client.supplierContact.create({
          data: {
            supplierId: supplier.id,
            name: `Comprador ${def.name}`,
            email: def.contactEmail,
            isPrimary: true,
          },
        });
    supplierContacts.push(contact);
  }

  const [supplierAsia, supplierEuropa, supplierIndia] = suppliers;

  let quoteResponsesCreated = 0;

  // 1) Cotacao aberta, sem respostas ainda ("rascunho/aguardando fornecedores").
  const quoteRequestOpen = await upsertQuoteRequest(client, {
    requestCode: 'QR-DEMO-0001',
    productName: 'Bomba Centrífuga Industrial (Demo)',
    quantity: 20,
    description: 'Cotação demo aguardando respostas dos fornecedores.',
    desiredIncoterm: ['CIF', 'FOB'],
    currency: 'USD',
    deadlineAt: new Date('2026-12-15T18:00:00.000Z'),
    createdById: demoUser.id,
    status: 'open',
  });
  await ensureItems(client, quoteRequestOpen.id, [
    {
      itemCode: 'DEMO-ITEM-001',
      productName: bombaItem.commercialName,
      catalogItemId: bombaItem.id,
      quantity: 15,
      targetPrice: 6200,
    },
    {
      itemCode: 'DEMO-ITEM-002',
      productName: motorItem.commercialName,
      catalogItemId: motorItem.id,
      quantity: 5,
      targetPrice: 1400,
    },
  ]);

  // 2) Cotacao aberta, com respostas de 2 fornecedores (comparacao possivel).
  const quoteRequestWithResponses = await upsertQuoteRequest(client, {
    requestCode: 'QR-DEMO-0002',
    productName: 'Kit de Vedação Industrial (Demo)',
    quantity: 200,
    description: 'Cotação demo com propostas recebidas, pronta para comparar.',
    desiredIncoterm: ['CIF', 'FOB'],
    currency: 'USD',
    deadlineAt: new Date('2026-12-01T18:00:00.000Z'),
    createdById: demoUser.id,
    status: 'open',
  });
  await ensureItems(client, quoteRequestWithResponses.id, [
    {
      itemCode: 'DEMO-ITEM-003',
      productName: vedacaoItem.commercialName,
      catalogItemId: vedacaoItem.id,
      quantity: 200,
      targetPrice: 18,
    },
  ]);
  quoteResponsesCreated += await ensureResponse(client, quoteRequestWithResponses.id, demoUser.id, {
    supplierId: supplierAsia.id,
    offeredPrice: 3200,
    currency: 'USD',
    exchangeRate: 5.4,
    freightCost: 900,
    insuranceCost: 80,
    otherFees: 150,
    importDuty: 12,
    ipi: 4,
    pis: 2.1,
    cofins: 9.65,
    offeredIncoterm: 'CIF',
    paymentTermsDays: 30,
    leadTimeDays: 35,
    notes: 'Proposta demo — inclui seguro internacional.',
  });
  quoteResponsesCreated += await ensureResponse(client, quoteRequestWithResponses.id, demoUser.id, {
    supplierId: supplierEuropa.id,
    offeredPrice: 3050,
    currency: 'USD',
    exchangeRate: 5.4,
    freightCost: 1100,
    insuranceCost: 0,
    otherFees: 120,
    importDuty: 12,
    ipi: 4,
    pis: 2.1,
    cofins: 9.65,
    offeredIncoterm: 'FOB',
    paymentTermsDays: 15,
    leadTimeDays: 28,
    notes: 'Proposta demo — não inclui seguro.',
  });

  // 3) Cotacao concluida, com vencedor manual definido (fim de fluxo).
  const quoteRequestClosed = await upsertQuoteRequest(client, {
    requestCode: 'QR-DEMO-0003',
    productName: 'Bomba Centrífuga Industrial (Demo — concluída)',
    quantity: 10,
    description: 'Cotação demo já concluída, com fornecedor vencedor definido.',
    desiredIncoterm: ['DDP'],
    currency: 'USD',
    deadlineAt: new Date('2026-10-20T18:00:00.000Z'),
    createdById: demoUser.id,
    status: 'closed',
    closedAt: new Date('2026-10-18T12:00:00.000Z'),
  });
  await ensureItems(client, quoteRequestClosed.id, [
    {
      itemCode: 'DEMO-ITEM-004',
      productName: bombaItem.commercialName,
      catalogItemId: bombaItem.id,
      quantity: 10,
      targetPrice: 6500,
    },
  ]);
  quoteResponsesCreated += await ensureResponse(client, quoteRequestClosed.id, demoUser.id, {
    supplierId: supplierIndia.id,
    offeredPrice: 6100,
    currency: 'USD',
    exchangeRate: 5.4,
    freightCost: 700,
    insuranceCost: 60,
    otherFees: 90,
    importDuty: 8,
    ipi: 4,
    pis: 2.1,
    cofins: 9.65,
    offeredIncoterm: 'DDP',
    paymentTermsDays: 45,
    leadTimeDays: 40,
    notes: 'Proposta demo — vencedora (entrega porta a porta).',
    isWinner: true,
  });

  return {
    roles: roles.length,
    users: 1,
    families: 2,
    catalogItems: catalogItems.length,
    suppliers: suppliers.length,
    supplierContacts: supplierContacts.length,
    quoteRequests: 3,
    quoteResponses: quoteResponsesCreated,
  };
}

async function upsertQuoteRequest(
  client: DemoClient,
  input: {
    requestCode: string;
    productName: string;
    quantity: number;
    description: string;
    desiredIncoterm: Incoterm[];
    currency: string;
    deadlineAt: Date;
    createdById: number;
    status: 'open' | 'closed';
    closedAt?: Date;
  },
) {
  return client.quoteRequest.upsert({
    where: { requestCode: input.requestCode },
    update: {
      productName: input.productName,
      quantity: input.quantity,
      description: input.description,
      desiredIncoterm: input.desiredIncoterm,
      currency: input.currency,
      deadlineAt: input.deadlineAt,
      createdById: input.createdById,
      status: input.status,
      closedAt: input.closedAt ?? null,
    },
    create: {
      requestCode: input.requestCode,
      productName: input.productName,
      quantity: input.quantity,
      description: input.description,
      desiredIncoterm: input.desiredIncoterm,
      currency: input.currency,
      deadlineAt: input.deadlineAt,
      status: input.status,
      closedAt: input.closedAt ?? null,
      createdById: input.createdById,
    },
  });
}

async function ensureItems(
  client: DemoClient,
  quoteRequestId: number,
  items: Array<{
    itemCode: string;
    productName: string;
    catalogItemId: number;
    quantity: number;
    targetPrice: number;
  }>,
): Promise<void> {
  const existingCount = await client.quoteRequestItem.count({ where: { quoteRequestId } });
  if (existingCount > 0) {
    return;
  }
  await client.quoteRequestItem.createMany({
    data: items.map((item) => ({
      quoteRequestId,
      itemCode: item.itemCode,
      productName: item.productName,
      catalogItemId: item.catalogItemId,
      quantity: item.quantity,
      unit: 'UN',
      targetPrice: item.targetPrice,
    })),
  });
}

interface DemoResponseInput {
  supplierId: number;
  offeredPrice: number;
  currency: string;
  exchangeRate: number;
  freightCost: number;
  insuranceCost: number;
  otherFees: number;
  importDuty: number;
  ipi: number;
  pis: number;
  cofins: number;
  offeredIncoterm: Incoterm;
  paymentTermsDays: number;
  leadTimeDays: number;
  notes: string;
  isWinner?: boolean;
}

// Retorna 1 quando criou/atualizou a resposta (usado so' para contar no
// resumo de retorno do reset; upsert em si e' sempre idempotente).
async function ensureResponse(
  client: DemoClient,
  quoteRequestId: number,
  createdById: number,
  input: DemoResponseInput,
): Promise<number> {
  const landedCost = QuoteComparisonService.calculateLandedCost({
    offeredPrice: input.offeredPrice,
    currency: input.currency,
    exchangeRate: input.exchangeRate,
    freightCost: input.freightCost,
    insuranceCost: input.insuranceCost,
    otherFees: input.otherFees,
    importDutyRate: input.importDuty,
    ipiRate: input.ipi,
    pisRate: input.pis,
    cofinsRate: input.cofins,
  });

  await client.quoteResponse.upsert({
    where: {
      quoteRequestId_supplierId: {
        quoteRequestId,
        supplierId: input.supplierId,
      },
    },
    update: {
      offeredPrice: input.offeredPrice,
      currency: input.currency,
      exchangeRate: landedCost.exchangeRate,
      freightCost: landedCost.freightCost,
      insuranceCost: landedCost.insuranceCost,
      otherFees: landedCost.otherFees,
      importDuty: landedCost.importDutyRate,
      ipi: landedCost.ipiRate,
      pis: landedCost.pisRate,
      cofins: landedCost.cofinsRate,
      totalLandedCost: landedCost.totalLandedCost,
      offeredIncoterm: input.offeredIncoterm,
      paymentTermsDays: input.paymentTermsDays,
      leadTimeDays: input.leadTimeDays,
      notes: input.notes,
      isWinner: input.isWinner ?? false,
      createdById,
    },
    create: {
      quoteRequestId,
      supplierId: input.supplierId,
      offeredPrice: input.offeredPrice,
      currency: input.currency,
      exchangeRate: landedCost.exchangeRate,
      freightCost: landedCost.freightCost,
      insuranceCost: landedCost.insuranceCost,
      otherFees: landedCost.otherFees,
      importDuty: landedCost.importDutyRate,
      ipi: landedCost.ipiRate,
      pis: landedCost.pisRate,
      cofins: landedCost.cofinsRate,
      totalLandedCost: landedCost.totalLandedCost,
      offeredIncoterm: input.offeredIncoterm,
      paymentTermsDays: input.paymentTermsDays,
      leadTimeDays: input.leadTimeDays,
      notes: input.notes,
      isWinner: input.isWinner ?? false,
      createdById,
    },
  });

  return 1;
}

// Execucao direta (`npm run prisma:seed-demo`). Nao roda quando importado
// (ex.: pelo DemoController dentro da transacao de reset).
if (require.main === module) {
  const standalonePrisma = new PrismaClient({
    datasources: {
      db: {
        url: process.env.DIRECT_URL ?? process.env.DATABASE_URL,
      },
    },
  });

  seedDemo(standalonePrisma)
    .then(async (result) => {
      console.log('Seed demo concluido:', result);
      await standalonePrisma.$disconnect();
    })
    .catch(async (error) => {
      console.error('Erro ao executar seed demo:', error);
      await standalonePrisma.$disconnect();
      process.exit(1);
    });
}
