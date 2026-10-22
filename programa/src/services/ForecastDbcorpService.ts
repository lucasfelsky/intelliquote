import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import {
  FORECAST_DBCORP_FUP_REGRA,
  FORECAST_DBCORP_SLOTS,
  FORECAST_MAX_CODES_PER_PRODUCT,
  FORECAST_ORIGIN_DBCORP,
  type ForecastDbcorpSlot,
} from '../constants/forecast';
import { HttpError } from '../utils/http';
import {
  parseClientesAtivos,
  parseFup,
  parseMargem,
  parseProgramacao,
  parseSaldo,
  parseVendas,
  type ParsedClientesAtivos,
  type ParsedFup,
  type ParsedMargem,
  type ParsedProgramacao,
  type ParsedSaldo,
  type ParsedVendas,
} from '../utils/forecastDbcorp';
import { mesesHistorico, rotulosDaQuinzena, type RotulosDaQuinzena } from '../utils/forecastMonths';
import { codigosPendentes, type PendentesResultado } from '../utils/forecastPendentes';
import type { Entradas, Quinzena } from '../utils/forecastTypes';
import { normalizeProductCode } from '../utils/forecastWorkbook';
import type { ForecastDbcorpConfirmInput, ForecastDbcorpPreviewInput } from '../validators/forecast';
import { AuditLogService } from './AuditLogService';
import {
  aggregateSales,
  replaceMonthlySales,
  summarizeMonthlySales,
  type MonthlySalesResumo,
} from './ForecastImportService';
import { ForecastProductService } from './ForecastProductService';
import {
  ForecastSnapshotService,
  halfDoRotulo,
  type FrozenProduct,
  type SnapshotFileInfo,
} from './ForecastSnapshotService';

type Db = Prisma.TransactionClient;

const SLOT_ORDER = Object.keys(FORECAST_DBCORP_SLOTS) as ForecastDbcorpSlot[];

const MAX_ERRORS_IN_MESSAGE = 5;

interface ParsedDbcorp {
  saldo: ParsedSaldo;
  vendasMes: ParsedVendas;
  vendasAtual: ParsedVendas | null;
  vendasAnual: ParsedVendas;
  programacao: ParsedProgramacao;
  fup: ParsedFup;
  clientesAtivos: ParsedClientesAtivos | null;
  margem: ParsedMargem | null;
  files: Array<SnapshotFileInfo>;
  avisos: string[];
  erros: string[];
}

interface Casamento {
  totalCasado: number;
  codigosSemProduto: number;
}

interface BuiltQuinzena {
  quinzena: Quinzena | null;
  produtosTotal: number;
  historico: {
    meses: Array<{ yearMonth: string; linhas: number }>;
    ausentes: string[];
    mesAnterior: MonthlySalesResumo | null;
  };
  casamento: Partial<Record<ForecastDbcorpSlot, Casamento>>;
  // Codigos do DBCorp fora do cadastro ativo (ficam FORA do calculo ate completar o cadastro).
  pendentes: PendentesResultado | null;
  avisos: string[];
  erros: string[];
}

