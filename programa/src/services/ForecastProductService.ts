import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import {
  FORECAST_MAX_CODES_PER_PRODUCT,
  FORECAST_MAX_DETAIL_WARNINGS,
  FORECAST_PRODUCT_ORIGIN_DBCORP,
  FORECAST_PRODUCT_ORIGIN_PLANILHA,
} from '../constants/forecast';
import type { Produto } from '../utils/forecastTypes';
import {
  normalizeProductCode,
  normalizeProductName,
  normalizeSourceName,
} from '../utils/forecastWorkbook';
import { mesesHistorico } from '../utils/forecastMonths';
import { colunasDePallet, palletsDesejados, palletsDoCadastro } from '../utils/forecastPallets';
import type { CadastroDeCodigos, VendasRecentes } from '../utils/forecastPendentes';
import {
  escolherEmbalagem,
  type EmbalagemCadastrada,
} from '../utils/forecastRelatorioCompras';
import { HttpError } from '../utils/http';
import { todayKeyInSaoPaulo } from '../utils/supplierDocumentDates';
import type {
  ForecastEmbalagensPatchInput,
  ForecastProductCodeAddInput,
  ForecastProductCreateInput,
} from '../validators/forecast';
import { AuditLogService } from './AuditLogService';
import {
  CADASTRO_OCUPADO_MESSAGE,
  CADASTRO_TX_OPTIONS,
  isCadastroOcupado,
  lockForecastProduct,
} from './ForecastProductCadastroService';

type Db = Prisma.TransactionClient;

const ENTITY_TYPE = 'forecast_product';

// Produto + codigos com as colunas de embalagem (leitura do GET e releitura do PATCH).
const EMBALAGENS_SELECT = {
  id: true,
  name: true,
  isActive: true,
  packaging: true,
  noFractioning: true,
  codes: {
    orderBy: { position: 'asc' },
    select: {
      id: true,
      position: true,
      code: true,
      packagingQtyKg: true,
      packagingPalletKg: true,
      packagingPalletExtraKg: true,
      packagingLabel: true,
      packagingIsPrimary: true,
      packagingSource: true,
      packagingUpdatedAt: true,
    },
  },
} satisfies Prisma.ForecastProductSelect;

type ProdutoComEmbalagens = Prisma.ForecastProductGetPayload<{ select: typeof EMBALAGENS_SELECT }>;

export interface ForecastEmbalagensData {
  produto: { id: number; nome: string; ativo: boolean; embalagemPlanilha: string | null; naoFraciona: boolean };
  codigos: Array<{
    id: number;
    posicao: number;
    codigo: string;
    quantidadeKg: number | null;
    /** kg de UM pallet desta embalagem (opcao de compra; nao precisa ser multiplo da quantidade); nulo = sem pallet. */
    palletKg: number | null;
    /** TODOS os tamanhos de pallet do codigo, o 1o primeiro (`palletKg` = o 1o); vazio = sem pallet. */
    palletsKg: number[];
    rotulo: string | null;
    principal: boolean;
    origem: 'manual' | 'dbcorp' | null;
    atualizadoEm: string | null;
  }>;
  usadaCodigoId: number | null;
}

const qtyToNumber = (value: Prisma.Decimal | null): number | null => (value === null ? null : Number(value));

// Tamanhos de pallet do codigo: o 1o (packagingPalletKg) e os demais (packagingPalletExtraKg; `?? []` aceita linha sem a coluna).
const palletsDoCodigo = (c: { packagingPalletKg: Prisma.Decimal | null; packagingPalletExtraKg?: Prisma.Decimal[] | null }) =>
  palletsDoCadastro(qtyToNumber(c.packagingPalletKg), (c.packagingPalletExtraKg ?? []).map(Number));

