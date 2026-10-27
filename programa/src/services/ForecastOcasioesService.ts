import { Prisma } from '@prisma/client';
import { FORECAST_OCASIOES_LISTA_MAX } from '../constants/forecast';
import { prisma } from '../lib/prisma';
import type {
  ForecastOcasiaoCreateInput,
  ForecastOcasiaoPatchInput,
  ForecastOcasioesQueryInput,
} from '../validators/forecast';
import {
  ocorrenciasNaJanela,
  type EfeitoOcasiao,
  type EscopoOcasiao,
  type EtapaOcasiao,
  type OcasiaoLeadTime,
  type Ocorrencia,
  type RecorrenciaOcasiao,
} from '../utils/forecastOcasioes';
import { HttpError } from '../utils/http';
import { dateKeyToDbDate, dbDateToKey } from '../utils/supplierDocumentDates';
import { AuditLogService } from './AuditLogService';

const ENTITY_TYPE = 'forecast_lead_time_event';

const NAO_ENCONTRADA = 'Ocasião não encontrada.';
const FONTE_INVALIDA = 'Fonte nao encontrada ou inativa.';
const DUPLICADA = 'Já existe uma ocasião ativa com o mesmo alcance, período e etapa. Edite a existente.';

const COM_FONTE = {
  source: { select: { id: true, name: true, isActive: true } },
} satisfies Prisma.ForecastLeadTimeEventInclude;

type OcasiaoComFonte = Prisma.ForecastLeadTimeEventGetPayload<{ include: typeof COM_FONTE }>;

// Campos que o calculo e a auditoria leem (a linha do banco satisfaz; `effectValue` chega como Decimal ou number).
interface LinhaOcasiao {
  id: number;
  scopeType: string;
  countryCode: string | null;
  sourceId: number | null;
  startDate: Date;
  endDate: Date;
  recurrence: string;
  component: string;
  effectKind: string;
  effectValue: Prisma.Decimal | number;
  isActive: boolean;
}

export interface ForecastOcasiaoData {
  id: number;
  name: string;
  scopeType: string;
  countryCode: string | null;
  sourceId: number | null;
  source: { id: number; name: string; isActive: boolean } | null;
  startDate: string;
  endDate: string;
  recurrence: string;
  component: string;
  effectKind: string;
  effectValue: number;
  notes: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  /** Ocorrencias (inteiras, nao recortadas) que intersectam a janela pedida; null quando a consulta nao tem janela. */
  ocorrencias: Ocorrencia[] | null;
}

/** Linha do banco no formato da util pura (reusado pelo relatorio de compras). */
export function paraOcasiaoDoCalculo(row: LinhaOcasiao): OcasiaoLeadTime {
  return {
    id: row.id,
    escopo: row.scopeType as EscopoOcasiao,
    countryCode: row.countryCode,
    sourceId: row.sourceId,
    inicio: dbDateToKey(row.startDate),
    fim: dbDateToKey(row.endDate),
    recorrencia: row.recurrence as RecorrenciaOcasiao,
    etapa: row.component as EtapaOcasiao,
    efeito: row.effectKind as EfeitoOcasiao,
    valor: Number(row.effectValue),
    ativa: row.isActive,
  };
}

// Nunca devolve `coverWithStock` (existe so na coluna).
function paraDados(row: OcasiaoComFonte, ocorrencias: Ocorrencia[] | null): ForecastOcasiaoData {
  return {
    id: row.id,
    name: row.name,
    scopeType: row.scopeType,
    countryCode: row.countryCode,
    sourceId: row.sourceId,
    source: row.source ? { id: row.source.id, name: row.source.name, isActive: row.source.isActive } : null,
    startDate: dbDateToKey(row.startDate),
    endDate: dbDateToKey(row.endDate),
    recurrence: row.recurrence,
    component: row.component,
    effectKind: row.effectKind,
    effectValue: Number(row.effectValue),
    notes: row.notes,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ocorrencias,
  };
}

// UNICA fonte dos dados de auditoria (antes e depois): so ids, enums, numeros e datas. `name` e `notes` (texto livre) nunca vao ao log.
function dadosAuditaveis(row: LinhaOcasiao) {
  return {
    scopeType: row.scopeType,
    countryCode: row.countryCode,
    sourceId: row.sourceId,
    startDate: dbDateToKey(row.startDate),
    endDate: dbDateToKey(row.endDate),
    recurrence: row.recurrence,
    component: row.component,
    effectKind: row.effectKind,
    effectValue: Number(row.effectValue),
    isActive: row.isActive,
  };
}