export interface ForecastDbcorpSummary {
  label: string;
  baseDate: string;
  half: 1 | 2;
  meses: RotulosDaQuinzena;
  produtos: { total: number };
  historico: BuiltQuinzena['historico'];
  relatorios: Partial<Record<ForecastDbcorpSlot, Record<string, unknown>>>;
  pendentes: PendentesResultado | null;
  avisos: string[];
  erros: string[];
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

function decodeBase64(slot: ForecastDbcorpSlot, contentBase64: string): Buffer {
  const buffer = Buffer.from(contentBase64, 'base64');
  if (buffer.length === 0) {
    throw new HttpError(400, `O arquivo do relatorio ${FORECAST_DBCORP_SLOTS[slot]} esta vazio.`);
  }
  return buffer;
}

// Tira do resumo as linhas lidas e a compra em aberto do FUP (so entra nas `Entradas` congeladas).
function tirarLinhas<T extends { linhas: unknown }>(parsed: T): Omit<T, 'linhas' | 'comprasEmAberto'> {
  const { linhas, comprasEmAberto, ...resto } = parsed as T & { comprasEmAberto?: unknown };
  void linhas;
  void comprasEmAberto;
  return resto;
}

// Quanto do relatorio casa com os codigos dos produtos ativos (e quantos codigos ficam sem produto).
function casar(lancamentos: Array<{ codigo: string; qtd: number }>, codigos: Set<string>): Casamento {
  let totalCasado = 0;
  const semProduto = new Set<string>();
  for (const { codigo, qtd } of lancamentos) {
    const code = normalizeProductCode(codigo);
    if (codigos.has(code)) totalCasado += qtd;
    else semProduto.add(code);
  }
  return { totalCasado: round6(totalCasado), codigosSemProduto: semProduto.size };
}

export class ForecastDbcorpService {
  // Decodifica e le os relatorios. Arquivo vazio/invalido = 400; problemas de conteudo viram erros.
  private static async parseAll(
    input: ForecastDbcorpPreviewInput | ForecastDbcorpConfirmInput,
  ): Promise<ParsedDbcorp> {
    const { files, baseDate, label } = input;
    const buffers: Partial<Record<ForecastDbcorpSlot, Buffer>> = {};
    for (const slot of SLOT_ORDER) {
      const file = files[slot];
      if (file) buffers[slot] = decodeBase64(slot, file.contentBase64);
    }
    const saldo = await parseSaldo(buffers.saldo!);
    const vendasMes = await parseVendas(buffers.vendasMes!, 'vendasMes');
    const vendasAtual = buffers.vendasAtual ? await parseVendas(buffers.vendasAtual, 'vendasAtual') : null;
    const vendasAnual = await parseVendas(buffers.vendasAnual!, 'vendasAnual');
    const programacao = await parseProgramacao(buffers.programacao!, baseDate);
    const fup = await parseFup(buffers.fup!, baseDate);
    const clientesAtivos = buffers.clientesAtivos ? await parseClientesAtivos(buffers.clientesAtivos) : null;
    const margem = buffers.margem ? await parseMargem(buffers.margem) : null;

    const parsedPorSlot = {
      saldo,
      vendasMes,
      vendasAtual,
      vendasAnual,
      programacao,
      fup,
      clientesAtivos,
      margem,
    };
    const avisos: string[] = [];
    const erros: string[] = [];
    const sentFiles: SnapshotFileInfo[] = [];
    for (const slot of SLOT_ORDER) {
      const parsed = parsedPorSlot[slot];
      const buffer = buffers[slot];
      if (!parsed || !buffer) continue;
      avisos.push(...parsed.avisos);
      erros.push(...parsed.erros);
      sentFiles.push({
        kind: slot,
        fileName: files[slot]!.fileName,
        sha256: createHash('sha256').update(buffer).digest('hex'),
        rows: parsed.usadas,
        ...(slot === 'fup' ? { regra: FORECAST_DBCORP_FUP_REGRA } : {}),
      });
    }
    const mesDoRotulo = label.slice(0, 2);
    const mesDaData = baseDate.slice(5, 7);
    if (mesDoRotulo !== mesDaData) {
      avisos.push(`O mes do rotulo (${mesDoRotulo}) difere do mes da data base (${mesDaData}).`);
    }
    return { ...parsedPorSlot, files: sentFiles, avisos, erros };
  }