function toEmbalagensData(product: ProdutoComEmbalagens): ForecastEmbalagensData {
  const codigos: ForecastEmbalagensData['codigos'] = product.codes.map((c) => ({
    id: c.id,
    posicao: c.position,
    codigo: c.code,
    quantidadeKg: qtyToNumber(c.packagingQtyKg),
    palletKg: qtyToNumber(c.packagingPalletKg),
    palletsKg: palletsDoCodigo(c),
    rotulo: c.packagingLabel,
    principal: c.packagingIsPrimary,
    origem: c.packagingSource === 'manual' ? 'manual' : c.packagingSource === 'dbcorp' ? 'dbcorp' : null,
    atualizadoEm: c.packagingUpdatedAt ? todayKeyInSaoPaulo(c.packagingUpdatedAt) : null,
  }));
  // Mesma regra do relatorio de compras (principal, senao menor posicao), sem duplicar a regra.
  const escolha = escolherEmbalagem(
    codigos.map((c) => c.codigo),
    codigos.flatMap((c) =>
      c.quantidadeKg !== null
        ? [{ codigo: c.codigo, quantidade: c.quantidadeKg, rotulo: c.rotulo, principal: c.principal }]
        : [],
    ),
  );
  const usada = escolha.usada ? (codigos.find((c) => c.codigo === escolha.usada?.codigo) ?? null) : null;
  return {
    produto: {
      id: product.id,
      nome: product.name,
      ativo: product.isActive,
      embalagemPlanilha: product.packaging,
      naoFraciona: product.noFractioning,
    },
    codigos,
    usadaCodigoId: usada?.id ?? null,
  };
}

export interface ProductDraft {
  name: string;
  normalizedName: string;
  sheetOrder: number | null; // coluna A
  sourceKey: string | null; // fonte (AU) normalizada; null quando vazia
  notes: string | null; // AT
  fixedPriceFlag: boolean; // AV = "X"
  packaging: string | null; // AW
  noFractioning: boolean; // AX = "X"
  sampleQty: string | null; // AY
  sampleRequestNote: string | null; // AZ
  codes: Array<{ position: number; code: string }>; // EMB.1..EMB.7 (position 1..7)
}

interface ProductFields {
  name: string;
  sheetOrder: number | null;
  sourceKey: string | null;
  notes: string | null;
  fixedPriceFlag: boolean;
  packaging: string | null;
  noFractioning: boolean;
  sampleQty: string | null;
  sampleRequestNote: string | null;
  familyId: number | null;
  isActive: boolean;
  origin: string; // 'planilha' | 'dbcorp'
}

interface CodeFields {
  position: number;
  code: string;
  catalogItemId: number | null;
}

export type ProductChange = 'novo' | 'alterado' | 'igual';

export interface ProductPlanItem {
  draft: ProductDraft;
  existingId: number | null;
  desired: ProductFields;
  desiredCodes: CodeFields[];
  before: (ProductFields & { codes: CodeFields[] }) | null;
  fieldsChanged: boolean;
  codesChanged: boolean;
  change: ProductChange;
}

export interface ProductPlan {
  items: ProductPlanItem[];
  inativados: Array<{ id: number; name: string; before: ProductFields & { codes: CodeFields[] } }>;
  codigosMovidos: string[]; // codigos que estavam em outro produto
  avisos: string[];
  resumo: {
    produtos: { total: number; novos: number; alterados: number; inativados: number };
    codigos: { total: number; vinculadosCatalogo: number; movidos: number };
  };
}

const flagX = (value: string) => value.trim().toUpperCase() === 'X';
const textOrNull = (value: string) => (value.trim() === '' ? null : value.trim());

// Produto do motor (coluna da planilha) -> rascunho de cadastro.
export function toProductDrafts(produtos: Produto[]): ProductDraft[] {
  return produtos.map((p) => ({
    name: p.item.replace(/\s+/g, ' ').trim(),
    normalizedName: normalizeProductName(p.item),
    sheetOrder: p.n,
    sourceKey: p.fonte.trim() ? normalizeSourceName(p.fonte) : null,
    notes: textOrNull(p.obs),
    fixedPriceFlag: flagX(p.precoFechado),
    packaging: textOrNull(p.embalagem),
    noFractioning: flagX(p.naoFraciona),
    sampleQty: textOrNull(p.qtdAmostra),
    sampleRequestNote: textOrNull(p.solicitarAmostra),
    codes: p.codigos
      .map((code, index) => ({ position: index + 1, code: normalizeProductCode(code) }))
      .filter((entry) => entry.code !== ''),
  }));
}

function sameFields(a: ProductFields, b: ProductFields): boolean {
  return (
    a.name === b.name &&
    a.sheetOrder === b.sheetOrder &&
    a.sourceKey === b.sourceKey &&
    a.notes === b.notes &&
    a.fixedPriceFlag === b.fixedPriceFlag &&
    a.packaging === b.packaging &&
    a.noFractioning === b.noFractioning &&
    a.sampleQty === b.sampleQty &&
    a.sampleRequestNote === b.sampleRequestNote &&
    a.familyId === b.familyId &&
    a.isActive === b.isActive &&
    a.origin === b.origin
  );
}

