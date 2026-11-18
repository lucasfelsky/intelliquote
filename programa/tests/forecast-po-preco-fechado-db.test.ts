import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { rotulosDaQuinzena } from '../src/utils/forecastMonths';
import { dateKeyToDbDate } from '../src/utils/supplierDocumentDates';
import { normalizeProductName } from '../src/utils/forecastWorkbook';
import { hashPassword } from '../src/utils/password';

const testDbSkip = process.env.RUN_DB_TESTS !== 'true' ? it.skip : it;
const runId = `pf${Date.now()}`;

// PO direta de item de PRECO FECHADO de ponta a ponta (HTTP + banco + e-mail em modo console). Tudo SINTETICO (repo publico).
const BASE_DATE = '2037-04-15';
const rotulos = rotulosDaQuinzena(BASE_DATE);
const U = runId.toUpperCase();
const FONTE = `FONTE ${U}`;
const FONTE_SEM_FORNECEDOR = `FONTE ${U} SEM FORNECEDOR`;
const FONTE_SEM_CONTATO = `FONTE ${U} SEM CONTATO`;
const codigo = (letra: string) => `${U}${letra}1`;
const nome = (letra: string) => `PRODUTO ${U} ${letra}`;
const EMAIL_PRINCIPAL = `${runId}-principal@fornecedor.example`;
const EMAIL_COPIA = `${runId}-copia@fornecedor.example`;

const PDF = Buffer.from('%PDF-1.4 sintetico').toString('base64');

const produtoCongelado = (linha: number, letra: string, id: number) => ({
  linha,
  n: linha - 2,
  item: nome(letra),
  codigos: [codigo(letra), '', '', '', '', '', ''],
  historico: [10, 20, 30, 40, 50],
  analiseForecast: null,
  obs: '',
  fonte: FONTE,
  precoFechado: 'X',
  embalagem: '',
  naoFraciona: '',
  qtdAmostra: '',
  solicitarAmostra: '',
  status: 'nao',
  productId: id,
});