// No escopo `fonte`, a fonte precisa existir e estar ativa (a util ignora fonte inativa, entao a ocasiao seria inutil).
async function conferirFonte(tx: Prisma.TransactionClient, sourceId: number | null): Promise<void> {
  if (sourceId === null) {
    throw new HttpError(400, FONTE_INVALIDA);
  }
  const fonte = await tx.forecastSource.findFirst({ where: { id: sourceId, isActive: true }, select: { id: true } });
  if (!fonte) {
    throw new HttpError(400, FONTE_INVALIDA);
  }
}

interface ChaveOcasiao {
  scopeType: string;
  countryCode: string | null;
  sourceId: number | null;
  startDate: string;
  endDate: string;
  component: string;
}

// Duplicata = outra ocasiao ATIVA com o mesmo alcance, periodo e etapa (a recorrencia fica fora da chave). A soma e sem
// teto: a copia dobraria o efeito. Sem indice unico: dois cliques simultaneos podem passar (cadastro pequeno; aceito).
async function conferirDuplicata(tx: Prisma.TransactionClient, chave: ChaveOcasiao, exceto: number | null): Promise<void> {
  const outra = await tx.forecastLeadTimeEvent.findFirst({
    where: {
      isActive: true,
      scopeType: chave.scopeType,
      countryCode: chave.countryCode,
      sourceId: chave.sourceId,
      startDate: dateKeyToDbDate(chave.startDate),
      endDate: dateKeyToDbDate(chave.endDate),
      component: chave.component,
      ...(exceto !== null ? { id: { not: exceto } } : {}),
    },
    select: { id: true },
  });
  if (outra) {
    throw new HttpError(409, DUPLICADA);
  }
}

const CAMPOS_DA_CHAVE = ['scopeType', 'countryCode', 'sourceId', 'startDate', 'endDate', 'component'];

export class ForecastOcasioesService {
  static async list(query: ForecastOcasioesQueryInput): Promise<ForecastOcasiaoData[]> {
    const where: Prisma.ForecastLeadTimeEventWhereInput = {};
    if (query.scopeType !== undefined) where.scopeType = query.scopeType;
    if (query.countryCode !== undefined) where.countryCode = query.countryCode;
    if (query.sourceId !== undefined) where.sourceId = query.sourceId;
    if (query.ativa !== undefined) where.isActive = query.ativa;
    const janela = query.de !== undefined && query.ate !== undefined ? { de: query.de, ate: query.ate } : null;
    if (janela) {
      // Anual pode cair na janela em qualquer ano (a util decide); nenhuma so se o periodo intersecta.
      where.OR = [
        { recurrence: 'anual' },
        { startDate: { lte: dateKeyToDbDate(janela.ate) }, endDate: { gte: dateKeyToDbDate(janela.de) } },
      ];
    }

    const linhas = await prisma.forecastLeadTimeEvent.findMany({
      where,
      include: COM_FONTE,
      orderBy: [{ startDate: 'asc' }, { id: 'asc' }],
      take: FORECAST_OCASIOES_LISTA_MAX,
    });

    if (!janela) {
      return linhas.map((linha) => paraDados(linha, null));
    }
    const dados: ForecastOcasiaoData[] = [];
    for (const linha of linhas) {
      const ocorrencias = ocorrenciasNaJanela(
        {
          inicio: dbDateToKey(linha.startDate),
          fim: dbDateToKey(linha.endDate),
          recorrencia: linha.recurrence as RecorrenciaOcasiao,
        },
        janela.de,
        janela.ate,
      );
      if (ocorrencias.length > 0) {
        dados.push(paraDados(linha, ocorrencias));
      }
    }
    return dados;
  }

  static async create(input: ForecastOcasiaoCreateInput, userId: number | null): Promise<ForecastOcasiaoData> {
    return prisma.$transaction(async (tx) => {
      if (input.scopeType === 'fonte') {
        await conferirFonte(tx, input.sourceId);
      }
      if (input.isActive) {
        await conferirDuplicata(tx, input, null);
      }
      const criada = await tx.forecastLeadTimeEvent.create({
        data: {
          name: input.name,
          scopeType: input.scopeType,
          countryCode: input.countryCode,
          sourceId: input.sourceId,
          startDate: dateKeyToDbDate(input.startDate),
          endDate: dateKeyToDbDate(input.endDate),
          recurrence: input.recurrence,
          component: input.component,
          effectKind: input.effectKind,
          effectValue: input.effectValue,
          notes: input.notes,
          isActive: input.isActive,
          createdById: userId,
        },
        include: COM_FONTE,
      });
      await AuditLogService.log(
        {
          entityType: ENTITY_TYPE,
          entityId: criada.id,
          action: 'create',
          performedById: userId,
          afterData: dadosAuditaveis(criada),
          metadata: {
            source: 'manual',
            camposAlterados: [
              'name',
              'scopeType',
              'countryCode',
              'sourceId',
              'startDate',
              'endDate',
              'recurrence',
              'component',
              'effectKind',
              'effectValue',
              'notes',
              'isActive',
            ],
          },
        },
        tx,
      );
      return paraDados(criada, null);
    });
  }