const codesKey = (codes: CodeFields[]) =>
  codes
    .map((c) => `${c.position}:${c.code}:${c.catalogItemId ?? ''}`)
    .sort()
    .join('|');

export class ForecastProductService {
  // Compara o cadastro da planilha com o banco (sem escrita). `knownSourceKeys` = fontes que existem
  // (as da LEADTIME da planilha + as ja cadastradas); fonte desconhecida deixa o produto sem fonte.
  static async plan(
    db: Db,
    drafts: ProductDraft[],
    knownSourceKeys: Set<string>,
  ): Promise<ProductPlan> {
    const [existing, catalogRows] = await Promise.all([
      db.forecastProduct.findMany({
        include: {
          codes: true,
          source: { select: { normalizedName: true } },
        },
      }),
      db.catalogItem.findMany({
        where: { isActive: true, dbcorpCode: { not: null } },
        select: { id: true, dbcorpCode: true, familyId: true },
      }),
    ]);

    // codigo (maiusculas) -> itens de catalogo ativos com aquele dbcorpCode (so vale se for exatamente 1).
    const catalogByCode = new Map<string, Array<{ id: number; familyId: number | null }>>();
    for (const row of catalogRows) {
      if (!row.dbcorpCode) continue;
      const key = normalizeProductCode(row.dbcorpCode);
      if (!key) continue;
      catalogByCode.set(key, [...(catalogByCode.get(key) ?? []), { id: row.id, familyId: row.familyId }]);
    }

    const existingByName = new Map(existing.map((p) => [p.normalizedName, p]));
    const ownerByCode = new Map<string, { id: number; name: string; normalizedName: string }>();
    for (const product of existing) {
      for (const code of product.codes) {
        ownerByCode.set(code.code, {
          id: product.id,
          name: product.name,
          normalizedName: product.normalizedName,
        });
      }
    }

    const draftNames = new Set(drafts.map((d) => d.normalizedName));
    const codigosMovidos: string[] = [];
    const avisos: string[] = [];
    let vinculadosCatalogo = 0;
    let totalCodigos = 0;

    const items: ProductPlanItem[] = drafts.map((draft) => {
      const found = existingByName.get(draft.normalizedName) ?? null;

      const desiredCodes: CodeFields[] = draft.codes.map(({ position, code }) => {
        const matches = catalogByCode.get(code) ?? [];
        return { position, code, catalogItemId: matches.length === 1 ? matches[0].id : null };
      });
      totalCodigos += desiredCodes.length;
      vinculadosCatalogo += desiredCodes.filter((c) => c.catalogItemId !== null).length;

      for (const { code } of desiredCodes) {
        const owner = ownerByCode.get(code);
        if (owner && owner.normalizedName !== draft.normalizedName) {
          codigosMovidos.push(code);
          avisos.push(`Codigo ${code} movido de "${owner.name}" para "${draft.name}".`);
        }
      }

      // Familia do produto = familia comum a todos os itens de catalogo vinculados (senao nenhuma).
      const linked = desiredCodes
        .filter((c) => c.catalogItemId !== null)
        .map((c) => catalogByCode.get(c.code)![0]);
      const families = new Set(linked.map((l) => l.familyId));
      const familyId =
        linked.length > 0 && families.size === 1 && linked[0].familyId !== null
          ? linked[0].familyId
          : null;

      const desired: ProductFields = {
        name: draft.name,
        sheetOrder: draft.sheetOrder,
        sourceKey:
          draft.sourceKey !== null && knownSourceKeys.has(draft.sourceKey) ? draft.sourceKey : null,
        notes: draft.notes,
        fixedPriceFlag: draft.fixedPriceFlag,
        packaging: draft.packaging,
        noFractioning: draft.noFractioning,
        sampleQty: draft.sampleQty,
        sampleRequestNote: draft.sampleRequestNote,
        familyId,
        isActive: true,
        origin: FORECAST_PRODUCT_ORIGIN_PLANILHA,
      };

      if (!found) {
        return {
          draft,
          existingId: null,
          desired,
          desiredCodes,
          before: null,
          fieldsChanged: true,
          codesChanged: true,
          change: 'novo',
        };
      }

      const before = ForecastProductService.snapshotOf(found);
      const { codes: beforeCodes, ...beforeFields } = before;
      const fieldsChanged = !sameFields(beforeFields, desired);
      const codesChanged = codesKey(beforeCodes) !== codesKey(desiredCodes);
      return {
        draft,
        existingId: found.id,
        desired,
        desiredCodes,
        before,
        fieldsChanged,
        codesChanged,
        change: fieldsChanged || codesChanged ? 'alterado' : 'igual',
      };
    });

    // Produto cadastrado pela tela (origin 'dbcorp') nunca e inativado pelo import: o Comex o completou e ele
    // continua ativo mesmo fora da planilha. Se a planilha o trouxer (mesmo nome), ele e ADOTADO ('planilha').
    const ausentes = existing.filter((p) => p.isActive && !draftNames.has(p.normalizedName));
    const daTelaAusentes = ausentes.filter((p) => p.origin === FORECAST_PRODUCT_ORIGIN_DBCORP);
    const inativados = ausentes
      .filter((p) => p.origin !== FORECAST_PRODUCT_ORIGIN_DBCORP)
      .map((p) => ({ id: p.id, name: p.name, before: ForecastProductService.snapshotOf(p) }));
    const adotados = items.filter((i) => i.before?.origin === FORECAST_PRODUCT_ORIGIN_DBCORP).length;
    const avisosCadastro: string[] = [];
    if (daTelaAusentes.length > 0) {
      avisosCadastro.push(
        `${daTelaAusentes.length} produtos cadastrados pela tela a partir do DBCorp não estão na planilha e continuam ativos.`,
      );
    }
    if (adotados > 0) {
      avisosCadastro.push(
        `${adotados} produtos cadastrados pela tela passam a vir da planilha: fonte, família e códigos escolhidos na tela serão substituídos pelos da planilha.`,
      );
    }
    const removidos = await ForecastProductService.codigosDaTelaRemovidos(db, items);
    if (removidos > 0) {
      avisosCadastro.push(
        removidos === 1
          ? '1 código acrescentado pela tela não está na planilha e será removido. Inclua-o na planilha.'
          : `${removidos} códigos acrescentados pela tela não estão na planilha e serão removidos. Inclua-os na planilha.`,
      );
    }

    return {
      items,
      inativados,
      codigosMovidos,
      avisos: [...capWarnings(avisos), ...avisosCadastro],
      resumo: {
        produtos: {
          total: items.length,
          novos: items.filter((i) => i.change === 'novo').length,
          alterados: items.filter((i) => i.change === 'alterado').length,
          inativados: inativados.length,
        },
        codigos: {
          total: totalCodigos,
          vinculadosCatalogo,
          movidos: codigosMovidos.length,
        },
      },
    };
  }

