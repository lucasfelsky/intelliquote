import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { FORECAST_MAX_DIVERGENCES, FORECAST_ORIGIN_DBCORP } from '../constants/forecast';
import { calcular, conferir, type Divergencia } from '../utils/forecastEngine';
import { gruposDasLinhas } from '../utils/forecastGruposEquivalencia';
import { mapaForaDaMedia, marcasNaJanela } from '../utils/forecastMesesAtipicos';
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
import { gerarXlsxForecastMacro, nomeArquivoForecastMacro } from '../utils/forecastMacroXlsx';
import { dateKeyToDbDate, dbDateToKey, todayKeyInSaoPaulo } from '../utils/supplierDocumentDates';
import { HttpError } from '../utils/http';
import { AuditLogService } from './AuditLogService';
import { ForecastDemandaComercialService } from './ForecastDemandaComercialService';
import { ForecastGrupoEquivalenciaService } from './ForecastGrupoEquivalenciaService';
import { ForecastMesesAtipicosService } from './ForecastMesesAtipicosService';
import { CADASTRO_TX_OPTIONS, isCadastroOcupado } from './ForecastProductCadastroService';
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
// erro do motor. Pelo mesmo motivo NAO passa `mesesForaDaMedia` (PR 6c): a marca de mes atipico e decisao do Comex, nao
// do Excel; a conferencia continua sobre as medias da planilha, com ou sem marcas no cadastro.
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