  static async patch(id: number, input: ForecastOcasiaoPatchInput, userId: number | null): Promise<ForecastOcasiaoData> {
    return prisma.$transaction(async (tx) => {
      const atual = await tx.forecastLeadTimeEvent.findUnique({ where: { id }, include: COM_FONTE });
      if (!atual) {
        throw new HttpError(404, NAO_ENCONTRADA);
      }

      // Estado final = atual + o que veio (blocos de escopo, periodo e efeito chegam completos do Zod).
      const proximo = {
        name: input.name ?? atual.name,
        scopeType: input.scopeType ?? atual.scopeType,
        countryCode: input.scopeType !== undefined ? (input.countryCode ?? null) : atual.countryCode,
        sourceId: input.scopeType !== undefined ? (input.sourceId ?? null) : atual.sourceId,
        startDate: input.startDate ?? dbDateToKey(atual.startDate),
        endDate: input.endDate ?? dbDateToKey(atual.endDate),
        recurrence: input.recurrence ?? atual.recurrence,
        component: input.component ?? atual.component,
        effectKind: input.effectKind ?? atual.effectKind,
        effectValue: input.effectValue ?? Number(atual.effectValue),
        notes: input.notes !== undefined ? input.notes : atual.notes,
        isActive: input.isActive ?? atual.isActive,
      };

      const camposAlterados: string[] = [];
      if (proximo.name !== atual.name) camposAlterados.push('name');
      if (proximo.scopeType !== atual.scopeType) camposAlterados.push('scopeType');
      if (proximo.countryCode !== atual.countryCode) camposAlterados.push('countryCode');
      if (proximo.sourceId !== atual.sourceId) camposAlterados.push('sourceId');
      if (proximo.startDate !== dbDateToKey(atual.startDate)) camposAlterados.push('startDate');
      if (proximo.endDate !== dbDateToKey(atual.endDate)) camposAlterados.push('endDate');
      if (proximo.recurrence !== atual.recurrence) camposAlterados.push('recurrence');
      if (proximo.component !== atual.component) camposAlterados.push('component');
      if (proximo.effectKind !== atual.effectKind) camposAlterados.push('effectKind');
      if (proximo.effectValue !== Number(atual.effectValue)) camposAlterados.push('effectValue');
      if (proximo.notes !== atual.notes) camposAlterados.push('notes');
      if (proximo.isActive !== atual.isActive) camposAlterados.push('isActive');

      // Sem mudanca efetiva: nao grava nem audita.
      if (camposAlterados.length === 0) {
        return paraDados(atual, null);
      }

      if ((input.scopeType !== undefined || input.isActive === true) && proximo.scopeType === 'fonte') {
        await conferirFonte(tx, proximo.sourceId);
      }
      const mexeNaChave = camposAlterados.some((campo) => CAMPOS_DA_CHAVE.includes(campo));
      if (proximo.isActive && (mexeNaChave || camposAlterados.includes('isActive'))) {
        await conferirDuplicata(tx, proximo, id);
      }

      const atualizada = await tx.forecastLeadTimeEvent.update({
        where: { id },
        data: {
          name: proximo.name,
          scopeType: proximo.scopeType,
          countryCode: proximo.countryCode,
          sourceId: proximo.sourceId,
          startDate: dateKeyToDbDate(proximo.startDate),
          endDate: dateKeyToDbDate(proximo.endDate),
          recurrence: proximo.recurrence,
          component: proximo.component,
          effectKind: proximo.effectKind,
          effectValue: proximo.effectValue,
          notes: proximo.notes,
          isActive: proximo.isActive,
        },
        include: COM_FONTE,
      });
      await AuditLogService.log(
        {
          entityType: ENTITY_TYPE,
          entityId: id,
          action: 'update',
          performedById: userId,
          beforeData: dadosAuditaveis(atual),
          afterData: dadosAuditaveis(atualizada),
          metadata: { source: 'manual', camposAlterados },
        },
        tx,
      );
      return paraDados(atualizada, null);
    });
  }

  static async remove(id: number, userId: number | null): Promise<{ id: number }> {
    return prisma.$transaction(async (tx) => {
      const atual = await tx.forecastLeadTimeEvent.findUnique({ where: { id } });
      if (!atual) {
        throw new HttpError(404, NAO_ENCONTRADA);
      }
      await tx.forecastLeadTimeEvent.delete({ where: { id } });
      await AuditLogService.log(
        {
          entityType: ENTITY_TYPE,
          entityId: id,
          action: 'delete',
          performedById: userId,
          beforeData: dadosAuditaveis(atual),
          metadata: { source: 'manual' },
        },
        tx,
      );
      return { id };
    });
  }
}
