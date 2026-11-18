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
const FONTE_OUTRO_FORNECEDOR = `FONTE ${U} OUTRO FORNECEDOR`;
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
  let outroFornecedorId = 0;
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
  const corpoLote = (itens: Array<{ productId: number; quantidadeKg: number }>, over: Record<string, unknown> = {}) => {
    const { productId: _p, quantidadeKg: _q, ...base } = corpo(0);
    return { ...base, itens, ...over };
  };
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
    outroFornecedorId = (await prisma.supplier.create({ data: { name: `FORNECEDOR ${U} OUTRO` } })).id;
    await prisma.supplierContact.create({ data: { supplierId: outroFornecedorId, name: 'Contato Outro', email: `${runId}-outro@fornecedor.example`, isPrimary: true } });

    const fonte = async (n: string, sid: number | null) =>
      (await prisma.forecastSource.create({ data: { name: n, normalizedName: n, leadTimeDays: 30, supplierId: sid } })).id;
    const fonteOk = await fonte(FONTE, supplierId);
    const fonteSemFornecedor = await fonte(FONTE_SEM_FORNECEDOR, null);
    const fonteSemContato = await fonte(FONTE_SEM_CONTATO, supplierSemContatoId);
    const fonteOutro = await fonte(FONTE_OUTRO_FORNECEDOR, outroFornecedorId);

    const criar = async (
      letra: string,
      sourceId: number,
      fixedPriceFlag: boolean,
      fixedPrice: number | null,
      termos: { moeda?: string | null; validoAte?: string | null } = {},
    ) =>
      (
        await prisma.forecastProduct.create({
          data: {
            name: nome(letra),
            normalizedName: normalizeProductName(nome(letra)),
            sourceId,
            fixedPriceFlag,
            fixedPrice,
            fixedPriceCurrency: fixedPrice === null ? null : (termos.moeda === undefined ? 'USD' : termos.moeda),
            fixedPriceIncoterm: fixedPrice === null ? null : 'CFR',
            fixedPriceValidUntil: fixedPrice === null ? null : dateKeyToDbDate(termos.validoAte === undefined ? '2099-12-31' : (termos.validoAte as string)),
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
    ids.G = await criar('G', fonteOk, true, null); // selo da planilha, preco ainda nao cadastrado
    ids.H = await criar('H', fonteOk, true, 2, { validoAte: '2020-01-31' }); // preco vencido
    ids.I = await criar('I', fonteOk, true, 2, { moeda: null }); // preco incompleto (sem moeda)
    ids.J = await criar('J', fonteOk, true, 3.5); // elegivel, par do A num envio de varios itens
    ids.L = await criar('L', fonteOk, true, 0.75); // elegivel, 3o item do envio de varios itens
    ids.K = await criar('K', fonteOutro, true, 4); // elegivel, mas de OUTRO fornecedor

    const letras = ['A', 'B', 'C', 'D', 'E', 'G', 'H', 'I', 'J', 'L', 'K'];
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
    await prisma.supplierContact.deleteMany({ where: { supplierId: { in: [supplierId, supplierSemContatoId, outroFornecedorId] } } });
    await prisma.supplier.deleteMany({ where: { id: { in: [supplierId, supplierSemContatoId, outroFornecedorId] } } });
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
    expect(po).toMatchObject({ currency: 'USD', incoterm: 'CFR' });
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

  testDbSkip('preco ausente, incompleto ou vencido: 409 no envio e nos destinatarios, e nada e criado', async () => {
    const esperado: Record<string, RegExp> = { G: /ainda não foi cadastrado/, I: /ainda não foi cadastrado/, H: /venceu em 31\/01\/2020/ };
    for (const letra of ['G', 'I', 'H']) {
      const envio = await enviar(corpo(ids[letra]!));
      expect(envio.status, letra).toBe(409);
      expect(envio.body.message, letra).toMatch(esperado[letra]!);
      const dest = await request(app)
        .get(`/api/v1/forecast/snapshots/${snapshotId}/po-preco-fechado/destinatarios?productId=${ids[letra]}`)
        .set('Cookie', cookies);
      expect(dest.status, letra).toBe(409);
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

  testDbSkip('destinatarios: a mesma lista do envio; bloqueios (preco fechado, fonte, contato) avisam ANTES do formulario', async () => {
    const url = (productId: number) =>
      request(app).get(`/api/v1/forecast/snapshots/${snapshotId}/po-preco-fechado/destinatarios?productId=${productId}`).set('Cookie', cookies);
    const ok = await url(ids.A!);
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ fornecedor: `FORNECEDOR ${U}`, to: { name: 'Contato Principal', email: EMAIL_PRINCIPAL } });
    expect(ok.body.data.contactCc).toEqual([{ name: 'Contato Copia', email: EMAIL_COPIA }]);
    expect(ok.body.data.cc).toContain(EMAIL_COPIA);
    expect(JSON.stringify(ok.body)).not.toContain('1.8425'); // nunca o preco
    for (const letra of ['B', 'C', 'D']) {
      expect((await url(ids[letra]!)).status, letra).toBe(409);
    }
    expect((await url(ids.F!)).status).toBe(400);
  });

  describe('varios itens num envio (um e-mail, uma PO por item)', () => {
    testDbSkip('envia A e J juntos: UM e-mail, duas POs enviadas, cada item soma na propria Qtd. final', async () => {
      const k = chave();
      const res = await enviar(corpoLote([{ productId: ids.J!, quantidadeKg: 2000 }, { productId: ids.L!, quantidadeKg: 500.5 }], { chaveEnvio: k }));
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.data).toMatchObject({ jaEnviada: false, registro: 'ok', para: EMAIL_PRINCIPAL });
      expect(res.body.data.purchaseOrderIds).toHaveLength(2);
      expect(res.body.data.itens.map((i: { productId: number; qtdFinalKg: number; statusDaDecisao: string }) => [i.productId, i.qtdFinalKg, i.statusDaDecisao])).toEqual([
        [ids.J, 2000, 'po'],
        [ids.L, 500.5, 'po'],
      ]);

      const [poJ] = await pos(ids.J!);
      const [poL] = await pos(ids.L!);
      expect(poJ).toMatchObject({ status: 'enviada', requestKey: `${k}-${ids.J}`, currency: 'USD', incoterm: 'CFR' });
      expect(Number(poJ!.unitPrice)).toBe(3.5);
      expect(Number(poL!.quantityKg)).toBe(500.5);
      expect(Number(poL!.unitPrice)).toBe(0.75);
      expect(Number((await decisao(ids.J!))!.finalKg)).toBe(2000);
      expect(Number((await decisao(ids.L!))!.finalKg)).toBe(500.5);

      // UM e-mail para os dois itens (relacionado a primeira PO), com a lista das POs nas variaveis
      const logs = await emails(poJ!.id);
      expect(logs).toHaveLength(1);
      expect(await emails(poL!.id)).toHaveLength(0);
      expect(logs[0]!.subject).toBe(`Purchase Order - ${U}`);
      expect(JSON.stringify(logs[0]!.templateVars)).toContain(String(poL!.id));
    });

    testDbSkip('repetir o mesmo envio (mesma chave e mesma lista): 200, nada enviado nem somado de novo', async () => {
      const [poJ] = await pos(ids.J!);
      const chaveBase = poJ!.requestKey.replace(`-${ids.J}`, '');
      const res = await enviar(corpoLote([{ productId: ids.J!, quantidadeKg: 2000 }, { productId: ids.L!, quantidadeKg: 500.5 }], { chaveEnvio: chaveBase }));
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ jaEnviada: true });
      expect(res.body.data.itens.map((i: { qtdFinalKg: number }) => i.qtdFinalKg)).toEqual([2000, 500.5]);
      expect(await pos(ids.J!)).toHaveLength(1);
      expect(await emails(poJ!.id)).toHaveLength(1);
    });

    testDbSkip('itens de fornecedores diferentes: 409, nada criado (nem para o item que estava certo)', async () => {
      const antes = await prisma.forecastPurchaseOrder.count({ where: { snapshotId } });
      const res = await enviar(corpoLote([{ productId: ids.A!, quantidadeKg: 1 }, { productId: ids.K!, quantidadeKg: 1 }]));
      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/fornecedores diferentes/);
      expect(await prisma.forecastPurchaseOrder.count({ where: { snapshotId } })).toBe(antes);
    });

    testDbSkip('um item bloqueado (sem preco) barra o envio inteiro, com o nome do item na mensagem', async () => {
      const antes = await prisma.forecastPurchaseOrder.count({ where: { snapshotId } });
      const res = await enviar(corpoLote([{ productId: ids.A!, quantidadeKg: 1 }, { productId: ids.G!, quantidadeKg: 1 }]));
      expect(res.status).toBe(409);
      expect(res.body.message).toContain(nome('G'));
      expect(res.body.message).toMatch(/ainda não foi cadastrado/);
      expect(await prisma.forecastPurchaseOrder.count({ where: { snapshotId } })).toBe(antes);
    });

    testDbSkip('item fora da lista de compra no meio do lote: 400 com o nome, nada criado', async () => {
      const antes = await prisma.forecastPurchaseOrder.count({ where: { snapshotId } });
      const res = await enviar(corpoLote([{ productId: ids.A!, quantidadeKg: 1 }, { productId: ids.E!, quantidadeKg: 1 }]));
      expect(res.status).toBe(400);
      expect(res.body.message).toContain(nome('E'));
      expect(await prisma.forecastPurchaseOrder.count({ where: { snapshotId } })).toBe(antes);
    });

    testDbSkip('e-mail recusado antes de sair (forwarder inexistente): todas as POs do lote viram falhou e nada soma', async () => {
      const k = chave();
      const antesA = Number((await decisao(ids.A!))!.finalKg);
      const antesJ = Number((await decisao(ids.J!))!.finalKg);
      const res = await enviar(corpoLote([{ productId: ids.A!, quantidadeKg: 10 }, { productId: ids.J!, quantidadeKg: 20 }], { chaveEnvio: k, forwarderId: 2_000_000_000 }));
      expect(res.status).toBe(400);
      for (const id of [ids.A!, ids.J!]) {
        const falhou = (await pos(id)).find((p) => p.requestKey === `${k}-${id}`)!;
        expect(falhou, String(id)).toMatchObject({ status: 'falhou', failureCode: 'http_400' });
      }
      expect(Number((await decisao(ids.A!))!.finalKg)).toBe(antesA);
      expect(Number((await decisao(ids.J!))!.finalKg)).toBe(antesJ);
      // a mesma chave de um lote que falhou nao reenvia: o cliente gera outra
      const repetida = await enviar(corpoLote([{ productId: ids.A!, quantidadeKg: 10 }, { productId: ids.J!, quantidadeKg: 20 }], { chaveEnvio: k }));
      expect(repetida.status).toBe(409);
      expect(repetida.body.message).toMatch(/falhou/);
    });

    testDbSkip('destinatarios de varios itens: a mesma lista do envio; fornecedores diferentes e item bloqueado avisam antes', async () => {
      const url = (lista: number[]) =>
        request(app).get(`/api/v1/forecast/snapshots/${snapshotId}/po-preco-fechado/destinatarios?productIds=${lista.join(',')}`).set('Cookie', cookies);
      const ok = await url([ids.A!, ids.J!, ids.L!]);
      expect(ok.status).toBe(200);
      expect(ok.body.data).toMatchObject({ fornecedor: `FORNECEDOR ${U}`, to: { email: EMAIL_PRINCIPAL } });
      expect((await url([ids.A!, ids.K!])).status).toBe(409);
      expect((await url([ids.A!, ids.H!])).status).toBe(409);
      expect((await url([ids.A!, ids.F!])).status).toBe(400);
    });
  });
});
