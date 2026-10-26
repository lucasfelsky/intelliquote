import exceljs from 'exceljs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { rotulosDaQuinzena } from '../src/utils/forecastMonths';
import { dateKeyToDbDate } from '../src/utils/supplierDocumentDates';
import { normalizeProductName } from '../src/utils/forecastWorkbook';
import { hashPassword } from '../src/utils/password';

const testDbSkip = process.env.RUN_DB_TESTS !== 'true' ? it.skip : it;
const runId = `fd${Date.now()}`;

// Demanda do comercial (PR 6d) no banco real. Tudo SINTETICO (repo publico). Caso E do plano: base 2026-10-15, hoje 2026-10-20
// (so para o calculo do relatorio; a data de necessidade e validada contra o relogio real e por isso fica em 2027).
const BASE = '2026-10-15';
const HOJE = '2026-10-20';
const rotulos = rotulosDaQuinzena(BASE);

const U = runId.toUpperCase();
const CODE_A = `${U}A1`;
const CODE_B = `${U}B1`;
const NAME_A = `PRODUTO ${U} A`;
const NAME_B = `PRODUTO ${U} B`;
const FONTE = `FONTE ${U}`;
const MOTIVO = `MOTIVO SINTETICO ${U}`;
const CLIENTE = `CLIENTE SINTETICO ${U}`;

const produtoBase = (linha: number, item: string, codigo: string, id: number) => ({
  linha,
  n: linha - 2,
  item,
  codigos: [codigo, '', '', '', '', '', ''],
  historico: [300, 300, 300, 300, 300],
  analiseForecast: null,
  obs: '',
  fonte: FONTE,
  precoFechado: '',
  embalagem: '',
  naoFraciona: '',
  qtdAmostra: '',
  solicitarAmostra: '',
  status: 'nao',
  productId: id,
});

