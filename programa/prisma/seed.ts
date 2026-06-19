import 'dotenv/config';
import { Incoterm, PrismaClient } from '@prisma/client';
import { authEnv } from '../src/config/env';
import { QuoteComparisonService } from '../src/services/QuoteComparisonService';
import { hashPassword } from '../src/utils/password';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DIRECT_URL ?? process.env.DATABASE_URL,
    },
  },
});

const DEMO_QUOTE_REQUEST_CODE = 'QR-20260325-DEMO01';

async function main(): Promise<void> {
  const adminPasswordHash = await hashPassword(authEnv.adminSeedPassword);

  const roles = await Promise.all([
    prisma.role.upsert({
      where: { name: 'admin' },
      update: {},
      create: { name: 'admin' },
    }),
    prisma.role.upsert({
      where: { name: 'comprador' },
      update: {},
      create: { name: 'comprador' },
    }),
    prisma.role.upsert({
      where: { name: 'gestor' },
      update: {},
      create: { name: 'gestor' },
    }),
    prisma.role.upsert({
      where: { name: 'viewer' },
      update: {},
      create: { name: 'viewer' },
    }),
  ]);

  const adminRole = roles.find((role) => role.name === 'admin');

  if (!adminRole) {
    throw new Error('Role admin nao foi criada corretamente.');
  }

  const adminUser = await prisma.user.upsert({
    where: {
      email: authEnv.adminSeedEmail,
    },
    update: {
      name: authEnv.adminSeedName,
      passwordHash: adminPasswordHash,
      roleId: adminRole.id,
      isActive: true,
    },
    create: {
      name: authEnv.adminSeedName,
      email: authEnv.adminSeedEmail,
      passwordHash: adminPasswordHash,
      roleId: adminRole.id,
    },
  });

  await prisma.companyProfile.upsert({
    where: { id: 1 },
    update: {
      companyName: 'SQ Quimica',
      purchasingEmail: authEnv.adminSeedEmail,
      country: 'Brazil',
    },
    create: {
      id: 1,
      companyName: 'SQ Quimica',
      purchasingEmail: authEnv.adminSeedEmail,
      country: 'Brazil',
      updatedById: adminUser.id,
    },
  });

  const suppliers = await Promise.all([
    upsertSupplier({
      name: 'Global Parts Ltd',
      website: 'https://globalparts.com',
      status: 'active',
      country: 'China',
      notes: 'Fornecedor homologado para equipamentos industriais.',
      createdById: adminUser.id,
      acceptedIncoterms: ['FOB', 'CIF', 'DDP'],
    }),
    upsertSupplier({
      name: 'Atlantic Trade Co',
      website: 'https://atlantictrade.com',
      status: 'active',
      country: 'Portugal',
      notes: 'Bom historico de resposta para embarques maritimos.',
      createdById: adminUser.id,
      acceptedIncoterms: ['EXW', 'FOB', 'CIF'],
    }),
    upsertSupplier({
      name: 'Prime Industrial Supply',
      website: 'https://primeindustrial.com',
      status: 'active',
      country: 'India',
      notes: 'Fornecedor competitivo para lotes de maior volume.',
      createdById: adminUser.id,
      acceptedIncoterms: ['FCA', 'CIF', 'DDP'],
    }),
  ]);

  const quoteRequest = await prisma.quoteRequest.upsert({
    where: {
      requestCode: DEMO_QUOTE_REQUEST_CODE,
    },
    update: {
      productName: 'Bomba Centrifuga Industrial',
      quantity: 100,
      description: 'Cotacao piloto para compra internacional de bombas centrifugas.',
      desiredIncoterm: 'CIF',
      currency: 'USD',
      deadlineAt: new Date('2026-04-05T18:00:00.000Z'),
      createdById: adminUser.id,
    },
    create: {
      requestCode: DEMO_QUOTE_REQUEST_CODE,
      productName: 'Bomba Centrifuga Industrial',
      quantity: 100,
      description: 'Cotacao piloto para compra internacional de bombas centrifugas.',
      desiredIncoterm: 'CIF',
      currency: 'USD',
      deadlineAt: new Date('2026-04-05T18:00:00.000Z'),
      status: 'open',
      createdById: adminUser.id,
    },
  });

  const existingItemsCount = await prisma.quoteRequestItem.count({
    where: {
      quoteRequestId: quoteRequest.id,
    },
  });

  if (existingItemsCount === 0) {
    await prisma.quoteRequestItem.createMany({
      data: [
        {
          quoteRequestId: quoteRequest.id,
          itemCode: 'ITEM-001',
          productName: 'Bomba Centrifuga Industrial',
          description: 'Corpo em aco inox com vazao de 15m3/h.',
          quantity: 60,
          unit: 'UN',
          targetPrice: 120,
          notes: 'Item critico para linha de producao A.',
        },
        {
          quoteRequestId: quoteRequest.id,
          itemCode: 'ITEM-002',
          productName: 'Kit de Vedacao',
          description: 'Kit completo de vedacao compativel com o conjunto principal.',
          quantity: 40,
          unit: 'UN',
          targetPrice: 32,
          notes: 'Pode ser embarcado junto com o item principal.',
        },
      ],
    });
  }

  const hasComparisonHistory = await prisma.quoteComparison.findFirst({
    where: {
      quoteRequestId: quoteRequest.id,
    },
    select: {
      id: true,
    },
  });

  if (hasComparisonHistory) {
    console.log(
      `Seed preservou as propostas da cotacao ${quoteRequest.requestCode} porque ja existe historico de comparacao.`,
    );
    return;
  }

  const demoResponses = [
    {
      supplierId: suppliers[0].id,
      offeredPrice: 12500,
      currency: 'USD',
      exchangeRate: 5.4,
      freightCost: 4200,
      insuranceCost: 380,
      otherFees: 650,
      importDuty: 14,
      ipi: 5,
      pis: 2.1,
      cofins: 9.65,
      offeredIncoterm: 'CIF' as Incoterm,
      paymentTermsDays: 30,
      leadTimeDays: 42,
      notes: 'Inclui seguro internacional.',
    },
    {
      supplierId: suppliers[1].id,
      offeredPrice: 11800,
      currency: 'USD',
      exchangeRate: 5.4,
      freightCost: 4700,
      insuranceCost: 0,
      otherFees: 520,
      importDuty: 14,
      ipi: 5,
      pis: 2.1,
      cofins: 9.65,
      offeredIncoterm: 'FOB' as Incoterm,
      paymentTermsDays: 15,
      leadTimeDays: 38,
      notes: 'Nao inclui seguro nem desembaraco.',
    },
    {
      supplierId: suppliers[2].id,
      offeredPrice: 12900,
      currency: 'USD',
      exchangeRate: 5.4,
      freightCost: 1800,
      insuranceCost: 150,
      otherFees: 400,
      importDuty: 8,
      ipi: 4,
      pis: 2.1,
      cofins: 9.65,
      offeredIncoterm: 'DDP' as Incoterm,
      paymentTermsDays: 45,
      leadTimeDays: 50,
      notes: 'Entrega porta a porta com impostos estimados.',
    },
  ];

  for (const response of demoResponses) {
    const landedCost = QuoteComparisonService.calculateLandedCost({
      offeredPrice: response.offeredPrice,
      currency: response.currency,
      exchangeRate: response.exchangeRate,
      freightCost: response.freightCost,
      insuranceCost: response.insuranceCost,
      otherFees: response.otherFees,
      importDutyRate: response.importDuty,
      ipiRate: response.ipi,
      pisRate: response.pis,
      cofinsRate: response.cofins,
    });

    await prisma.quoteResponse.upsert({
      where: {
        quoteRequestId_supplierId: {
          quoteRequestId: quoteRequest.id,
          supplierId: response.supplierId,
        },
      },
      update: {
        offeredPrice: response.offeredPrice,
        currency: response.currency,
        exchangeRate: landedCost.exchangeRate,
        freightCost: landedCost.freightCost,
        insuranceCost: landedCost.insuranceCost,
        otherFees: landedCost.otherFees,
        importDuty: landedCost.importDutyRate,
        ipi: landedCost.ipiRate,
        pis: landedCost.pisRate,
        cofins: landedCost.cofinsRate,
        totalLandedCost: landedCost.totalLandedCost,
        offeredIncoterm: response.offeredIncoterm,
        paymentTermsDays: response.paymentTermsDays,
        leadTimeDays: response.leadTimeDays,
        notes: response.notes,
        createdById: adminUser.id,
      },
      create: {
        quoteRequestId: quoteRequest.id,
        supplierId: response.supplierId,
        offeredPrice: response.offeredPrice,
        currency: response.currency,
        exchangeRate: landedCost.exchangeRate,
        freightCost: landedCost.freightCost,
        insuranceCost: landedCost.insuranceCost,
        otherFees: landedCost.otherFees,
        importDuty: landedCost.importDutyRate,
        ipi: landedCost.ipiRate,
        pis: landedCost.pisRate,
        cofins: landedCost.cofinsRate,
        totalLandedCost: landedCost.totalLandedCost,
        offeredIncoterm: response.offeredIncoterm,
        paymentTermsDays: response.paymentTermsDays,
        leadTimeDays: response.leadTimeDays,
        notes: response.notes,
        createdById: adminUser.id,
      },
    });
  }
}

async function upsertSupplier(input: {
  name: string;
  website: string;
  status: 'active' | 'inactive' | 'blocked';
  country: string;
  notes: string;
  createdById: number;
  acceptedIncoterms: Incoterm[];
}) {
  const existing = await prisma.supplier.findFirst({ where: { name: input.name } });
  if (existing) {
    return prisma.supplier.update({
      where: { id: existing.id },
      data: {
        name: input.name,
        website: input.website,
        status: input.status,
        country: input.country,
        notes: input.notes,
        acceptedIncoterms: input.acceptedIncoterms,
      },
    });
  }
  return prisma.supplier.create({
    data: {
      name: input.name,
      website: input.website,
      status: input.status,
      country: input.country,
      notes: input.notes,
      createdById: input.createdById,
      acceptedIncoterms: input.acceptedIncoterms,
    },
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error('Erro ao executar seed:', error);
    await prisma.$disconnect();
    process.exit(1);
  });