  // Monta a quinzena a partir dos relatorios + cadastro ativo + historico. `db` = prisma (preview)
  // ou a transacao (confirm). Nao escreve nada.
  private static async buildQuinzena(
    db: Db,
    parsed: ParsedDbcorp,
    input: ForecastDbcorpPreviewInput,
  ): Promise<BuiltQuinzena> {
    const { baseDate, label } = input;
    const erros: string[] = [];
    const meses = mesesHistorico(baseDate);
    const built: BuiltQuinzena = {
      quinzena: null,
      produtosTotal: 0,
      historico: { meses: [], ausentes: [], mesAnterior: null },
      casamento: {},
      pendentes: null,
      avisos: [],
      erros,
    };

    const products = await db.forecastProduct.findMany({
      where: { isActive: true },
      orderBy: [{ sheetOrder: 'asc' }, { id: 'asc' }],
      include: { codes: { orderBy: { position: 'asc' } }, source: true },
    });
    built.produtosTotal = products.length;
    if (products.length === 0) {
      erros.push('Nenhum produto de forecast cadastrado - importe a planilha antes.');
      return built;
    }
    const allCodes = [...new Set(products.flatMap((p) => p.codes.map((c) => c.code)))];

    // Historico J..N: soma por codigo dos 5 meses base-6..base-2.
    const contagem = await db.forecastMonthlySale.groupBy({
      by: ['yearMonth'],
      where: { yearMonth: { in: meses.historico } },
      _count: { _all: true },
    });
    const linhasPorMes = new Map(contagem.map((c) => [c.yearMonth, c._count._all]));
    built.historico.meses = meses.historico.map((yearMonth) => ({
      yearMonth,
      linhas: linhasPorMes.get(yearMonth) ?? 0,
    }));
    for (const { yearMonth, linhas } of built.historico.meses) {
      if (linhas === 0) {
        built.historico.ausentes.push(yearMonth);
        const [ano, mes] = yearMonth.split('-');
        erros.push(
          `Historico de ${mes}/${ano} ausente - importe a planilha dessa quinzena (so "Gravar historico").`,
        );
      }
    }
    const sales = await db.forecastMonthlySale.findMany({
      where: { yearMonth: { in: meses.historico }, code: { in: allCodes } },
      select: { code: true, yearMonth: true, quantity: true },
    });
    const vendidoPorCodigoMes = new Map(sales.map((s) => [`${s.code}|${s.yearMonth}`, Number(s.quantity)]));

    const produtos = products.map((p, index): FrozenProduct => {
      const codigos = Array<string>(FORECAST_MAX_CODES_PER_PRODUCT).fill('');
      for (const c of p.codes) {
        if (c.position >= 1 && c.position <= FORECAST_MAX_CODES_PER_PRODUCT) codigos[c.position - 1] = c.code;
      }
      const historico = meses.historico.map((yearMonth) =>
        round6(
          p.codes.reduce((total, c) => total + (vendidoPorCodigoMes.get(`${c.code}|${yearMonth}`) ?? 0), 0),
        ),
      );
      return {
        linha: index + 3,
        n: p.sheetOrder,
        item: p.name,
        codigos,
        historico,
        analiseForecast: null, // edicao por quinzena e da Fase 2
        obs: p.notes ?? '',
        fonte: p.source?.name ?? '',
        precoFechado: p.fixedPriceFlag ? 'X' : '',
        embalagem: p.packaging ?? '',
        naoFraciona: p.noFractioning ? 'X' : '',
        qtdAmostra: p.sampleQty ?? '',
        solicitarAmostra: p.sampleRequestNote ?? '',
        status: 'nao',
        productId: p.id,
      };
    });

    const sources = await db.forecastSource.findMany({
      orderBy: { id: 'asc' },
      select: { name: true, leadTimeDays: true },
    });
    const entradas: Entradas = {
      estoque: parsed.saldo.linhas,
      vendasMes: parsed.vendasMes.linhas,
      vendasAtual: parsed.vendasAtual?.linhas ?? [],
      vendasAnual: parsed.vendasAnual.linhas,
      programacoes: parsed.programacao.linhas,
      chegadas: parsed.fup.linhas,
      leadtime: sources.map((s) => ({ fonte: s.name, total: s.leadTimeDays })),
      margem: parsed.margem?.linhas ?? [],
      clientesAtivos: parsed.clientesAtivos?.linhas ?? [],
      comprasEmAberto: parsed.fup.comprasEmAberto,
    };
    const rotulos = rotulosDaQuinzena(baseDate);
    built.quinzena = {
      id: label,
      arquivo: input.files.saldo.fileName,
      dataBase: baseDate,
      mesesConsumo: rotulos.consumo,
      mesesChegada: rotulos.chegada,
      mesesProgramacao: rotulos.programacao,
      produtos,
      entradas,
      esperado: {},
    };

    const codigosAtivos = new Set(allCodes);
    built.casamento = {
      saldo: casar(entradas.estoque, codigosAtivos),
      vendasMes: casar(entradas.vendasMes, codigosAtivos),
      vendasAnual: casar(entradas.vendasAnual, codigosAtivos),
      programacao: casar(entradas.programacoes, codigosAtivos),
      fup: casar(entradas.chegadas, codigosAtivos),
    };
    if (parsed.vendasAtual) built.casamento.vendasAtual = casar(entradas.vendasAtual, codigosAtivos);
    if (parsed.clientesAtivos) {
      built.casamento.clientesAtivos = casar(
        entradas.clientesAtivos.map((codigo) => ({ codigo, qtd: 1 })),
        codigosAtivos,
      );
    }
    if (parsed.margem) {
      built.casamento.margem = casar(
        entradas.margem.map(({ codigo }) => ({ codigo, qtd: 1 })),
        codigosAtivos,
      );
    }

    // Pendentes de cadastro: codigo fora dos produtos ativos com venda nos ultimos 3 meses, programacao ou compra
    // em aberto no FUP (regra do COMEX).
    built.pendentes = codigosPendentes(
      entradas,
      await ForecastProductService.cadastroDeCodigos(db),
      await ForecastProductService.vendasRecentes(db, baseDate),
    );
    const totalPendentes = built.pendentes.totalItens;
    if (totalPendentes > 0) {
      built.avisos.push(
        totalPendentes === 1
          ? '1 código com venda nos últimos 3 meses, programação ou compra em aberto no FUP não está no cadastro e fica FORA do cálculo até completar o cadastro.'
          : `${totalPendentes} códigos com venda nos últimos 3 meses, programação ou compra em aberto no FUP não estão no cadastro e ficam FORA do cálculo até completar o cadastro.`,
      );
    }

    // Efeito da gravacao do mes base-1 (o mes e substituido por inteiro).
    if (parsed.vendasMes.usadas > 0) {
      built.historico.mesAnterior = await summarizeMonthlySales(
        db,
        meses.anterior,
        aggregateSales(parsed.vendasMes.linhas),
      );
    }
    return built;
  }