  // Codigos acrescentados pela tela (AuditLog 'code_add') a produto de origem 'planilha' que a planilha vai
  // reescrever SEM eles: o import apaga o codigo (e a embalagem gravada nele). Um codigo que a planilha poe em
  // OUTRO produto e movido (aviso proprio), nao removido. O AuditLog distingue o codigo da tela do que o Comex
  // tirou da planilha; sem delegate de auditoria (mock) conta 0.
  private static async codigosDaTelaRemovidos(
    db: Db,
    items: ProductPlanItem[],
  ): Promise<number> {
    const afetados = items.filter(
      (i) => i.existingId !== null && i.before?.origin === FORECAST_PRODUCT_ORIGIN_PLANILHA && i.codesChanged,
    );
    if (afetados.length === 0) return 0;
    const rows = await AuditLogService.findMany(
      {
        where: {
          entityType: ENTITY_TYPE,
          action: 'code_add',
          entityId: { in: afetados.map((i) => String(i.existingId)) },
        },
        take: 5000,
      },
      db,
    );
    const codeIds = new Set<number>();
    for (const row of rows as Array<{ metadata?: unknown }>) {
      const codeId = (row.metadata as { codeId?: unknown } | null)?.codeId;
      if (typeof codeId === 'number') codeIds.add(codeId);
    }
    if (codeIds.size === 0) return 0;
    const noDraft = new Set(items.flatMap((i) => i.desiredCodes.map((c) => c.code)));
    const existentes = await db.forecastProductCode.findMany({
      where: { id: { in: [...codeIds] }, productId: { in: afetados.map((i) => i.existingId as number) } },
      select: { code: true },
    });
    return existentes.filter((c) => !noDraft.has(c.code)).length;
  }

