import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { normalizeProductName } from '../src/utils/forecastWorkbook';
import { hashPassword } from '../src/utils/password';

const testDbSkip = process.env.RUN_DB_TESTS !== 'true' ? it.skip : it;
const runId = `fu${Date.now()}`;

// Datas longe do dado real (2031).
const D_BASE = new Date('2031-03-10T15:00:00.000Z');
const D_NOVA = new Date('2031-04-10T15:00:00.000Z');
const D_PO = new Date('2031-05-12T15:00:00.000Z');

const EMAIL_CONTATO = `contato-${runId}@exemplo.invalid`;
const NOME_FORNECEDOR = `FORNECEDOR SINTETICO ${runId}`.toUpperCase();

interface Cotacao {
  catalogItemId: number;
  supplierId?: number;
  preco?: string;
  moeda?: string;
  unidade?: string;
  incoterm?: 'FOB' | 'CIF';
  status?: 'open' | 'closed';
  closedAt?: Date | null;
  poEm?: Date | null;
  vencedora?: boolean;
  indisponivel?: boolean;
  excluido?: Partial<Record<'cotacao' | 'itemCotacao' | 'resposta' | 'itemResposta', boolean>>;
}

describe('Forecast - ultimo preco negociado (DB)', () => {
  let cookies: string[] = [];
  let adminId = 0;
  let supplierId = 0;
  let seq = 0;
  const inicio = new Date();
  const quoteIds: number[] = [];
  const supplierIds: number[] = [];
  const catalogIds: number[] = [];

  const novoCatalogo = async (): Promise<number> => {
    seq += 1;
    const item = await prisma.catalogItem.create({
      data: { commercialName: `ITEM ${runId} ${seq}`, marketName: `MKT ${runId} ${seq}` },
    });
    catalogIds.push(item.id);
    return item.id;
  };

  // Produto com os codigos ligados aos catalogItems informados (null = codigo sem vinculo).
  const novoProduto = async (vinculos: Array<number | null>): Promise<{ id: number; codigos: string[] }> => {
    seq += 1;
    const nome = `PRODUTO ${runId} ${seq}`.toUpperCase();
    const produto = await prisma.forecastProduct.create({
      data: {
        name: nome,
        normalizedName: normalizeProductName(nome),
        codes: {
          create: vinculos.map((catalogItemId, i) => ({
            position: i + 1,
            code: `${runId}C${seq}P${i + 1}`.toUpperCase(),
            catalogItemId,
          })),
        },
      },
    });
    return { id: produto.id, codigos: vinculos.map((_, i) => `${runId}C${seq}P${i + 1}`.toUpperCase()) };
  };

  const novaCotacao = async (c: Cotacao): Promise<{ id: number; codigo: string }> => {
    seq += 1;
    const excluido = c.excluido ?? {};
    const agora = new Date();
    const status = c.status ?? 'closed';
    const cotacao = await prisma.quoteRequest.create({
      data: {
        requestCode: `QR-${runId}-${seq}`.toUpperCase(),
        desiredIncoterm: [],
        status,
        closedAt: c.closedAt === undefined ? (status === 'closed' ? D_BASE : null) : c.closedAt,
        purchaseOrderSentAt: c.poEm ?? null,
        deletedAt: excluido.cotacao ? agora : null,
        items: {
          create: [
            {
              catalogItemId: c.catalogItemId,
              productName: `ITEM ${runId}`,
              quantity: 100,
              unit: c.unidade ?? 'KG',
              deletedAt: excluido.itemCotacao ? agora : null,
            },
          ],
        },
      },
      include: { items: true },
    });
    quoteIds.push(cotacao.id);
    await prisma.quoteResponse.create({
      data: {
        quoteRequestId: cotacao.id,
        supplierId: c.supplierId ?? supplierId,
        offeredPrice: 1,
        currency: c.moeda ?? 'EUR',
        offeredIncoterm: c.incoterm ?? 'CIF',
        paymentTermsDays: 30,
        isWinner: c.vencedora ?? true,
        deletedAt: excluido.resposta ? agora : null,
        items: {
          create: [
            {
              quoteRequestItemId: cotacao.items[0].id,
              unitPrice: c.indisponivel ? 0 : (c.preco ?? '12.30'),
              quantity: c.indisponivel ? 0 : 100,
              totalPrice: 0,
              isUnavailable: c.indisponivel ?? false,
              deletedAt: excluido.itemResposta ? agora : null,
            },
          ],
        },
      },
    });
    return { id: cotacao.id, codigo: cotacao.requestCode };
  };

  const consultar = async (productId: number) => {
    const res = await request(app).get(`/api/v1/forecast/products/${productId}/ultimo-preco`).set('Cookie', cookies);
    expect(res.status).toBe(200);
    return res;
  };

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== 'true') return;

    const adminRole = await prisma.role.upsert({ where: { name: 'admin' }, update: {}, create: { name: 'admin' } });
    const user = await prisma.user.create({
      data: {
        name: `Admin Forecast Ultimo Preco ${runId}`,
        email: `${runId}@intelliquote.local`,
        passwordHash: await hashPassword('Test1234!'),
        roleId: adminRole.id,
      },
    });
    adminId = user.id;
    const login = await request(app).post('/api/v1/auth/login').send({ email: user.email, password: 'Test1234!' });
    cookies = login.headers['set-cookie'];

    const fornecedor = await prisma.supplier.create({
      data: {
        name: NOME_FORNECEDOR,
        contacts: { create: [{ name: 'Contato Sintetico', email: EMAIL_CONTATO, isPrimary: true }] },
      },
    });
    supplierId = fornecedor.id;
    supplierIds.push(fornecedor.id);
  });

  afterAll(async () => {
    if (process.env.RUN_DB_TESTS !== 'true') return;

    await prisma.quoteRequest.deleteMany({ where: { id: { in: quoteIds } } });
    await prisma.supplier.deleteMany({ where: { id: { in: supplierIds } } });
    await prisma.forecastProduct.deleteMany({ where: { name: { contains: runId.toUpperCase() } } });
    await prisma.catalogItem.deleteMany({ where: { id: { in: catalogIds } } });
    if (adminId) {
      await prisma.auditLog.deleteMany({ where: { performedById: adminId } });
      await prisma.session.deleteMany({ where: { userId: adminId } });
      await prisma.user.delete({ where: { id: adminId } });
    }
    await prisma.$disconnect();
  });

  testDbSkip('caso base: vencedora em cotacao fechada devolve valor, moeda, unidade, incoterm, fornecedor, cotacao e data', async () => {
    const catalogo = await novoCatalogo();
    const { id: produto, codigos } = await novoProduto([catalogo]);
    const cotacao = await novaCotacao({ catalogItemId: catalogo });

    const res = await consultar(produto);
    expect(res.body.data).toEqual({
      productId: produto,
      motivo: null,
      ultimoPreco: {
        valorUnitario: '12.30',
        moeda: 'EUR',
        unidade: 'KG',
        incoterm: 'CIF',
        fornecedor: NOME_FORNECEDOR,
        cotacao: { id: cotacao.id, codigo: cotacao.codigo },
        fechadaEm: '2031-03-10',
        poEnviadaEm: null,
        catalogItemId: catalogo,
        codigos,
      },
    });
  });

  testDbSkip('a mais recente entre duas fechadas vence', async () => {
    const catalogo = await novoCatalogo();
    const { id: produto } = await novoProduto([catalogo]);
    await novaCotacao({ catalogItemId: catalogo, preco: '5.00', closedAt: D_BASE });
    const nova = await novaCotacao({ catalogItemId: catalogo, preco: '7.50', closedAt: D_NOVA });
    const res = await consultar(produto);
    expect(res.body.data.ultimoPreco).toMatchObject({ valorUnitario: '7.50', cotacao: { id: nova.id } });
  });

  describe.each([
    ['QuoteRequest', { cotacao: true }],
    ['QuoteRequestItem', { itemCotacao: true }],
    ['QuoteResponse', { resposta: true }],
    ['QuoteResponseItem', { itemResposta: true }],
  ] as Array<[string, Cotacao['excluido']]>)('soft delete em %s', (_nivel, excluido) => {
    testDbSkip('uma cotacao mais recente com o nivel excluido e ignorada (continua a base)', async () => {
      const catalogo = await novoCatalogo();
      const { id: produto } = await novoProduto([catalogo]);
      const base = await novaCotacao({ catalogItemId: catalogo, preco: '5.00', closedAt: D_BASE });
      await novaCotacao({ catalogItemId: catalogo, preco: '9.99', closedAt: D_NOVA, excluido });
      const res = await consultar(produto);
      expect(res.body.data.ultimoPreco).toMatchObject({ valorUnitario: '5.00', cotacao: { id: base.id } });
    });
  });

  testDbSkip('resposta NAO vencedora mais recente e ignorada', async () => {
    const catalogo = await novoCatalogo();
    const { id: produto } = await novoProduto([catalogo]);
    const base = await novaCotacao({ catalogItemId: catalogo, preco: '5.00', closedAt: D_BASE });
    await novaCotacao({ catalogItemId: catalogo, preco: '9.99', closedAt: D_NOVA, vencedora: false });
    const res = await consultar(produto);
    expect(res.body.data.ultimoPreco).toMatchObject({ valorUnitario: '5.00', cotacao: { id: base.id } });
  });

  testDbSkip('item indisponivel (preco 0) da vencedora mais recente e ignorado', async () => {
    const catalogo = await novoCatalogo();
    const { id: produto } = await novoProduto([catalogo]);
    const base = await novaCotacao({ catalogItemId: catalogo, preco: '5.00', closedAt: D_BASE });
    await novaCotacao({ catalogItemId: catalogo, closedAt: D_NOVA, indisponivel: true });
    const res = await consultar(produto);
    expect(res.body.data.ultimoPreco).toMatchObject({ valorUnitario: '5.00', cotacao: { id: base.id } });
  });

  testDbSkip('cotacao ABERTA com vencedora e sem PO e ignorada', async () => {
    const catalogo = await novoCatalogo();
    const { id: produto } = await novoProduto([catalogo]);
    const base = await novaCotacao({ catalogItemId: catalogo, preco: '5.00', closedAt: D_BASE });
    await novaCotacao({ catalogItemId: catalogo, preco: '9.99', status: 'open', closedAt: null });
    const res = await consultar(produto);
    expect(res.body.data.ultimoPreco).toMatchObject({ valorUnitario: '5.00', cotacao: { id: base.id } });
  });

  testDbSkip('cotacao ABERTA com PO enviada e considerada (fechadaEm nulo, poEnviadaEm preenchido)', async () => {
    const catalogo = await novoCatalogo();
    const { id: produto } = await novoProduto([catalogo]);
    await novaCotacao({ catalogItemId: catalogo, preco: '5.00', closedAt: D_BASE });
    const comPo = await novaCotacao({
      catalogItemId: catalogo,
      preco: '9.99',
      status: 'open',
      closedAt: null,
      poEm: D_PO,
    });
    const res = await consultar(produto);
    expect(res.body.data.ultimoPreco).toMatchObject({
      valorUnitario: '9.99',
      cotacao: { id: comPo.id },
      fechadaEm: null,
      poEnviadaEm: '2031-05-12',
    });
  });

  testDbSkip('2 codigos em catalogItems diferentes: vence a mais recente e codigos so do catalogItem vencedor', async () => {
    const catA = await novoCatalogo();
    const catB = await novoCatalogo();
    const { id: produto, codigos } = await novoProduto([catA, catB]);
    await novaCotacao({ catalogItemId: catA, preco: '5.00', closedAt: D_BASE });
    const nova = await novaCotacao({ catalogItemId: catB, preco: '8.00', closedAt: D_NOVA });
    const res = await consultar(produto);
    const { ultimoPreco } = res.body.data;
    expect(ultimoPreco).toMatchObject({ valorUnitario: '8.00', cotacao: { id: nova.id }, catalogItemId: catB });
    expect(ultimoPreco.codigos).toEqual([codigos[1]]);
  });

  testDbSkip('produto sem vinculo -> sem_vinculo_catalogo; vinculado sem cotacao -> sem_cotacao_vencedora', async () => {
    const { id: semVinculo } = await novoProduto([null, null]);
    const a = await consultar(semVinculo);
    expect(a.body.data).toEqual({ productId: semVinculo, ultimoPreco: null, motivo: 'sem_vinculo_catalogo' });

    const catalogo = await novoCatalogo();
    const { id: vinculado } = await novoProduto([catalogo]);
    const b = await consultar(vinculado);
    expect(b.body.data).toEqual({ productId: vinculado, ultimoPreco: null, motivo: 'sem_cotacao_vencedora' });
  });

  testDbSkip('produto inexistente -> 404', async () => {
    const res = await request(app).get('/api/v1/forecast/products/2147483000/ultimo-preco').set('Cookie', cookies);
    expect(res.status).toBe(404);
  });

  testDbSkip('fornecedor com deletedAt: o preco aparece com o nome (fato historico)', async () => {
    const excluido = await prisma.supplier.create({
      data: { name: `${NOME_FORNECEDOR} EXCLUIDO`, deletedAt: new Date() },
    });
    supplierIds.push(excluido.id);
    const catalogo = await novoCatalogo();
    const { id: produto } = await novoProduto([catalogo]);
    await novaCotacao({ catalogItemId: catalogo, supplierId: excluido.id, preco: '3.21' });
    const res = await consultar(produto);
    expect(res.body.data.ultimoPreco).toMatchObject({
      valorUnitario: '3.21',
      fornecedor: `${NOME_FORNECEDOR} EXCLUIDO`,
    });
  });

  testDbSkip('a resposta nao contem o e-mail do contato nem outros dados do fornecedor', async () => {
    const catalogo = await novoCatalogo();
    const { id: produto } = await novoProduto([catalogo]);
    await novaCotacao({ catalogItemId: catalogo });
    const res = await consultar(produto);
    const texto = JSON.stringify(res.body);
    expect(texto).not.toContain(EMAIL_CONTATO);
    expect(texto).not.toContain('exemplo.invalid');
    expect(texto).not.toMatch(/contacts|email|website|notes|targetPrice|totalLandedCost/);
  });

  testDbSkip('so leitura: nenhuma linha de AuditLog de forecast/cotacao foi criada durante o teste', async () => {
    const catalogo = await novoCatalogo();
    const { id: produto } = await novoProduto([catalogo]);
    await novaCotacao({ catalogItemId: catalogo });
    await consultar(produto);
    const logs = await prisma.auditLog.findMany({
      where: {
        createdAt: { gte: inicio },
        OR: [{ entityType: { startsWith: 'forecast' } }, { entityType: { startsWith: 'quote' } }],
      },
    });
    expect(logs).toEqual([]);
  });
});