// Texto congelado com trim; vazio, so espacos ou ausente -> null.
const textoOuNulo = (value: string | undefined): string | null => value?.trim() || null;

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

  // Exclui a quinzena (soft delete: deletedAt). Mesma advisory lock dos dois imports, que criam quinzenas: um import em
  // andamento termina antes (e a exclusao ve a quinzena recem-criada) ou comeca depois (e ve o rotulo livre). Nao
  // desfaz o que a importacao gravou (cadastro, historico de vendas, prazos). Ja excluida/inexistente = 404 sem gravar
  // nem auditar. O AuditLog guarda so rotulo (NN-q), data base, origem e metade: nunca dados da quinzena (estoque,
  // vendas, nomes de produto e observacoes sao texto livre).
  static async excluir(id: number, userId: number | null) {
    try {
      return await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'forecast:import'}))`;

        const atual = await tx.forecastSnapshot.findFirst({
          where: { id, deletedAt: null },
          select: { id: true, label: true, baseDate: true, origin: true, half: true },
        });
        if (!atual) throw new HttpError(404, 'Quinzena nao encontrada.');

        const { count } = await tx.forecastSnapshot.updateMany({
          where: { id, deletedAt: null },
          data: { deletedAt: new Date() },
        });
        if (count === 0) throw new HttpError(404, 'Quinzena nao encontrada.');

        await AuditLogService.log(
          {
            entityType: 'forecast_snapshot',
            entityId: id,
            action: 'soft_delete',
            performedById: userId,
            metadata: {
              label: atual.label,
              baseDate: dbDateToKey(atual.baseDate),
              origin: atual.origin,
              half: atual.half,
            },
          },
          tx,
        );
        return { id, label: atual.label, excluida: true as const };
      }, CADASTRO_TX_OPTIONS);
    } catch (error) {
      if (isCadastroOcupado(error)) {
        throw new HttpError(503, 'Há uma importação do Forecast em andamento. Tente de novo em instantes.');
      }
      throw error;
    }
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

  // Quinzena congelada (nao deletada) montada para o motor; 404 quando nao existe. So leitura.
  private static async carregarQuinzena(id: number) {
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
    const half: 1 | 2 = snapshot.half === 1 ? 1 : 2;
    return { snapshot, months, produtos, files, quinzena, half };
  }

  // Meses atipicos (PR 6c): marcas do cadastro ATUAL, 1 consulta; so as que cabem na janela de vendas da quinzena
  // entram na media. Sem marca, o calculo e o mesmo de antes.
  private static async marcasDaQuinzena(produtos: FrozenProduct[], dataBase: string) {
    const productIds = produtos.flatMap((p) => (p.productId != null ? [p.productId] : []));
    const marcas = await ForecastMesesAtipicosService.doProdutos(productIds);
    const mesesForaDaMedia = mapaForaDaMedia(
      produtos,
      new Map([...marcas].map(([id, lista]) => [id, lista.map((m) => m.anoMes)])),
      dataBase,
    );
    return { marcas, mesesForaDaMedia };
  }

  // Quinzena calculada pelo motor (+ conferencia com o Excel quando a origem e a planilha).
  static async getCalculated(id: number, hoje?: string) {
    const { snapshot, months, produtos, files, quinzena, half } = await ForecastSnapshotService.carregarQuinzena(id);

    const hojeKey = hoje ?? todayKeyInSaoPaulo(new Date());
    const produtoPorLinha = new Map(produtos.map((p) => [p.linha, p]));
    const productIds = produtos.flatMap((p) => (p.productId != null ? [p.productId] : []));
    // Compra sob demanda: marca do cadastro ATUAL (nao congelada na quinzena), 1 consulta por produto.
    const sobDemanda = await ForecastSobDemandaService.regrasDosProdutos(productIds);
    // Grupos de equivalencia (PR 6b): vinculo do cadastro ATUAL (nao congelado na quinzena), 1 consulta.
    const gruposDosProdutos = await ForecastGrupoEquivalenciaService.gruposDosProdutos(productIds);
    const { marcas, mesesForaDaMedia } = await ForecastSnapshotService.marcasDaQuinzena(produtos, quinzena.dataBase);
    const calculadas = calcular(quinzena, { hoje: hojeKey, quinzena: half, mesesForaDaMedia });

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
          // Colunas AY/AZ congeladas na quinzena (texto livre do Comex); vazio ou ausente (quinzena antiga) = null.
          qtdAmostra: textoOuNulo(produto?.qtdAmostra),
          solicitarAmostra: textoOuNulo(produto?.solicitarAmostra),
          // Flag X da coluna AX: o relatorio de compras so sinaliza, nao muda o arredondamento.
          naoFraciona: (produto?.naoFraciona ?? '').trim().toUpperCase() === 'X',
          codigos: (produto?.codigos ?? []).filter((c) => c !== ''),
          fonte: produto?.fonte ?? '',
          status: produto?.status ?? 'nao',
          analiseForecast: produto?.analiseForecast ?? null,
          productId: produto?.productId ?? null,
          sobDemanda: produto?.productId != null && sobDemanda.has(produto.productId),
          sobDemandaMotivo: (produto?.productId != null && sobDemanda.get(produto.productId)?.motivo) || null,
          grupo: (produto?.productId != null && gruposDosProdutos.get(produto.productId)) || null,
          // Marcas da janela desta quinzena (indice 0..5 = J..O, 6 = P); o motivo e o do cadastro. Vazio sem marca.
          mesesForaDaMedia:
            produto?.productId != null ? marcasNaJanela(quinzena.dataBase, marcas.get(produto.productId) ?? []) : [],
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
    // Demanda do comercial (PR 6d): pedidos abertos do cadastro ATUAL (nao congelados na quinzena), 1 consulta.
    const demandasComerciais = await ForecastDemandaComercialService.abertas();
    return montarRelatorioCompras(calc, embalagens, {
      sobDemanda,
      demandasComerciais,
      grupos: gruposDasLinhas(calc.linhas),
    });
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

  // XLSX no layout da aba FORECAST (MACRO): a quinzena congelada + as marcas de mes atipico do cadastro ATUAL (como a
  // tela); formulas vivas com o resultado do motor em cache. Nao consulta cadastro, grupos nem demanda; so leitura.
  static async getRelatorioComprasXlsxMacro(
    id: number,
    hoje?: string,
  ): Promise<{ fileName: string; contentBase64: string }> {
    const { snapshot, produtos, quinzena, half } = await ForecastSnapshotService.carregarQuinzena(id);
    const hojeKey = hoje ?? todayKeyInSaoPaulo(new Date());
    const { mesesForaDaMedia } = await ForecastSnapshotService.marcasDaQuinzena(produtos, quinzena.dataBase);
    const buffer = await gerarXlsxForecastMacro({
      quinzena,
      hoje: hojeKey,
      half,
      origin: snapshot.origin,
      mesesForaDaMedia,
    });
    return {
      fileName: nomeArquivoForecastMacro({ label: quinzena.id, hoje: hojeKey }),
      contentBase64: buffer.toString('base64'),
    };
  }
}