  private static snapshotOf(product: {
    name: string;
    sheetOrder: number | null;
    notes: string | null;
    fixedPriceFlag: boolean;
    packaging: string | null;
    noFractioning: boolean;
    sampleQty: string | null;
    sampleRequestNote: string | null;
    familyId: number | null;
    isActive: boolean;
    origin?: string | null;
    source?: { normalizedName: string } | null;
    codes: Array<{ position: number; code: string; catalogItemId: number | null }>;
  }): ProductFields & { codes: CodeFields[] } {
    return {
      name: product.name,
      sheetOrder: product.sheetOrder,
      sourceKey: product.source?.normalizedName ?? null,
      notes: product.notes,
      fixedPriceFlag: product.fixedPriceFlag,
      packaging: product.packaging,
      noFractioning: product.noFractioning,
      sampleQty: product.sampleQty,
      sampleRequestNote: product.sampleRequestNote,
      familyId: product.familyId,
      isActive: product.isActive,
      origin:
        product.origin === FORECAST_PRODUCT_ORIGIN_DBCORP
          ? FORECAST_PRODUCT_ORIGIN_DBCORP
          : FORECAST_PRODUCT_ORIGIN_PLANILHA,
      codes: product.codes
        .map((c) => ({ position: c.position, code: c.code, catalogItemId: c.catalogItemId }))
        .sort((a, b) => a.position - b.position),
    };
  }

  // Grava o plano (dentro da transacao do import): produtos, codigos (substituidos pelo conjunto da
  // planilha; um codigo que estava em outro produto e movido) e inativacao dos ausentes.
  // Devolve normalizedName -> id de TODOS os produtos da planilha.
  static async apply(
    tx: Db,
    plan: ProductPlan,
    sourceIdByKey: Map<string, number>,
    userId: number | null,
  ): Promise<Map<string, number>> {
    const productIds = new Map<string, number>();
    const codeOwners: Array<{ productId: number; codes: CodeFields[] }> = [];

    for (const item of plan.items) {
      const { sourceKey, ...scalar } = item.desired;
      const data = {
        ...scalar,
        normalizedName: item.draft.normalizedName,
        sourceId: sourceKey !== null ? (sourceIdByKey.get(sourceKey) ?? null) : null,
      };

      let productId: number;
      if (item.existingId === null) {
        const created = await tx.forecastProduct.create({ data });
        productId = created.id;
        await AuditLogService.log(
          {
            entityType: ENTITY_TYPE,
            entityId: productId,
            action: 'create',
            performedById: userId,
            afterData: { ...item.desired, codes: item.desiredCodes },
            metadata: { source: 'workbook_import' },
          },
          tx,
        );
      } else {
        productId = item.existingId;
        if (item.fieldsChanged) {
          await tx.forecastProduct.update({ where: { id: productId }, data });
        }
        if (item.fieldsChanged || item.codesChanged) {
          await AuditLogService.log(
            {
              entityType: ENTITY_TYPE,
              entityId: productId,
              action: 'update',
              performedById: userId,
              beforeData: item.before,
              afterData: { ...item.desired, codes: item.desiredCodes },
              metadata: { source: 'workbook_import' },
            },
            tx,
          );
        }
      }
      productIds.set(item.draft.normalizedName, productId);
      if (item.codesChanged) {
        codeOwners.push({ productId, codes: item.desiredCodes });
      }
    }

    // Inativa ANTES de apagar/recriar codigos: a linha do produto e travada antes das dos codigos, na mesma ordem de
    // patchEmbalagens/substituir (lockForecastProduct), o que evita o deadlock 40P01 no cruzamento com o import.
    for (const gone of plan.inativados) {
      await tx.forecastProduct.update({ where: { id: gone.id }, data: { isActive: false } });
      await AuditLogService.log(
        {
          entityType: ENTITY_TYPE,
          entityId: gone.id,
          action: 'deactivate',
          performedById: userId,
          beforeData: gone.before,
          afterData: { ...gone.before, isActive: false },
          metadata: { source: 'workbook_import', reason: 'ausente da planilha' },
        },
        tx,
      );
    }

    if (codeOwners.length > 0) {
      const allCodes = codeOwners.flatMap((o) => o.codes.map((c) => c.code));
      // A embalagem e do CODIGO: le antes do deleteMany para devolve-la na recriacao. Um codigo que saiu da
      // planilha continua sendo apagado, com a embalagem.
      const anteriores = new Map(
        (
          await tx.forecastProductCode.findMany({
            where: { code: { in: allCodes } },
            select: {
              code: true,
              productId: true,
              packagingQtyKg: true,
              packagingPalletKg: true,
              packagingPalletExtraKg: true,
              packagingLabel: true,
              packagingIsPrimary: true,
              packagingSource: true,
              packagingUpdatedAt: true,
            },
          })
        ).map((a) => [a.code, a] as const),
      );
      // Apaga os codigos dos produtos alterados e qualquer codigo que va para outro dono (movido).
      await tx.forecastProductCode.deleteMany({
        where: {
          OR: [
            { productId: { in: codeOwners.map((o) => o.productId) } },
            ...(allCodes.length > 0 ? [{ code: { in: allCodes } }] : []),
          ],
        },
      });
      const rows = codeOwners.flatMap((o) =>
        o.codes.map((c) => {
          const anterior = anteriores.get(c.code);
          return {
            productId: o.productId,
            position: c.position,
            code: c.code,
            catalogItemId: c.catalogItemId,
            packagingQtyKg: anterior?.packagingQtyKg ?? null,
            packagingPalletKg: anterior?.packagingPalletKg ?? null,
            packagingPalletExtraKg: anterior?.packagingPalletExtraKg ?? [],
            packagingLabel: anterior?.packagingLabel ?? null,
            // A principal e do PRODUTO: codigo movido para outro produto perde a flag (mantem "no maximo uma").
            packagingIsPrimary: anterior?.productId === o.productId && anterior.packagingIsPrimary,
            packagingSource: anterior?.packagingSource ?? null,
            packagingUpdatedAt: anterior?.packagingUpdatedAt ?? null,
          };
        }),
      );
      if (rows.length > 0) {
        await tx.forecastProductCode.createMany({ data: rows });
      }
    }

    return productIds;
  }

