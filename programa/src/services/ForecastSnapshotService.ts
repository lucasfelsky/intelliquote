import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { FORECAST_MAX_DIVERGENCES, FORECAST_ORIGIN_DBCORP } from '../constants/forecast';
import { calcular, conferir, type Divergencia } from '../utils/forecastEngine';
import { codigosPendentes, type PendentesResultado } from '../utils/forecastPendentes';
import type { Entradas, Produto, Quinzena } from '../utils/forecastTypes';
import {
  montarRelatorioCompras,
  type EmbalagemCadastrada,
  type RelatorioCompras,
} from '../utils/forecastRelatorioCompras';
import {
  gerarXlsxRelatorioCompras,
  nomeArquivoRelatorioCompras,
} from '../utils/forecastRelatorioComprasXlsx';
import { dateKeyToDbDate, dbDateToKey, todayKeyInSaoPaulo } from '../utils/supplierDocumentDates';
import { HttpError } from '../utils/http';
import { ForecastProductService } from './ForecastProductService';
import { ForecastSobDemandaService } from './ForecastSobDemandaService';

export interface ForecastPendentesData extends PendentesResultado {
  // false = quinzena da planilha: nao ha relatorio DBCorp para comparar com o cadastro.
  aplicavel: boolean;
  snapshotId: number;
  label: string;
}

type Db = Prisma.TransactionClient;

// Produto congelado na quinzena: o do motor + o id do cadastro quando existia na importacao.
export type FrozenProduct = Produto & { productId?: number | null };

export type SnapshotOrigin = 'planilha' | 'dbcorp';

export interface SnapshotFileInfo {
  kind: string;
  fileName: string;
  sha256: string;
  rows: number;
  // Regra do FUP aplicada (ex.: 'F3'); ausente = D2 (quinzenas antigas).
  regra?: string;
  // So no arquivo 'fup' (PR 5A): prazo das chegadas estimadas usado no calculo, por fonte (so as fontes com linha
  // estimada). Ausente = 35 dias para todas.
  estimativa?: {
    padrao: { prontidaoDias: number; etdDias: number };
    porFonte: Array<{ sourceId: number; nome: string; prontidaoDias: number; etdDias: number }>;
  };
}

interface SnapshotMonths {
  consumo: string[];
  chegada: string[];
  programacao: string[];
}

export interface ForecastConferencia {
  celulas: number;
  batem: number;
  porColuna: Record<string, { celulas: number; batem: number }>;
  totalDivergencias: number;
  divergencias: Divergencia[];
}

// Conferencia motor x valores que o Excel gravou. Compara SEMPRE com a regra da planilha (AG = maior
// entre Q e P, quinzena 2) e a regra AL da planilha (sem somar a chegada do 5o mes): o Excel nao conhece
// a regra "1a quinzena" nem a regra AL do Comex, entao comparar com elas geraria divergencia que nao e
// erro do motor.
export function conferenciaDaQuinzena(q: Quinzena, hoje: string): ForecastConferencia {
  const linhas = calcular(q, { hoje, quinzena: 2, somarChegada5oMes: false });
  const resultado = conferir(q, linhas);
  return {
    celulas: resultado.celulas,
    batem: resultado.batem,
    porColuna: resultado.porColuna,
    totalDivergencias: resultado.divergencias.length,
    divergencias: resultado.divergencias.slice(0, FORECAST_MAX_DIVERGENCES),
  };
}

const LABEL_HALF = /^\d{2}-([12])$/;

export function halfDoRotulo(label: string): 1 | 2 {
  const match = LABEL_HALF.exec(label);
  if (!match) {
    throw new HttpError(400, 'Rotulo da quinzena invalido (use o formato NN-q, ex.: 10-2).');
  }
  return match[1] === '1' ? 1 : 2;
}

const asJson = (value: unknown) => value as Prisma.InputJsonValue;

