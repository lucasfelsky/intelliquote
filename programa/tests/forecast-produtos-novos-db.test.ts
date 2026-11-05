import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { AuditLogService } from '../src/services/AuditLogService';
import {
  criarProdutosNovos,
  gerarModeloProdutosNovos,
  listarFontesParaPlanilha,
} from '../src/services/CatalogItemForecastLinkService';
import { preencherLeadTimeSeVazio } from '../src/services/ForecastSourceService';
import { HttpError } from '../src/utils/http';
import { lerPlanilhaProdutosNovos, type LinhaLida } from '../src/utils/forecastProdutosNovos';

const testDbSkip = process.env.RUN_DB_TESTS !== 'true' ? it.skip : it;
const runId = `fpn${Date.now()}`;
const U = runId.toUpperCase();

// Tudo SINTETICO (repo publico): nomes e codigos derivados do runId.
const FAMILIA = `FIC ${U} FAMILIA`;
const FAMILIA_INATIVA = `FIC ${U} FAMILIA INATIVA`;
const FONTE_SEM_LT = `FIC ${U} SEM LT`;
const FONTE_COM_LT = `FIC ${U} COM LT`;
const FONTE_INATIVA = `FIC ${U} FONTE INATIVA`;
const PRODUTO_EXISTENTE = `FIC ${U} EXISTENTE`;
const code = (sufixo: string) => `FIC-${U}-${sufixo}`;

const COLUNAS = [
  'produtoNovo',
  'codigos',
  'embalagens',
  'familia',
  'catalogItemIds',
  'nomesDeMercado',
  'fonteSugerida',
  'fonteId',
  'leadTimeDaFonte',
  'fonte',
  'leadTimeDias',
  'observacao',
  'criar',
];

type Campos = Partial<Record<(typeof COLUNAS)[number], string>>;

// CSV no formato real do contrato: BOM, `;`, CRLF e todas as celulas entre aspas.
function csv(linhas: Campos[]): string {
  const quote = (valor: string) => `"${valor.replace(/"/g, '""')}"`;
  const corpo = [COLUNAS.map(quote).join(';'), ...linhas.map((l) => COLUNAS.map((c) => quote(l[c] ?? '')).join(';'))];
  return `﻿${corpo.join('\r\n')}\r\n`;
}

function ler(texto: string): LinhaLida[] {
  const leitura = lerPlanilhaProdutosNovos(texto);
  if (!leitura.ok) throw new Error(`planilha invalida: ${leitura.erros.join(' / ')}`);
  return leitura.linhas;
}