  // Provedor de embalagens do relatorio de compras: le o cadastro ATUAL por codigo. O gateway DBCorp futuro
  // grava nas mesmas colunas e esta funcao nao muda (nao olha a origem).
  static async embalagensDosCodigos(
    codigos: string[],
    db: Db | typeof prisma = prisma,
  ): Promise<EmbalagemCadastrada[]> {
    const unicos = [...new Set(codigos.map((c) => c.toUpperCase()).filter((c) => c !== ''))];
    if (unicos.length === 0) return [];
    const rows = await db.forecastProductCode.findMany({
      where: { code: { in: unicos }, packagingQtyKg: { not: null } },
      select: {
        code: true,
        packagingQtyKg: true,
        packagingPalletKg: true,
        packagingPalletExtraKg: true,
        packagingLabel: true,
        packagingIsPrimary: true,
      },
    });
    return rows.map((r) => ({
      codigo: r.code,
      quantidade: Number(r.packagingQtyKg),
      rotulo: r.packagingLabel,
      principal: r.packagingIsPrimary,
      palletKg: qtyToNumber(r.packagingPalletKg),
      palletsKg: palletsDoCodigo(r),
    }));
  }

  static async getEmbalagens(productId: number): Promise<ForecastEmbalagensData> {
    const product = await prisma.forecastProduct.findUnique({
      where: { id: productId },
      select: EMBALAGENS_SELECT,
    });
    if (!product) throw new HttpError(404, 'Produto nao encontrado.');
    return toEmbalagensData(product);
  }