export class ForecastSnapshotService {
  // 409 quando ja existe quinzena nao deletada com o mesmo rotulo (o Prisma nao expressa unique parcial).
  static async assertLabelFree(db: Db, label: string): Promise<void> {
    const existing = await db.forecastSnapshot.findFirst({
      where: { label, deletedAt: null },
      select: { id: true },
    });
    if (existing) {
      throw new HttpError(409, `Ja existe uma quinzena ${label}.`);
    }
  }

  // Congela a quinzena (origem planilha ou dbcorp). `quinzena.produtos` pode carregar `productId`.
  static async createFromParsed(
    tx: Db,
    quinzena: Quinzena,
    origin: SnapshotOrigin,
    files: SnapshotFileInfo[],
    userId: number | null,
  ) {
    const half = halfDoRotulo(quinzena.id);
    await ForecastSnapshotService.assertLabelFree(tx, quinzena.id);

    const months: SnapshotMonths = {
      consumo: quinzena.mesesConsumo,
      chegada: quinzena.mesesChegada,
      programacao: quinzena.mesesProgramacao,
    };
    return tx.forecastSnapshot.create({
      data: {
        label: quinzena.id,
        baseDate: dateKeyToDbDate(quinzena.dataBase),
        half,
        origin,
        months: asJson(months),
        products: asJson(quinzena.produtos),
        inputs: asJson(quinzena.entradas),
        ...(origin === 'planilha' ? { expected: asJson(quinzena.esperado) } : {}),
        files: asJson(files),
        createdById: userId,
      },
    });
  }