describe('Produtos novos em lote (DB)', () => {
  let familiaId: number;
  let familiaInativaId: number;
  let fonteSemLtId: number;
  let fonteComLtId: number;
  let produtoExistenteId: number;
  const itens: Record<string, number> = {};

  const criarItem = async (chave: string, nomeComercial: string, extra: { familyId?: number | null; isActive?: boolean } = {}) => {
    const item = await prisma.catalogItem.create({
      data: {
        commercialName: nomeComercial,
        marketName: `ITEM ${U} ${chave}`,
        dbcorpCode: code(chave),
        familyId: extra.familyId === undefined ? familiaId : extra.familyId,
        ...(extra.isActive === undefined ? {} : { isActive: extra.isActive }),
      },
    });
    itens[chave] = item.id;
    return item;
  };

  const criarFonte = async (nome: string, leadTimeDays: number | null, isActive = true) =>
    (await prisma.forecastSource.create({ data: { name: nome, normalizedName: nome, leadTimeDays, isActive } })).id;

  const contagens = async () => ({
    produtos: await prisma.forecastProduct.count(),
    codigos: await prisma.forecastProductCode.count(),
    auditoria: await prisma.auditLog.count(),
    fontesComLeadTime: await prisma.forecastSource.count({ where: { leadTimeDays: { not: null } } }),
  });

  const planilhaPrincipal = () =>
    csv([
      // L2: grupo de 2 codigos; fonte SEM lead time + 45; familia vazia (herda a dos itens).
      {
        produtoNovo: `FIC ${U} GRP`,
        codigos: `${code('A1')} | ${code('A2')}`,
        catalogItemIds: `${itens.A1} | ${itens.A2}`,
        familia: '',
        fonte: FONTE_SEM_LT,
        leadTimeDias: '45',
        criar: 'sim',
        // colunas informativas nao decidem nada
        fonteSugerida: FONTE_COM_LT,
        leadTimeDaFonte: '999',
      },
      // L3: fonte COM lead time (30) e a planilha diz 45 -> conflito.
      { produtoNovo: `FIC ${U} BBB`, codigos: code('B1'), catalogItemIds: String(itens.B1), familia: FAMILIA, fonte: FONTE_COM_LT, leadTimeDias: '45', criar: 'sim' },
      // L4: nao aprovada.
      { produtoNovo: `FIC ${U} CCC`, codigos: code('C1'), catalogItemIds: String(itens.C1), fonte: FONTE_COM_LT, criar: '' },
      // L5: nome de produto que ja existe -> conflito.
      { produtoNovo: PRODUTO_EXISTENTE, codigos: code('D1'), catalogItemIds: String(itens.D1), fonte: FONTE_COM_LT, criar: 'sim' },
      // L6: o dbcorpCode do item mudou depois do modelo -> item_mudou.
      { produtoNovo: `FIC ${U} EEE`, codigos: code('E1'), catalogItemIds: String(itens.E1), fonte: FONTE_COM_LT, criar: 'sim' },
      // L7: fonte que nao existe -> erro.
      { produtoNovo: `FIC ${U} FFF`, codigos: code('F1'), catalogItemIds: String(itens.F1), fonte: `FIC ${U} NAO EXISTE`, criar: 'sim' },
    ]);

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== 'true') return;

    familiaId = (await prisma.itemFamily.create({ data: { name: FAMILIA } })).id;
    familiaInativaId = (await prisma.itemFamily.create({ data: { name: FAMILIA_INATIVA, isActive: false } })).id;
    fonteSemLtId = await criarFonte(FONTE_SEM_LT, null);
    fonteComLtId = await criarFonte(FONTE_COM_LT, 30);
    await criarFonte(FONTE_INATIVA, 30, false);

    // Itens ativos com codigo livre; A1/A2 compartilham o nome base (embalagens diferentes).
    await criarItem('A1', `FIC ${U} GRP - BLD 18KG`);
    await criarItem('A2', `FIC ${U} GRP - TBR 175KG`);
    await criarItem('B1', `FIC ${U} BBB - UN`);
    await criarItem('C1', `FIC ${U} CCC - UN`);
    await criarItem('D1', `FIC ${U} DDD - UN`);
    await criarItem('E1', `FIC ${U} EEE - UN`);
    await criarItem('F1', `FIC ${U} FFF - UN`);
    await criarItem('INATIVO', `FIC ${U} HHH - UN`, { isActive: false });

    produtoExistenteId = (
      await prisma.forecastProduct.create({
        data: {
          name: PRODUTO_EXISTENTE,
          normalizedName: PRODUTO_EXISTENTE,
          sheetOrder: null,
          sourceId: fonteComLtId,
          origin: 'dbcorp',
          codes: { create: [{ position: 1, code: code('X1') }] },
        },
      })
    ).id;
  });

  afterAll(async () => {
    if (process.env.RUN_DB_TESTS !== 'true') return;

    const produtos = await prisma.forecastProduct.findMany({ where: { name: { contains: U } }, select: { id: true } });
    const fontes = await prisma.forecastSource.findMany({ where: { name: { contains: U } }, select: { id: true } });
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { entityType: 'forecast_product', entityId: { in: produtos.map((p) => String(p.id)) } },
          { entityType: 'forecast_source', entityId: { in: fontes.map((f) => String(f.id)) } },
        ],
      },
    });
    await prisma.forecastProduct.deleteMany({ where: { name: { contains: U } } });
    await prisma.catalogItem.deleteMany({ where: { marketName: { contains: U } } });
    await prisma.forecastSource.deleteMany({ where: { name: { contains: U } } });
    await prisma.itemFamily.deleteMany({ where: { name: { contains: U } } });
    await prisma.$disconnect();
  });

  testDbSkip('a. fontes e modelo sao SOMENTE LEITURA e o modelo traz o grupo sintetico na ordem, com a familia', async () => {
    const antes = await contagens();
    const fontes = await listarFontesParaPlanilha();
    const modelo = await gerarModeloProdutosNovos();
    expect(await contagens()).toEqual(antes);

    expect(fontes.find((f) => f.nome === FONTE_SEM_LT)).toEqual({ id: fonteSemLtId, nome: FONTE_SEM_LT, leadTimeDays: null, ativa: true });
    expect(fontes.find((f) => f.nome === FONTE_INATIVA)).toMatchObject({ leadTimeDays: 30, ativa: false });

    const grupo = modelo.find((m) => m.produtoNovo === `FIC ${U} GRP`);
    expect(grupo).toMatchObject({
      codigos: [code('A1'), code('A2')],
      catalogItemIds: [itens.A1, itens.A2],
      embalagens: ['BLD 18KG', 'TBR 175KG'],
      familia: FAMILIA,
      observacao: '',
      criar: '',
    });
    // Item inativo nunca entra; o produto existente (nome parecido) nao e orfao.
    expect(modelo.some((m) => m.codigos.includes(code('INATIVO')))).toBe(false);
  });

  testDbSkip('b. dry-run: contagens iguais as do --gravar, nada gravado e a fonte sem lead time continua null', async () => {
    // L6: o codigo do item mudou depois que o modelo foi gerado.
    await prisma.catalogItem.update({ where: { id: itens.E1 }, data: { dbcorpCode: code('E1X') } });
    const antes = await contagens();

    const relatorio = await criarProdutosNovos(ler(planilhaPrincipal()), { gravar: false });

    expect(relatorio.contagem).toEqual({ aplicado: 1, ja_aplicado: 0, conflito: 2, item_mudou: 1, erro: 1, ignorado: 1 });
    expect(relatorio.resultados.map((r) => [r.linha, r.status, r.motivo])).toEqual([
      [2, 'aplicado', null],
      [3, 'conflito', 'lead_time_divergente'],
      [4, 'ignorado', 'nao_aprovado'],
      [5, 'conflito', 'produto_ja_existe'],
      [6, 'item_mudou', 'codigo_do_item_mudou'],
      [7, 'erro', 'fonte_inexistente'],
    ]);
    expect(await contagens()).toEqual(antes);
    expect((await prisma.forecastSource.findUniqueOrThrow({ where: { id: fonteSemLtId } })).leadTimeDays).toBeNull();
  });

  testDbSkip('c. --gravar: cria o produto L2 com vinculo por posicao, preenche o lead time da fonte e audita', async () => {
    const relatorio = await criarProdutosNovos(ler(planilhaPrincipal()), { gravar: true });
    expect(relatorio.contagem).toEqual({ aplicado: 1, ja_aplicado: 0, conflito: 2, item_mudou: 1, erro: 1, ignorado: 1 });

    const produto = await prisma.forecastProduct.findFirstOrThrow({
      where: { name: `FIC ${U} GRP` },
      include: { codes: { orderBy: { position: 'asc' } } },
    });
    expect(relatorio.resultados[0].produtoId).toBe(produto.id);
    expect(produto).toMatchObject({ origin: 'dbcorp', isActive: true, sourceId: fonteSemLtId, familyId: familiaId });
    expect(produto.codes.map((c) => [c.position, c.code, c.catalogItemId])).toEqual([
      [1, code('A1'), itens.A1],
      [2, code('A2'), itens.A2],
    ]);

    expect((await prisma.forecastSource.findUniqueOrThrow({ where: { id: fonteSemLtId } })).leadTimeDays).toBe(45);
    expect((await prisma.forecastSource.findUniqueOrThrow({ where: { id: fonteComLtId } })).leadTimeDays).toBe(30);

    const auditoriaProduto = await prisma.auditLog.findMany({
      where: { entityType: 'forecast_product', action: 'create', entityId: String(produto.id) },
    });
    expect(auditoriaProduto).toHaveLength(1);
    expect(auditoriaProduto[0].metadata).toMatchObject({
      source: 'lote_produtos_novos',
      sourceId: fonteSemLtId,
      familyId: familiaId,
      catalogItemIds: [itens.A1, itens.A2],
    });
    const auditoriaFonte = await prisma.auditLog.findMany({
      where: { entityType: 'forecast_source', action: 'update', entityId: String(fonteSemLtId) },
    });
    expect(auditoriaFonte).toHaveLength(1);
    expect(auditoriaFonte[0].metadata).toMatchObject({ source: 'lote_produtos_novos' });
    expect(auditoriaFonte[0].afterData).toMatchObject({ leadTimeDays: 45 });

    // Nada criado para as demais linhas; o produto que ja existia segue com 1 codigo.
    const nomes = (await prisma.forecastProduct.findMany({ where: { name: { contains: U } }, select: { name: true } })).map((p) => p.name);
    expect(nomes.sort()).toEqual([PRODUTO_EXISTENTE, `FIC ${U} GRP`].sort());
    expect(await prisma.forecastProductCode.count({ where: { productId: produtoExistenteId } })).toBe(1);
  });

  testDbSkip('d. 2a execucao --gravar: ja_aplicado e nenhuma linha nova em produto, codigo ou auditoria', async () => {
    const antes = await contagens();
    const relatorio = await criarProdutosNovos(ler(planilhaPrincipal()), { gravar: true });
    expect(relatorio.contagem).toEqual({ aplicado: 0, ja_aplicado: 1, conflito: 2, item_mudou: 1, erro: 1, ignorado: 1 });
    expect(relatorio.resultados[0]).toMatchObject({ linha: 2, status: 'ja_aplicado', motivo: null });
    expect(await contagens()).toEqual(antes);
  });

  testDbSkip('e. rollback por linha: a falha do cadastro na linha do meio desfaz so ela (lead time da fonte incluso)', async () => {
    const fontes = [
      await criarFonte(`FIC ${U} SEM LT E1`, null),
      await criarFonte(`FIC ${U} SEM LT E2`, null),
      await criarFonte(`FIC ${U} SEM LT E3`, null),
    ];
    for (const n of [1, 2, 3]) await criarItem(`R${n}`, `FIC ${U} RB${n} - UN`);
    const linhas = [1, 2, 3].map((n) => ({
      produtoNovo: `FIC ${U} RB${n}`,
      codigos: code(`R${n}`),
      catalogItemIds: String(itens[`R${n}`]),
      fonte: `FIC ${U} SEM LT E${n}`,
      leadTimeDias: '20',
      criar: 'sim',
    }));

    const original = AuditLogService.log.bind(AuditLogService);
    const espiao = vi.spyOn(AuditLogService, 'log').mockImplementation(async (input, client) => {
      if (input.entityType === 'forecast_product' && input.action === 'create') {
        const tx = client as typeof prisma;
        const criado = await tx.forecastProduct.findUnique({ where: { id: Number(input.entityId) }, select: { name: true } });
        if (criado?.name === `FIC ${U} RB2`) throw new HttpError(400, 'falha sintetica');
      }
      return original(input, client);
    });
    try {
      const relatorio = await criarProdutosNovos(ler(csv(linhas)), { gravar: true });
      expect(relatorio.resultados.map((r) => [r.linha, r.status, r.motivo])).toEqual([
        [2, 'aplicado', null],
        [3, 'erro', 'rejeitado_pelo_cadastro'],
        [4, 'aplicado', null],
      ]);
    } finally {
      espiao.mockRestore();
    }

    const leadTimes = await Promise.all(fontes.map(async (id) => (await prisma.forecastSource.findUniqueOrThrow({ where: { id } })).leadTimeDays));
    expect(leadTimes).toEqual([20, null, 20]);
    expect(await prisma.forecastProduct.findFirst({ where: { name: `FIC ${U} RB2` } })).toBeNull();
    expect(await prisma.forecastProductCode.findUnique({ where: { code: code('R2') } })).toBeNull();
    expect(await prisma.forecastProduct.count({ where: { name: { in: [`FIC ${U} RB1`, `FIC ${U} RB3`] } } })).toBe(2);
    // Sem auditoria orfa da linha desfeita.
    expect(await prisma.auditLog.count({ where: { entityType: 'forecast_source', entityId: String(fontes[1]) } })).toBe(0);
  });

  testDbSkip('f. preencherLeadTimeSeVazio: so grava se a fonte nao tem lead time', async () => {
    const vazia = await criarFonte(`FIC ${U} SEM LT F`, null);

    const comLeadTime = await prisma.$transaction((tx) => preencherLeadTimeSeVazio(tx, fonteComLtId, 60, null, 'teste'));
    expect(comLeadTime).toBe(false);
    expect((await prisma.forecastSource.findUniqueOrThrow({ where: { id: fonteComLtId } })).leadTimeDays).toBe(30);

    const semLeadTime = await prisma.$transaction((tx) => preencherLeadTimeSeVazio(tx, vazia, 60, null, 'teste'));
    expect(semLeadTime).toBe(true);
    expect((await prisma.forecastSource.findUniqueOrThrow({ where: { id: vazia } })).leadTimeDays).toBe(60);
  });

  testDbSkip('g. familia inativa e fonte inativa viram erro (nada gravado)', async () => {
    await criarItem('G1', `FIC ${U} GGG - UN`);
    await criarItem('G2', `FIC ${U} JJJ - UN`);
    const antes = await contagens();
    const relatorio = await criarProdutosNovos(
      ler(
        csv([
          { produtoNovo: `FIC ${U} GGG`, codigos: code('G1'), catalogItemIds: String(itens.G1), familia: FAMILIA_INATIVA, fonte: FONTE_COM_LT, criar: 'sim' },
          { produtoNovo: `FIC ${U} JJJ`, codigos: code('G2'), catalogItemIds: String(itens.G2), familia: FAMILIA, fonte: FONTE_INATIVA, criar: 'sim' },
        ]),
      ),
      { gravar: true },
    );
    expect(relatorio.resultados.map((r) => [r.status, r.motivo])).toEqual([
      ['erro', 'familia_inativa'],
      ['erro', 'fonte_inativa'],
    ]);
    expect(await contagens()).toEqual(antes);
    expect(familiaInativaId).toBeGreaterThan(0);
  });
});