  // Edicao manual da embalagem por codigo. Tudo na mesma transacao: valida, grava (primeiro tira a principal
  // antiga, porque o indice parcial nao aceita duas "true" nem por um instante) e rele. Nunca toca
  // forecastSnapshot: o historico da quinzena nao muda, so o arredondamento exibido pelo cadastro atual.
  static async patchEmbalagens(
    productId: number,
    input: ForecastEmbalagensPatchInput,
    userId: number | null,
  ): Promise<ForecastEmbalagensData> {
    try {
      return await prisma.$transaction(async (tx) => {
        // Trava a linha do produto ANTES de ler os codigos: dois PATCH do mesmo produto se serializam.
        if (!(await lockForecastProduct(tx, productId))) throw new HttpError(404, 'Produto nao encontrado.');
        const product = await tx.forecastProduct.findUnique({
          where: { id: productId },
          select: EMBALAGENS_SELECT,
        });
        if (!product) throw new HttpError(404, 'Produto nao encontrado.');

        const doProduto = new Set(product.codes.map((c) => c.id));
        const foraDoProduto =
          (input.embalagens ?? []).some((e) => !doProduto.has(e.codigoId)) ||
          (typeof input.principalCodigoId === 'number' && !doProduto.has(input.principalCodigoId));
        if (foraDoProduto) {
          throw new HttpError(400, 'O codigo informado nao pertence a este produto.');
        }

        const edicoes = new Map((input.embalagens ?? []).map((e) => [e.codigoId, e] as const));
        const principalAntes = product.codes.find((c) => c.packagingIsPrimary)?.id ?? null;

        // Estado desejado por codigo. Quantidade nula = sem embalagem: sem rotulo e sem principal.
        const desejado = product.codes.map((c) => {
          const edicao = edicoes.get(c.id);
          const quantidade = edicao ? edicao.quantidadeKg : qtyToNumber(c.packagingQtyKg);
          const rotulo = edicao && edicao.rotulo !== undefined ? edicao.rotulo : c.packagingLabel;
          // Pallet (PR 6e, ajustado na rodada 5 do Comex): opcao de compra informada pelo cadastro, nao regra; so precisa de
          // quantidade na embalagem e NAO precisa ser multiplo dela. Quantidade apagada apaga os pallets junto. Varios
          // tamanhos por codigo: `palletKg` (legado) troca so o 1o; `palletsKg` substitui a lista (utils/forecastPallets).
          let pallets = palletsDesejados(palletsDoCodigo(c), edicao);
          if (quantidade === null) {
            if (edicao?.palletKg != null || (edicao?.palletsKg?.length ?? 0) > 0) {
              throw new HttpError(400, 'O pallet precisa da quantidade da embalagem.');
            }
            pallets = [];
          }
          return { code: c, quantidade, pallets, rotulo: quantidade === null ? null : rotulo };
        });
        const quantidadePorId = new Map(desejado.map((d) => [d.code.id, d.quantidade] as const));

        let principalDepois: number | null;
        if (input.principalCodigoId !== undefined) {
          principalDepois = input.principalCodigoId;
          if (principalDepois !== null && quantidadePorId.get(principalDepois) === null) {
            throw new HttpError(400, 'A embalagem principal precisa de quantidade.');
          }
        } else {
          principalDepois =
            principalAntes !== null && quantidadePorId.get(principalAntes) !== null ? principalAntes : null;
        }

        const alterados = desejado
          .map((d) => ({ ...d, principal: d.code.id === principalDepois }))
          .filter(
            (d) =>
              d.quantidade !== qtyToNumber(d.code.packagingQtyKg) ||
              d.pallets.join(';') !== palletsDoCodigo(d.code).join(';') ||
              d.rotulo !== d.code.packagingLabel ||
              d.principal !== d.code.packagingIsPrimary,
          );
        if (alterados.length === 0) return toEmbalagensData(product);

        if (principalAntes !== null && principalAntes !== principalDepois) {
          await tx.forecastProductCode.updateMany({
            where: { productId, packagingIsPrimary: true },
            data: { packagingIsPrimary: false },
          });
        }
        const agora = new Date();
        for (const d of alterados) {
          await tx.forecastProductCode.update({
            where: { id: d.code.id },
            data: {
              packagingQtyKg: d.quantidade,
              ...colunasDePallet(d.pallets),
              packagingLabel: d.rotulo,
              packagingIsPrimary: d.principal,
              packagingSource: 'manual',
              packagingUpdatedAt: agora,
            },
          });
        }

        const comEmbalagem = desejado.filter((d) => d.quantidade !== null).length;
        const comPallet = desejado.filter((d) => d.pallets.length > 0).length;
        const comVariosPallets = desejado.filter((d) => d.pallets.length > 1).length;
        await AuditLogService.log(
          {
            entityType: ENTITY_TYPE,
            entityId: productId,
            action: 'packaging_update',
            performedById: userId,
            // So ids e contagens: nunca quantidade, rotulo, nome de produto ou codigo DBCorp.
            metadata: {
              source: 'manual_patch',
              codigoIdsAlterados: alterados.map((d) => d.code.id),
              comEmbalagem,
              semEmbalagem: desejado.length - comEmbalagem,
              comPallet,
              comVariosPallets,
              principalAntes,
              principalDepois,
            },
          },
          tx,
        );

        const atualizado = await tx.forecastProduct.findUnique({
          where: { id: productId },
          select: EMBALAGENS_SELECT,
        });
        if (!atualizado) throw new HttpError(404, 'Produto nao encontrado.');
        return toEmbalagensData(atualizado);
      }, CADASTRO_TX_OPTIONS);
    } catch (error) {
      if (isCadastroOcupado(error)) throw new HttpError(503, CADASTRO_OCUPADO_MESSAGE);
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new HttpError(
          409,
          'A embalagem principal foi alterada por outra pessoa. Recarregue e tente de novo.',
        );
      }
      throw error;
    }
  }

  // Codigos do cadastro, para a lista de pendentes: ativos (nunca pendentes) e de produto inativo (pendente
  // com o aviso de que o produto existe). 1 query.
  static async cadastroDeCodigos(db: Db | typeof prisma = prisma): Promise<CadastroDeCodigos> {
    const rows = await db.forecastProductCode.findMany({
      select: { code: true, product: { select: { id: true, name: true, isActive: true } } },
    });
    const ativos = new Set<string>();
    const inativos = new Map<string, { productId: number; nome: string }>();
    for (const row of rows) {
      if (row.product.isActive) ativos.add(row.code);
      else inativos.set(row.code, { productId: row.product.id, nome: row.product.name });
    }
    return { ativos, inativos };
  }

  // Soma por codigo das vendas gravadas em `ForecastMonthlySale` nos meses pedidos (so leitura). `ausentes` = meses
  // sem nenhuma linha no historico.
  static async vendasAnteriores(
    db: Db | typeof prisma,
    yearMonths: string[],
  ): Promise<{ porCodigo: Map<string, number>; ausentes: string[] }> {
    const rows = await db.forecastMonthlySale.findMany({
      where: { yearMonth: { in: yearMonths } },
      select: { code: true, yearMonth: true, quantity: true },
    });
    const porCodigo = new Map<string, number>();
    const comLinhas = new Set<string>();
    for (const row of rows) {
      comLinhas.add(row.yearMonth);
      const codigo = normalizeProductCode(row.code);
      porCodigo.set(codigo, (porCodigo.get(codigo) ?? 0) + Number(row.quantity));
    }
    return { porCodigo, ausentes: yearMonths.filter((m) => !comLinhas.has(m)) };
  }

  // Vendas dos 3 meses da regra dos pendentes: base-3 e base-2 do historico gravado; base-1 vem das `Entradas`
  // (VENDAS do mes anterior). Mesma base da media trimestral do motor.
  static async vendasRecentes(db: Db | typeof prisma, baseDate: string): Promise<VendasRecentes> {
    const m = mesesHistorico(baseDate);
    const doHistorico = [m.historico[3], m.historico[4]];
    const { porCodigo, ausentes } = await ForecastProductService.vendasAnteriores(db, doHistorico);
    return { meses: [...doHistorico, m.anterior], anteriores: porCodigo, ausentes };
  }

  static async list() {
    return prisma.forecastProduct.findMany({
      orderBy: [{ sheetOrder: 'asc' }, { id: 'asc' }],
      include: {
        codes: {
          orderBy: { position: 'asc' },
          select: {
            id: true,
            position: true,
            code: true,
            catalogItemId: true,
            catalogItem: { select: { id: true, commercialName: true, marketName: true } },
          },
        },
        source: { select: { id: true, name: true, leadTimeDays: true } },
        family: { select: { id: true, name: true } },
      },
    });
  }
}

function capWarnings(avisos: string[]): string[] {
  if (avisos.length <= FORECAST_MAX_DETAIL_WARNINGS) return avisos;
  return [
    ...avisos.slice(0, FORECAST_MAX_DETAIL_WARNINGS),
    `... e mais ${avisos.length - FORECAST_MAX_DETAIL_WARNINGS} avisos de codigo movido.`,
  ];
}