  // Lista sem os Json grandes (products/inputs/expected).
  static async list() {
    return prisma.forecastSnapshot.findMany({
      where: { deletedAt: null },
      orderBy: [{ baseDate: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        label: true,
        baseDate: true,
        half: true,
        origin: true,
        months: true,
        files: true,
        createdById: true,
        createdAt: true,
      },
    });
  }

  // Quinzena calculada pelo motor (+ conferencia com o Excel quando a origem e a planilha).
  static async getCalculated(id: number, hoje?: string) {
    const snapshot = await prisma.forecastSnapshot.findFirst({ where: { id, deletedAt: null } });
    if (!snapshot) {
      throw new HttpError(404, 'Quinzena nao encontrada.');
    }

    const months = snapshot.months as unknown as SnapshotMonths;
    const produtos = snapshot.products as unknown as FrozenProduct[];
    const files = snapshot.files as unknown as SnapshotFileInfo[];
    const quinzena: Quinzena = {
      id: snapshot.label,
      arquivo: files[0]?.fileName ?? '',
      dataBase: dbDateToKey(snapshot.baseDate),
      mesesConsumo: months.consumo,
      mesesChegada: months.chegada,
      mesesProgramacao: months.programacao,
      produtos,
      entradas: snapshot.inputs as unknown as Entradas,
      esperado: (snapshot.expected ?? {}) as unknown as Quinzena['esperado'],
    };

    const hojeKey = hoje ?? todayKeyInSaoPaulo(new Date());
    const half: 1 | 2 = snapshot.half === 1 ? 1 : 2;
    const calculadas = calcular(quinzena, { hoje: hojeKey, quinzena: half });
    const produtoPorLinha = new Map(produtos.map((p) => [p.linha, p]));
    // Compra sob demanda: marca do cadastro ATUAL (nao congelada na quinzena), 1 consulta por produto.
    const sobDemanda = await ForecastSobDemandaService.regrasDosProdutos(
      produtos.flatMap((p) => (p.productId != null ? [p.productId] : [])),
    );

    return {
      id: snapshot.id,
      label: snapshot.label,
      baseDate: quinzena.dataBase,
      half: snapshot.half,
      origin: snapshot.origin,
      hoje: hojeKey,
      months,
      files,
      createdAt: snapshot.createdAt,
      linhas: calculadas.map((linha) => {
        const produto = produtoPorLinha.get(linha.linha);
        return {
          ...linha,
          n: produto?.n ?? null,
          item: produto?.item ?? '',
          historico: produto?.historico ?? [],
          obs: produto?.obs ?? '',
          // So o selo (flag X da coluna AV); o valor do preco fechado nao sai da API.
          precoFixo: (produto?.precoFechado ?? '').trim().toUpperCase() === 'X',
          // Flag X da coluna AX: o relatorio de compras so sinaliza, nao muda o arredondamento.
          naoFraciona: (produto?.naoFraciona ?? '').trim().toUpperCase() === 'X',
          codigos: (produto?.codigos ?? []).filter((c) => c !== ''),
          fonte: produto?.fonte ?? '',
          status: produto?.status ?? 'nao',
          analiseForecast: produto?.analiseForecast ?? null,
          productId: produto?.productId ?? null,
          sobDemanda: produto?.productId != null && sobDemanda.has(produto.productId),
          sobDemandaMotivo: (produto?.productId != null && sobDemanda.get(produto.productId)?.motivo) || null,
        };
      }),
      conferencia: snapshot.expected ? conferenciaDaQuinzena(quinzena, hojeKey) : null,
    };
  }

  // Pendentes de cadastro da quinzena: os codigos que o DBCorp trouxe (congelados em `inputs`) comparados com o
  // cadastro ATUAL - o codigo sai da lista quando entra no cadastro. So leitura (nada e gravado na quinzena).
  static async getPendentes(id: number): Promise<ForecastPendentesData> {
    const snapshot = await prisma.forecastSnapshot.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, label: true, origin: true, baseDate: true, inputs: true },
    });
    if (!snapshot) {
      throw new HttpError(404, 'Quinzena nao encontrada.');
    }
    if (snapshot.origin !== FORECAST_ORIGIN_DBCORP) {
      return {
        aplicavel: false,
        snapshotId: snapshot.id,
        label: snapshot.label,
        itens: [],
        totalItens: 0,
        omitidos: 0,
        soSaldo: { codigos: 0, kg: 0 },
        semVendaRecente: { codigos: 0, vendasAnual: 0 },
        regra: { mesesVenda: [], historicoAusente: [], compras: 'chegadas' },
      };
    }
    const cadastro = await ForecastProductService.cadastroDeCodigos();
    // Historico ATUAL de base-3/base-2 (so leitura): regravar esses meses muda a lista, como o cadastro atual.
    const vendas = await ForecastProductService.vendasRecentes(prisma, dbDateToKey(snapshot.baseDate));
    const resultado = codigosPendentes(snapshot.inputs as unknown as Entradas, cadastro, vendas);
    return { aplicavel: true, snapshotId: snapshot.id, label: snapshot.label, ...resultado };
  }

  // Relatorio de compras: a quinzena calculada + a embalagem do cadastro ATUAL por codigo (nao e congelada
  // na quinzena; reusa o 404 de getCalculated). Nada aqui escreve em forecastSnapshot.
  static async getRelatorioCompras(id: number, hoje?: string): Promise<RelatorioCompras> {
    const calc = await ForecastSnapshotService.getCalculated(id, hoje);
    const embalagens: EmbalagemCadastrada[] = await ForecastProductService.embalagensDosCodigos(
      calc.linhas.flatMap((l) => l.codigos),
    );
    const sobDemanda = new Map(
      calc.linhas.flatMap((l) =>
        l.productId != null && l.sobDemanda ? [[l.productId, { motivo: l.sobDemandaMotivo }] as const] : [],
      ),
    );
    return montarRelatorioCompras(calc, embalagens, { sobDemanda });
  }

  // XLSX do relatorio: o MESMO objeto da tela (getRelatorioCompras); a planilha so formata.
  static async getRelatorioComprasXlsx(
    id: number,
    hoje?: string,
  ): Promise<{ fileName: string; contentBase64: string }> {
    const relatorio = await ForecastSnapshotService.getRelatorioCompras(id, hoje);
    const buffer = await gerarXlsxRelatorioCompras(relatorio);
    return { fileName: nomeArquivoRelatorioCompras(relatorio.quinzena), contentBase64: buffer.toString('base64') };
  }
}