describe('Forecast - demanda do comercial (DB)', () => {
  let cookies: string[] = [];
  let adminId = 0;
  let productA = 0;
  let productB = 0;
  let productInativo = 0;
  let snapshot = 0;
  // Solicitacao SINTETICA: a demanda so aceita numero de Solicitacao que existe (consulta por id, sem FK).
  let solicitacaoId = 0;

  const base = '/api/v1/forecast/commercial-demands';
  const post = (body: object) => request(app).post(base).set('Cookie', cookies).send(body);
  const patch = (id: number, body: object) => request(app).patch(`${base}/${id}`).set('Cookie', cookies).send(body);
  const corpo = (over: Record<string, unknown> = {}) => ({
    productId: productA,
    quantidadeKg: 1600,
    necessidade: '2027-02-10',
    motivo: MOTIVO,
    cliente: CLIENTE,
    ...over,
  });

  type ItemDemanda = {
    id: number;
    productId: number;
    item: string;
    kg: number;
    necessidade: string;
    situacao: string;
    saldoLivre: number | null;
    sugerido: number;
    noRelatorio: boolean;
    motivo: string;
    cliente: string | null;
    solicitacaoId: number | null;
  };
  const relatorio = async () => {
    const res = await request(app)
      .get(`/api/v1/forecast/snapshots/${snapshot}/relatorio-compras?hoje=${HOJE}`)
      .set('Cookie', cookies);
    expect(res.status).toBe(200);
    return res.body.data as {
      totais: { itens: number };
      grupos: Array<{ itens: Array<{ productId: number | null; quantidadeSugerida: number; demandaComercialKg?: number }> }>;
      demandaComercial: { itens: ItemDemanda[]; totais: { abertas: number; sugeridoKg: number } };
    };
  };
  const logs = (id: number) =>
    prisma.auditLog.findMany({
      where: { entityType: 'forecast_commercial_demand', entityId: String(id) },
      orderBy: { id: 'asc' },
    });

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== 'true') return;

    const adminRole = await prisma.role.upsert({ where: { name: 'admin' }, update: {}, create: { name: 'admin' } });
    const user = await prisma.user.create({
      data: {
        name: `Admin Forecast Demanda ${runId}`,
        email: `${runId}@intelliquote.local`,
        passwordHash: await hashPassword('Test1234!'),
        roleId: adminRole.id,
      },
    });
    adminId = user.id;
    solicitacaoId = (await prisma.commercialRequest.create({ data: { requestedById: adminId } })).id;
    const login = await request(app).post('/api/v1/auth/login').send({ email: user.email, password: 'Test1234!' });
    cookies = login.headers['set-cookie'];

    await prisma.forecastSource.create({ data: { name: FONTE, normalizedName: FONTE, leadTimeDays: 60 } });
    const criar = async (name: string, code: string, isActive = true) =>
      (
        await prisma.forecastProduct.create({
          data: {
            name,
            normalizedName: normalizeProductName(name),
            isActive,
            codes: { create: [{ position: 1, code }] },
          },
        })
      ).id;
    productA = await criar(NAME_A, CODE_A);
    productB = await criar(NAME_B, CODE_B);
    productInativo = await criar(`PRODUTO ${U} INATIVO`, `${U}I1`, false);

    // Quinzena 2 (planilha) so com o PRODUTO A, caso E: Q 300, estoque 2.000, sem chegada nem programacao, lead time 60
    // -> AN +1.100 (fora da lista) e projecao [1700, 1400, 1100, 800, 500, 200]. O PRODUTO B nao tem linha na quinzena.
    const inputs = {
      estoque: [{ codigo: CODE_A, qtd: 2000 }],
      vendasMes: [{ codigo: CODE_A, qtd: 300 }],
      vendasAtual: [{ codigo: CODE_A, qtd: 100 }],
      vendasAnual: [{ codigo: CODE_A, qtd: 3300 }],
      programacoes: [],
      chegadas: [],
      leadtime: [{ fonte: FONTE, total: 60 }],
      margem: [],
      clientesAtivos: [],
    };
    snapshot = (
      await prisma.forecastSnapshot.create({
        data: {
          label: '10-2',
          baseDate: dateKeyToDbDate(BASE),
          half: 2,
          origin: 'planilha',
          months: { consumo: rotulos.consumo, chegada: rotulos.chegada, programacao: rotulos.programacao },
          products: [produtoBase(3, NAME_A, CODE_A, productA)],
          inputs,
          files: [],
          createdById: adminId,
        },
      })
    ).id;
  });

  afterAll(async () => {
    if (process.env.RUN_DB_TESTS !== 'true') return;

    await prisma.forecastCommercialDemand.deleteMany({ where: { product: { name: { contains: U } } } });
    await prisma.forecastSnapshot.deleteMany({ where: { createdById: adminId } });
    // A Solicitacao sintetica sai ANTES do usuario (requestedBy e onDelete: Restrict).
    await prisma.commercialRequest.deleteMany({ where: { requestedById: adminId } });
    await prisma.forecastProduct.deleteMany({ where: { name: { contains: U } } });
    await prisma.forecastSource.deleteMany({ where: { name: { contains: U } } });
    await prisma.auditLog.deleteMany({ where: { performedById: adminId } });
    if (adminId) {
      await prisma.session.deleteMany({ where: { userId: adminId } });
      await prisma.user.delete({ where: { id: adminId } });
    }
    await prisma.$disconnect();
  });

  let idCasoE = 0;
  let idNoHorizonte = 0;

  testDbSkip('sem pedido: o relatorio tem a secao vazia e o item que nao aponta falta fica fora da lista', async () => {
    const r = await relatorio();
    expect(r.demandaComercial).toEqual({ itens: [], totais: { abertas: 0, sugeridoKg: 0 } });
    expect(r.totais.itens).toBe(0);
  });

  testDbSkip('lanca o pedido do caso E: 201, linha gravada (data sem fuso, kg exato) e 1 AuditLog sem motivo nem cliente', async () => {
    const res = await post(corpo({ solicitacaoId }));
    expect(res.status).toBe(201);
    idCasoE = res.body.data.id;
    expect(res.body.data).toMatchObject({
      productId: productA,
      produto: NAME_A,
      fonte: null, // o produto de teste nao tem fonte no cadastro (a do relatorio vem da linha da quinzena)
      quantidadeKg: 1600,
      necessidade: '2027-02-10',
      motivo: MOTIVO,
      cliente: CLIENTE,
      solicitacaoId,
      status: 'aberta',
      fechadaEm: null,
    });
    const row = await prisma.forecastCommercialDemand.findUniqueOrThrow({ where: { id: idCasoE } });
    expect(Number(row.quantityKg)).toBe(1600);
    expect(row.neededBy.toISOString().slice(0, 10)).toBe('2027-02-10');
    expect(row).toMatchObject({ status: 'aberta', createdById: adminId, closedAt: null, closedById: null, commercialRequestId: solicitacaoId });

    const registros = await logs(idCasoE);
    expect(registros).toHaveLength(1);
    expect(registros[0]).toMatchObject({ action: 'create', performedById: adminId });
    expect(registros[0].metadata).toEqual({
      productId: productA,
      quantidadeKg: 1600,
      necessidade: '2027-02-10',
      status: 'aberta',
      solicitacaoId,
    });
    expect(JSON.stringify(registros[0])).not.toContain(U);
  });

  testDbSkip('relatorio: alem do horizonte, saldo livre 500, sugerido 1.100 e o item segue fora da lista de compra', async () => {
    const r = await relatorio();
    expect(r.demandaComercial.totais).toEqual({ abertas: 1, sugeridoKg: 1100 });
    expect(r.demandaComercial.itens[0]).toMatchObject({
      id: idCasoE,
      item: NAME_A,
      kg: 1600,
      necessidade: '2027-02-10',
      situacao: 'alem-do-horizonte',
      saldoLivre: 500,
      sugerido: 1100,
      noRelatorio: false,
      motivo: MOTIVO,
      cliente: CLIENTE,
      solicitacaoId,
    });
    expect(r.totais.itens).toBe(0);
  });

  testDbSkip('pedido dentro do horizonte (2026-12-01) e de produto sem linha na quinzena: listados sem somar', async () => {
    const dentro = await post(corpo({ necessidade: '2026-12-01', quantidadeKg: 900, motivo: `${MOTIVO} DENTRO`, cliente: undefined }));
    expect(dentro.status).toBe(201);
    idNoHorizonte = dentro.body.data.id;
    const fora = await post(corpo({ productId: productB, quantidadeKg: 50.5, necessidade: '2027-03-01', motivo: `${MOTIVO} FORA` }));
    expect(fora.status).toBe(201);

    const r = await relatorio();
    expect(r.demandaComercial.totais).toEqual({ abertas: 3, sugeridoKg: 1100 });
    const porId = new Map(r.demandaComercial.itens.map((i) => [i.id, i]));
    expect(porId.get(idNoHorizonte)).toMatchObject({ situacao: 'no-horizonte', sugerido: 0, saldoLivre: null });
    expect(porId.get(fora.body.data.id)).toMatchObject({
      productId: productB,
      item: NAME_B,
      situacao: 'fora-da-quinzena',
      kg: 50.5,
      sugerido: 0,
    });
    // Ordem: data de necessidade.
    expect(r.demandaComercial.itens.map((i) => i.necessidade)).toEqual(['2026-12-01', '2027-02-10', '2027-03-01']);
  });

  testDbSkip('GET lista por status e por produto (leitura COMEX), com os dados do pedido', async () => {
    const abertas = await request(app).get(`${base}?status=aberta&productId=${productA}`).set('Cookie', cookies);
    expect(abertas.status).toBe(200);
    expect((abertas.body.data as Array<{ id: number }>).map((d) => d.id).sort()).toEqual([idCasoE, idNoHorizonte].sort());
    const fechadas = await request(app).get(`${base}?status=comprada`).set('Cookie', cookies);
    expect(fechadas.body.data.filter((d: { produto: string }) => d.produto.includes(U))).toEqual([]);
  });

  testDbSkip('editar o kg do pedido muda o sugerido (1.700 -> 1.200); AuditLog update com os campos alterados', async () => {
    const res = await patch(idCasoE, { quantidadeKg: 1700 });
    expect(res.status).toBe(200);
    expect(res.body.data.quantidadeKg).toBe(1700);
    expect((await relatorio()).demandaComercial.itens.find((i) => i.id === idCasoE)).toMatchObject({ sugerido: 1200, saldoLivre: 500 });
    const registros = await logs(idCasoE);
    expect(registros.at(-1)).toMatchObject({ action: 'update' });
    expect(registros.at(-1)?.metadata).toMatchObject({ quantidadeKg: 1700, camposAlterados: ['quantidadeKg'] });
    // Sem alteracao real nao grava nem audita.
    const antes = (await logs(idCasoE)).length;
    expect((await patch(idCasoE, { quantidadeKg: 1700 })).status).toBe(200);
    expect(await logs(idCasoE)).toHaveLength(antes);
    // Volta ao valor do caso E.
    expect((await patch(idCasoE, { quantidadeKg: 1600 })).status).toBe(200);
  });

  testDbSkip('a compra feita some do sugerido: chegada de 1.100 kg em fev/2027 sobe o saldo livre e o pedido fica coberto', async () => {
    const atual = await prisma.forecastSnapshot.findUniqueOrThrow({ where: { id: snapshot } });
    const inputs = atual.inputs as unknown as { chegadas: unknown[] };
    await prisma.forecastSnapshot.update({
      where: { id: snapshot },
      data: { inputs: { ...inputs, chegadas: [{ codigo: CODE_A, qtd: 1100, mes: rotulos.chegada[4] }] } },
    });
    const item = (await relatorio()).demandaComercial.itens.find((i) => i.id === idCasoE);
    // Fev/2027: projecao 500 + 1.100 de chegada = 1.600 >= pedido -> nada a somar, mas o pedido segue aberto ate fechar.
    expect(item).toMatchObject({ saldoLivre: 1600, sugerido: 0, situacao: 'alem-do-horizonte' });
    // Restaura a quinzena do caso E para os proximos passos.
    await prisma.forecastSnapshot.update({ where: { id: snapshot }, data: { inputs: atual.inputs as object } });
    expect((await relatorio()).demandaComercial.itens.find((i) => i.id === idCasoE)?.sugerido).toBe(1100);
  });

  testDbSkip('XLSX do relatorio traz a aba "Demanda do comercial" com Observação ainda a ultima coluna', async () => {
    const res = await request(app)
      .get(`/api/v1/forecast/snapshots/${snapshot}/relatorio-compras/xlsx?hoje=${HOJE}`)
      .set('Cookie', cookies);
    expect(res.status).toBe(200);
    const wb = new exceljs.Workbook();
    await wb.xlsx.load(Buffer.from(res.body.data.contentBase64, 'base64') as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toContain('Demanda do comercial');
    const ws = wb.getWorksheet('Demanda do comercial')!;
    const cabecalho = (ws.getRow(1).values as Array<string | undefined>).slice(1);
    expect(cabecalho.at(-1)).toBe('Observação');
    expect(cabecalho).toContain('Sugerido');
    const linhas: Array<Array<string | number | undefined>> = [];
    ws.eachRow((row, n) => {
      if (n > 1) linhas.push((row.values as Array<string | number | undefined>).slice(1));
    });
    expect(linhas).toHaveLength(3);
    const caso = linhas.find((l) => l[2] === '10/02/2027')!;
    expect(caso[0]).toBe(NAME_A);
    expect(caso[3]).toBe(1600);
    expect(caso[4]).toBe(500);
    expect(caso[5]).toBe(1100);
  });

  testDbSkip('fechar como comprada: grava status, quem e quando; sai da secao; AuditLog close; nao reabre nem edita (409)', async () => {
    const res = await patch(idCasoE, { status: 'comprada', nota: 'PO SINTETICA 1' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'comprada', notaFechamento: 'PO SINTETICA 1' });
    expect(res.body.data.fechadaEm).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const row = await prisma.forecastCommercialDemand.findUniqueOrThrow({ where: { id: idCasoE } });
    expect(row).toMatchObject({ status: 'comprada', closeNote: 'PO SINTETICA 1', closedById: adminId });
    expect(row.closedAt).toBeInstanceOf(Date);

    const r = await relatorio();
    expect(r.demandaComercial.itens.some((i) => i.id === idCasoE)).toBe(false);
    expect(r.demandaComercial.totais).toEqual({ abertas: 2, sugeridoKg: 0 });

    const fechamento = (await logs(idCasoE)).at(-1);
    expect(fechamento).toMatchObject({ action: 'close', performedById: adminId });
    expect(fechamento?.metadata).toMatchObject({ status: 'comprada', comNota: true, quantidadeKg: 1600 });
    expect(JSON.stringify(fechamento)).not.toContain('PO SINTETICA');

    expect((await patch(idCasoE, { status: 'cancelada', nota: 'TENTATIVA DE REABRIR' })).status).toBe(409);
    expect((await patch(idCasoE, { motivo: 'NOVO MOTIVO' })).status).toBe(409);
    expect((await prisma.forecastCommercialDemand.findUniqueOrThrow({ where: { id: idCasoE } })).status).toBe('comprada');
  });

  testDbSkip('corrida: dois fechamentos simultaneos do mesmo pedido -> um 200 e um 409; o primeiro fica gravado', async () => {
    const criado = await post(corpo({ quantidadeKg: 10, necessidade: '2027-04-01', motivo: `${MOTIVO} CORRIDA` }));
    expect(criado.status).toBe(201);
    const id = criado.body.data.id as number;
    const [a, b] = await Promise.all([
      patch(id, { status: 'comprada' }),
      patch(id, { status: 'virou_programacao', nota: 'PROGRAMACAO SINTETICA' }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const vencedor = a.status === 200 ? 'comprada' : 'virou_programacao';
    expect((await prisma.forecastCommercialDemand.findUniqueOrThrow({ where: { id } })).status).toBe(vencedor);
    // So 1 AuditLog de fechamento: o 409 nao audita.
    expect((await logs(id)).filter((l) => l.action === 'close')).toHaveLength(1);
  });

  testDbSkip('cancelar exige a nota (400 sem gravar); com nota fecha como cancelada', async () => {
    const criado = await post(corpo({ quantidadeKg: 20, necessidade: '2027-05-01', motivo: `${MOTIVO} CANCELAR` }));
    const id = criado.body.data.id as number;
    expect((await patch(id, { status: 'cancelada' })).status).toBe(400);
    expect((await prisma.forecastCommercialDemand.findUniqueOrThrow({ where: { id } })).status).toBe('aberta');
    const ok = await patch(id, { status: 'cancelada', nota: 'CLIENTE DESISTIU SINTETICO' });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ status: 'cancelada', notaFechamento: 'CLIENTE DESISTIU SINTETICO' });
  });

  testDbSkip('erros: produto inexistente 404, produto inativo 400, data passada 400, demanda inexistente 404 - sem gravar', async () => {
    const antes = await prisma.forecastCommercialDemand.count({ where: { product: { name: { contains: U } } } });
    expect((await post(corpo({ productId: 2147483000 }))).status).toBe(404);
    const inativo = await post(corpo({ productId: productInativo }));
    expect(inativo.status).toBe(400);
    expect(inativo.body.message).toContain('Produto inativo');
    expect((await post(corpo({ necessidade: '2020-01-01' }))).status).toBe(400);
    expect((await patch(2147483000, { motivo: 'NOVO MOTIVO' })).status).toBe(404);
    expect(await prisma.forecastCommercialDemand.count({ where: { product: { name: { contains: U } } } })).toBe(antes);
  });

  testDbSkip('Solicitacao inexistente -> 400 sem gravar (create e patch); troca para a existente e limpar com null funcionam', async () => {
    const inexistente = 2147483000;
    // Demanda ABERTA propria (a do caso E ja foi fechada acima e fechada nao e editavel).
    const idAberta = (await post(corpo({ motivo: `${MOTIVO} SOLICITACAO`, cliente: undefined, solicitacaoId }))).body.data.id as number;
    const antes = await prisma.forecastCommercialDemand.count({ where: { product: { name: { contains: U } } } });
    const criar = await post(corpo({ solicitacaoId: inexistente }));
    expect(criar.status).toBe(400);
    expect(criar.body.message).toBe(
      `Solicitação nº ${inexistente} não encontrada no módulo Solicitações. Confira o número ou deixe o campo vazio.`,
    );
    expect(await prisma.forecastCommercialDemand.count({ where: { product: { name: { contains: U } } } })).toBe(antes);

    const trocar = await patch(idAberta, { solicitacaoId: inexistente });
    expect(trocar.status).toBe(400);
    expect((await prisma.forecastCommercialDemand.findUniqueOrThrow({ where: { id: idAberta } })).commercialRequestId).toBe(
      solicitacaoId,
    );

    const limpar = await patch(idAberta, { solicitacaoId: null });
    expect(limpar.status).toBe(200);
    expect((await prisma.forecastCommercialDemand.findUniqueOrThrow({ where: { id: idAberta } })).commercialRequestId).toBeNull();
    expect((await patch(idAberta, { solicitacaoId })).status).toBe(200);
  });

  testDbSkip('FK Restrict: produto com demanda nao pode ser apagado; sem demanda apaga normalmente', async () => {
    await expect(prisma.forecastProduct.delete({ where: { id: productB } })).rejects.toThrow(
      /violates RESTRICT setting of foreign key constraint.*ForecastCommercialDemand_productId_fkey/s,
    );
    expect(await prisma.forecastProduct.count({ where: { id: productB } })).toBe(1);
    await prisma.forecastCommercialDemand.deleteMany({ where: { productId: productB } });
    await prisma.forecastProduct.delete({ where: { id: productB } });
    expect(await prisma.forecastProduct.count({ where: { id: productB } })).toBe(0);
  });
});