describe('Forecast - PO direta de item de preco fechado (DB)', () => {
  let cookies: string[] = [];
  let adminId = 0;
  let snapshotId = 0;
  let supplierId = 0;
  let supplierSemContatoId = 0;
  const ids: Record<string, number> = {};
  let seq = 0;
  const chave = () => `${runId}-c${(seq += 1)}-abcdefgh`;

  const corpo = (productId: number, over: Record<string, unknown> = {}) => ({
    productId,
    quantidadeKg: 25000,
    chaveEnvio: chave(),
    subject: `Purchase Order - ${U}`,
    forwarderInfo: 'Forwarder Sintetico, contato@forwarder.example',
    fileName: 'PO-0001.pdf',
    contentBase64: PDF,
    fileType: 'application/pdf',
    fileSize: 18,
    ...over,
  });
  const enviar = (body: object, snapshot = snapshotId) =>
    request(app).post(`/api/v1/forecast/snapshots/${snapshot}/po-preco-fechado`).set('Cookie', cookies).send(body);
  const decisao = (productId: number) =>
    prisma.forecastPurchaseDecision.findUnique({ where: { snapshotId_productId: { snapshotId, productId } } });
  const pos = (productId: number) => prisma.forecastPurchaseOrder.findMany({ where: { snapshotId, productId }, orderBy: { id: 'asc' } });
  const emails = (poId: number) =>
    prisma.mailLog.findMany({ where: { relatedEntityType: 'forecast_purchase_order', relatedEntityId: String(poId) } });

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== 'true') return;

    const adminRole = await prisma.role.upsert({ where: { name: 'admin' }, update: {}, create: { name: 'admin' } });
    const user = await prisma.user.create({
      data: { name: `Admin PO ${runId}`, email: `${runId}@intelliquote.local`, passwordHash: await hashPassword('Test1234!'), roleId: adminRole.id },
    });
    adminId = user.id;
    const login = await request(app).post('/api/v1/auth/login').send({ email: user.email, password: 'Test1234!' });
    cookies = login.headers['set-cookie'];

    supplierId = (await prisma.supplier.create({ data: { name: `FORNECEDOR ${U}` } })).id;
    await prisma.supplierContact.create({ data: { supplierId, name: 'Contato Principal', email: EMAIL_PRINCIPAL, isPrimary: true } });
    await prisma.supplierContact.create({ data: { supplierId, name: 'Contato Copia', email: EMAIL_COPIA } });
    supplierSemContatoId = (await prisma.supplier.create({ data: { name: `FORNECEDOR ${U} SEM CONTATO` } })).id;

    const fonte = async (n: string, sid: number | null) =>
      (await prisma.forecastSource.create({ data: { name: n, normalizedName: n, leadTimeDays: 30, supplierId: sid } })).id;
    const fonteOk = await fonte(FONTE, supplierId);
    const fonteSemFornecedor = await fonte(FONTE_SEM_FORNECEDOR, null);
    const fonteSemContato = await fonte(FONTE_SEM_CONTATO, supplierSemContatoId);

    const criar = async (letra: string, sourceId: number, fixedPriceFlag: boolean, fixedPrice: number | null) =>
      (
        await prisma.forecastProduct.create({
          data: {
            name: nome(letra),
            normalizedName: normalizeProductName(nome(letra)),
            sourceId,
            fixedPriceFlag,
            fixedPrice,
            codes: { create: [{ position: 1, code: codigo(letra) }] },
          },
        })
      ).id;
    ids.A = await criar('A', fonteOk, true, 1.8425); // elegivel, na lista
    ids.B = await criar('B', fonteOk, false, null); // nao e de preco fechado
    ids.C = await criar('C', fonteSemFornecedor, true, 2); // fonte sem fornecedor
    ids.D = await criar('D', fonteSemContato, true, 2); // fornecedor sem contato
    ids.E = await criar('E', fonteOk, true, 2); // fora da lista de compra (estoque de sobra)
    ids.F = await criar('F', fonteOk, true, 2); // nao faz parte da quinzena

    const letras = ['A', 'B', 'C', 'D', 'E'];
    snapshotId = (
      await prisma.forecastSnapshot.create({
        data: {
          label: '04-1',
          baseDate: dateKeyToDbDate(BASE_DATE),
          half: 1,
          origin: 'planilha',
          months: { consumo: rotulos.consumo, chegada: rotulos.chegada, programacao: rotulos.programacao },
          products: letras.map((l, i) => produtoCongelado(3 + i, l, ids[l]!)),
          inputs: {
            estoque: [{ codigo: codigo('E'), qtd: 1_000_000 }],
            vendasMes: letras.map((l) => ({ codigo: codigo(l), qtd: 400 })),
            vendasAtual: letras.map((l) => ({ codigo: codigo(l), qtd: 200 })),
            vendasAnual: letras.map((l) => ({ codigo: codigo(l), qtd: 4800 })),
            programacoes: [],
            chegadas: [],
            leadtime: [{ fonte: FONTE, total: 30 }],
            margem: [],
            clientesAtivos: [],
          },
          files: [],
          createdById: adminId,
        },
      })
    ).id;
  });

  afterAll(async () => {
    if (process.env.RUN_DB_TESTS !== 'true') return;
    const poIds = (await prisma.forecastPurchaseOrder.findMany({ where: { snapshotId }, select: { id: true } })).map((p) => p.id);
    await prisma.mailLog.deleteMany({ where: { relatedEntityType: 'forecast_purchase_order', relatedEntityId: { in: poIds.map(String) } } });
    await prisma.forecastPurchaseOrder.deleteMany({ where: { snapshotId } });
    await prisma.forecastPurchaseDecision.deleteMany({ where: { snapshotId } });
    await prisma.forecastSnapshot.deleteMany({ where: { createdById: adminId } });
    await prisma.forecastProduct.deleteMany({ where: { name: { contains: U } } });
    await prisma.forecastSource.deleteMany({ where: { name: { contains: U } } });
    await prisma.supplierContact.deleteMany({ where: { supplierId: { in: [supplierId, supplierSemContatoId] } } });
    await prisma.supplier.deleteMany({ where: { id: { in: [supplierId, supplierSemContatoId] } } });
    await prisma.auditLog.deleteMany({ where: { performedById: adminId } });
    if (adminId) {
      await prisma.session.deleteMany({ where: { userId: adminId } });
      await prisma.user.delete({ where: { id: adminId } });
    }
    await prisma.$disconnect();
  });

  testDbSkip('envia a PO: e-mail para o contato principal, PO enviada, decisao criada em "PO enviada" com a Qtd. final', async () => {
    const res = await enviar(corpo(ids.A!));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data).toMatchObject({ jaEnviada: false, registro: 'ok', qtdFinalKg: 25000, statusDaDecisao: 'po', para: EMAIL_PRINCIPAL });
    expect(res.body.data.copia).toContain(EMAIL_COPIA);

    const [po] = await pos(ids.A!);
    expect(po).toMatchObject({ status: 'enviada', supplierId, createdById: adminId });
    expect(Number(po!.quantityKg)).toBe(25000);
    expect(Number(po!.unitPrice)).toBeCloseTo(1.8425, 4); // copia do cadastro, nunca do corpo
    expect(po!.sentAt).not.toBeNull();

    const d = await decisao(ids.A!);
    expect(d).toMatchObject({ status: 'po', manuallyIncluded: false });
    expect(Number(d!.finalKg)).toBe(25000);
    expect(Number(d!.quantityKg)).toBe(25000);
    expect(d!.finalAt).not.toBeNull();

    const logs = await emails(po!.id);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ toEmail: EMAIL_PRINCIPAL, templateId: 'quote-po' });
    expect(logs[0]!.subject).toBe(`Purchase Order - ${U}`);
  });

  testDbSkip('o preco nao vai ao AuditLog nem ao MailLog', async () => {
    const [po] = await pos(ids.A!);
    const auditoria = JSON.stringify(await prisma.auditLog.findMany({ where: { performedById: adminId } }));
    expect(auditoria).not.toContain('1.8425');
    const logs = JSON.stringify(await emails(po!.id));
    expect(logs).not.toContain('1.8425');
  });

  testDbSkip('repetir a mesma chave devolve 200 e NAO envia nem soma de novo', async () => {
    const [primeira] = await pos(ids.A!);
    const res = await enviar(corpo(ids.A!, { chaveEnvio: primeira!.requestKey, quantidadeKg: 999 }));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ jaEnviada: true, purchaseOrderId: primeira!.id, qtdFinalKg: 25000 });
    expect(await pos(ids.A!)).toHaveLength(1);
    expect(await emails(primeira!.id)).toHaveLength(1);
    expect(Number((await decisao(ids.A!))!.finalKg)).toBe(25000);
  });

  testDbSkip('uma 2a PO do mesmo item SOMA na Qtd. final (a quantidade decidida nao muda)', async () => {
    const res = await enviar(corpo(ids.A!, { quantidadeKg: 5000.5 }));
    expect(res.status).toBe(201);
    expect(res.body.data.qtdFinalKg).toBe(30000.5);
    const d = await decisao(ids.A!);
    expect(Number(d!.finalKg)).toBe(30000.5);
    expect(Number(d!.quantityKg)).toBe(25000);
    expect(await pos(ids.A!)).toHaveLength(2);
  });

  testDbSkip('item sem preco fechado, fonte sem fornecedor, fornecedor sem contato: 409 e nada e criado', async () => {
    for (const letra of ['B', 'C', 'D']) {
      const res = await enviar(corpo(ids[letra]!));
      expect(res.status, letra).toBe(409);
      expect(await pos(ids[letra]!), letra).toHaveLength(0);
      expect(await decisao(ids[letra]!), letra).toBeNull();
    }
  });

  testDbSkip('item fora da lista de compra: 400; produto fora da quinzena: 400; quinzena inexistente: 404', async () => {
    const fora = await enviar(corpo(ids.E!));
    expect(fora.status).toBe(400);
    expect(fora.body.message).toMatch(/lista de compra/);
    expect((await enviar(corpo(ids.F!))).status).toBe(400);
    expect((await enviar(corpo(ids.A!), 2_000_000_000)).status).toBe(404);
    expect(await pos(ids.E!)).toHaveLength(0);
  });

  testDbSkip('e-mail recusado antes de sair (forwarder inexistente): 400, PO falhou e nada soma; reenvio com chave nova funciona', async () => {
    const antes = Number((await decisao(ids.A!))!.finalKg);
    const k = chave();
    const res = await enviar(corpo(ids.A!, { chaveEnvio: k, forwarderId: 2_000_000_000, quantidadeKg: 100 }));
    expect(res.status).toBe(400);
    const falhou = (await pos(ids.A!)).find((p) => p.requestKey === k)!;
    expect(falhou).toMatchObject({ status: 'falhou', failureCode: 'http_400' });
    expect(await emails(falhou.id)).toHaveLength(0);
    expect(Number((await decisao(ids.A!))!.finalKg)).toBe(antes);

    // a mesma chave de uma PO que falhou nao reenvia: o cliente gera outra
    const repetida = await enviar(corpo(ids.A!, { chaveEnvio: k }));
    expect(repetida.status).toBe(409);
    expect(repetida.body.message).toMatch(/falhou/);

    const ok = await enviar(corpo(ids.A!, { quantidadeKg: 100 }));
    expect(ok.status).toBe(201);
    expect(Number((await decisao(ids.A!))!.finalKg)).toBe(antes + 100);
  });
});