  private static summarize(
    input: ForecastDbcorpPreviewInput,
    parsed: ParsedDbcorp,
    built: BuiltQuinzena | null,
  ): ForecastDbcorpSummary {
    const relatorios: ForecastDbcorpSummary['relatorios'] = {};
    for (const slot of SLOT_ORDER) {
      const resumo = parsed[slot];
      const file = input.files[slot];
      if (!resumo || !file) continue;
      const casamento = built?.casamento[slot];
      relatorios[slot] = {
        fileName: file.fileName,
        ...tirarLinhas(resumo),
        totalCasado: casamento?.totalCasado ?? null,
        codigosSemProduto: casamento?.codigosSemProduto ?? null,
      };
    }
    return {
      label: input.label,
      baseDate: input.baseDate,
      half: halfDoRotulo(input.label),
      meses: rotulosDaQuinzena(input.baseDate),
      produtos: { total: built?.produtosTotal ?? 0 },
      historico: built?.historico ?? { meses: [], ausentes: [], mesAnterior: null },
      relatorios,
      pendentes: built?.pendentes ?? null,
      avisos: [...parsed.avisos, ...(built?.avisos ?? [])],
      erros: [...parsed.erros, ...(built?.erros ?? [])],
    };
  }

  static async preview(input: ForecastDbcorpPreviewInput): Promise<ForecastDbcorpSummary> {
    const parsed = await ForecastDbcorpService.parseAll(input);
    if (parsed.erros.length > 0) {
      // Nada e comparado com o banco enquanto os relatorios tiverem erro.
      return ForecastDbcorpService.summarize(input, parsed, null);
    }
    const built = await ForecastDbcorpService.buildQuinzena(prisma, parsed, input);
    return ForecastDbcorpService.summarize(input, parsed, built);
  }

  static async confirm(
    input: ForecastDbcorpConfirmInput,
    userId: number | null,
  ): Promise<ForecastDbcorpSummary & { snapshotId: number }> {
    // Re-parse no servidor: nunca confia em linhas vindas do cliente.
    const parsed = await ForecastDbcorpService.parseAll(input);
    if (parsed.erros.length > 0) {
      throw new HttpError(400, `Relatorios com erros: ${parsed.erros.slice(0, MAX_ERRORS_IN_MESSAGE).join(' ')}`);
    }

    return prisma.$transaction(
      async (tx) => {
        // Serializa com o import da planilha (mesma chave): primeiro statement da transacao.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'forecast:import'}))`;
        await ForecastSnapshotService.assertLabelFree(tx, input.label);

        const built = await ForecastDbcorpService.buildQuinzena(tx, parsed, input);
        if (built.erros.length > 0 || built.quinzena === null) {
          throw new HttpError(
            400,
            `Relatorios com erros: ${built.erros.slice(0, MAX_ERRORS_IN_MESSAGE).join(' ')}`,
          );
        }

        const snapshot = await ForecastSnapshotService.createFromParsed(
          tx,
          built.quinzena,
          FORECAST_ORIGIN_DBCORP,
          parsed.files,
          userId,
        );
        await AuditLogService.log(
          {
            entityType: 'forecast_snapshot',
            entityId: snapshot.id,
            action: 'create',
            performedById: userId,
            metadata: {
              label: input.label,
              origin: FORECAST_ORIGIN_DBCORP,
              produtos: built.produtosTotal,
              arquivos: SLOT_ORDER.flatMap((slot) => {
                const resumo = parsed[slot];
                if (!resumo || !input.files[slot]) return [];
                const ignoradas = Object.values(resumo.ignoradas).reduce((a, b) => a + b, 0);
                return [{ kind: slot, usadas: resumo.usadas, ignoradas }];
              }),
              // So contagem de LINHAS (nunca kg, codigo ou texto do FUP).
              fup: {
                regra: FORECAST_DBCORP_FUP_REGRA,
                estimadasEtd: parsed.fup.estimadasPorEtd.linhas,
                estimadasProntidao: parsed.fup.estimadasPorProntidao.linhas,
                excluidasAtracadas: parsed.fup.excluidas.atracadas.linhas,
                excluidasEtaFinal: parsed.fup.excluidas.etaFinalPreenchida.linhas,
                prontidaoNaoReconhecida: parsed.fup.prontidaoNaoReconhecida.linhas,
                semData: parsed.fup.semData.linhas,
              },
            },
          },
          tx,
        );

        // A VENDAS do mes anterior e o relatorio completo do mes base-1: substitui o mes inteiro.
        const anterior = mesesHistorico(input.baseDate).anterior;
        const rows = aggregateSales(parsed.vendasMes.linhas);
        const resumoMes = built.historico.mesAnterior ?? (await summarizeMonthlySales(tx, anterior, rows));
        await replaceMonthlySales(
          tx,
          {
            yearMonth: anterior,
            rows,
            sourceLabel: `dbcorp ${input.label}`,
            snapshotId: snapshot.id,
            resumo: resumoMes,
          },
          userId,
        );

        return { ...ForecastDbcorpService.summarize(input, parsed, built), snapshotId: snapshot.id };
      },
      { timeout: 120_000, maxWait: 10_000 },
    );
  }
}
