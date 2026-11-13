import { Prisma } from '@prisma/client';
import { pipedriveEnv, type PipedriveEnv } from '../config/env';
import { prisma } from '../lib/prisma';
import {
  getPipedriveClient,
  PipedriveAuthError,
  PipedriveError,
  PipedriveNotFoundError,
  PipedriveRateLimitError,
  type PipedriveClient,
} from '../lib/pipedriveClient';
import { HttpError } from '../utils/http';
import type { IndentIntegrationConfigInput } from '../validators/indentPipedrive';
import { AuditLogService } from './AuditLogService';
import type { IndentActor } from './IndentRequestService';

// Configuracao da integracao Pipedrive do IQ Indent (linha unica id = 1 em IndentIntegrationConfig).
// Funil, coluna (id + nome) e prazo "oficiais" ficam no banco; o env so semeia a linha na 1a leitura. A tela de estado
// (`getStatus`) NUNCA chama o Pipedrive: le o que a ultima varredura gravou.

const CONFIG_ID = 1;
const ENTITY_TYPE = 'indent_integration_config';
export const DEFAULT_SLA_BUSINESS_DAYS = 2;
// So exibicao: o intervalo real e o do Cloud Scheduler (a cada 10 min, 7h-19h, seg-sex, America/Sao_Paulo).
export const SYNC_INTERVAL_MINUTES = 10;
export const NOT_CONFIGURED_MESSAGE = 'Integração com o Pipedrive não configurada.';

export type IndentConnectionStatus =
  | 'not_configured'
  | 'ok'
  | 'auth_failed'
  | 'rate_limited'
  | 'budget_low'
  | 'config_mismatch'
  | 'error';

/** Nome de coluna para comparar: NFD, sem acento, minusculas, espacos colapsados. */
export function normalizeStageName(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Erro do cliente do Pipedrive -> erro HTTP para a tela (sem token, URL nem corpo da resposta). */
export function toPipedriveHttpError(error: unknown): HttpError | null {
  if (error instanceof HttpError) {
    return error;
  }
  if (error instanceof PipedriveAuthError) {
    return new HttpError(502, 'Falha de autenticação no Pipedrive. O token pode ter sido trocado ou revogado. Avise o administrador.');
  }
  if (error instanceof PipedriveRateLimitError) {
    return new HttpError(429, 'Limite de chamadas do Pipedrive atingido. Tente de novo em alguns minutos.');
  }
  if (error instanceof PipedriveError && error.code === 'not_configured') {
    return new HttpError(409, NOT_CONFIGURED_MESSAGE);
  }
  if (error instanceof PipedriveNotFoundError) {
    return new HttpError(400, 'Funil ou coluna não encontrados no Pipedrive.');
  }
  if (error instanceof PipedriveError) {
    return new HttpError(502, 'O Pipedrive não respondeu como esperado. Tente de novo em alguns minutos.');
  }
  return null;
}

function seedFromEnv(env: PipedriveEnv) {
  return {
    id: CONFIG_ID,
    pipelineId: env.pipelineId ?? null,
    stageId: env.stageId ?? null,
    stageName: env.stageName ?? null,
    connectionStatus: env.configured ? 'ok' : 'not_configured',
  };
}

export class IndentIntegrationConfigService {
  /** Linha unica; criada na 1a leitura com os valores do env (depois o banco vale). */
  static async get(env: PipedriveEnv = pipedriveEnv) {
    const existing = await prisma.indentIntegrationConfig.findUnique({ where: { id: CONFIG_ID } });

    if (existing) {
      return IndentIntegrationConfigService.fillEmptyFromEnv(existing, env);
    }

    try {
      return await prisma.indentIntegrationConfig.upsert({
        where: { id: CONFIG_ID },
        update: {},
        create: seedFromEnv(env),
      });
    } catch (error) {
      // Duas 1as leituras ao mesmo tempo: a outra criou a linha entre o find e o insert; basta reler.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return prisma.indentIntegrationConfig.findUniqueOrThrow({ where: { id: CONFIG_ID } });
      }
      throw error;
    }
  }

  /**
   * A linha pode ter nascido antes de o env estar no deploy (funil/coluna nulos): campos AINDA VAZIOS sao completados a partir
   * do env valido. O que ja esta no banco (inclusive o que o admin salvou na tela) nunca e sobrescrito.
   */
  private static async fillEmptyFromEnv<T extends { pipelineId: number | null; stageId: number | null; stageName: string | null; connectionStatus: string }>(
    row: T,
    env: PipedriveEnv,
  ): Promise<T> {
    if (!env.configured) {
      return row;
    }

    const patch: { pipelineId?: number; stageId?: number; stageName?: string; connectionStatus?: string } = {};

    if (row.pipelineId === null && env.pipelineId !== undefined) patch.pipelineId = env.pipelineId;
    if (row.stageId === null && env.stageId !== undefined) patch.stageId = env.stageId;
    if (row.stageName === null && env.stageName !== undefined) patch.stageName = env.stageName;

    if (Object.keys(patch).length === 0) {
      return row;
    }
    if (row.connectionStatus === 'not_configured') {
      patch.connectionStatus = 'ok';
    }

    return { ...row, ...(await prisma.indentIntegrationConfig.update({ where: { id: CONFIG_ID }, data: patch })) };
  }

  /** Prazo interno (1-3 dias uteis) para as telas de Solicitacoes; sem configuracao = 2. Nao cria a linha. */
  static async getSlaBusinessDays(): Promise<number> {
    const row = await prisma.indentIntegrationConfig.findUnique({
      where: { id: CONFIG_ID },
      select: { slaBusinessDays: true },
    });
    return row?.slaBusinessDays ?? DEFAULT_SLA_BUSINESS_DAYS;
  }

  /** Estado da integracao (SEM chamar a API do Pipedrive). */
  static async getStatus(env: PipedriveEnv = pipedriveEnv) {
    const [config, pendingCount] = await Promise.all([
      IndentIntegrationConfigService.get(env),
      prisma.indentPendingOrg.count({ where: { status: 'OPEN' } }),
    ]);
    const configured = env.configured && config.pipelineId !== null && config.stageId !== null;

    return {
      configured,
      connection: (configured ? config.connectionStatus : 'not_configured') as IndentConnectionStatus,
      mode: 'polling' as const,
      webhook: 'not_configured' as const,
      connectionCheckedAt: config.connectionCheckedAt,
      lastSyncAt: config.lastSyncAt,
      lastSyncNewDeals: config.lastSyncNewDeals,
      lastSyncErrors: config.lastSyncErrors,
      pipelineId: config.pipelineId,
      pipelineName: config.pipelineName,
      stageId: config.stageId,
      stageName: config.stageName,
      slaBusinessDays: config.slaBusinessDays,
      pendingCount,
      dailyTokensRemaining: config.dailyTokensRemaining,
      dailyTokensLimit: config.dailyTokensLimit,
      intervalMinutes: SYNC_INTERVAL_MINUTES,
    };
  }

  /** Conferencia do funil (decisao 7): a coluna ainda tem o funil e o nome gravados? 1 chamada (`GET /v1/stages/{id}`). */
  static async verifyStage(
    client: PipedriveClient,
    expected: { pipelineId: number; stageId: number; stageName: string | null },
  ): Promise<{ matches: boolean; stageName: string }> {
    let stage: Awaited<ReturnType<PipedriveClient['getStage']>>;
    try {
      stage = await client.getStage(expected.stageId);
    } catch (error) {
      // Coluna apagada no Pipedrive (404/410): nao confere, nada e processado.
      if (error instanceof PipedriveNotFoundError) {
        return { matches: false, stageName: '' };
      }
      throw error;
    }
    const sameName =
      expected.stageName !== null && normalizeStageName(stage.name) === normalizeStageName(expected.stageName);
    return { matches: stage.pipelineId === expected.pipelineId && sameName, stageName: stage.name };
  }

  /** Opcoes AO VIVO para os selects da tela (so admin): funis e colunas do funil escolhido. */
  static async getLiveOptions(pipelineIdOverride?: number, env: PipedriveEnv = pipedriveEnv) {
    if (!env.configured) {
      throw new HttpError(409, NOT_CONFIGURED_MESSAGE);
    }

    const config = await IndentIntegrationConfigService.get(env);
    const pipelineId = pipelineIdOverride ?? config.pipelineId;

    try {
      const client = getPipedriveClient();
      const pipelines = await client.listPipelines();
      const stages = pipelineId === null ? [] : await client.listStages(pipelineId);

      return {
        pipelines: pipelines.map((pipeline) => ({ id: pipeline.id, name: pipeline.name })),
        stages: stages.map((stage) => ({ id: stage.id, name: stage.name, pipelineId: stage.pipelineId })),
        slaOptions: [1, 2, 3],
        current: { pipelineId: config.pipelineId, stageId: config.stageId, slaBusinessDays: config.slaBusinessDays },
      };
    } catch (error) {
      throw await IndentIntegrationConfigService.failWith(error);
    }
  }

  /** Salva funil, coluna e prazo (so admin). Funil e coluna sao conferidos no Pipedrive; os nomes vem de la, nunca do corpo. */
  static async update(
    input: IndentIntegrationConfigInput,
    user: IndentActor,
    now: Date = new Date(),
    env: PipedriveEnv = pipedriveEnv,
  ) {
    if (!env.configured) {
      throw new HttpError(409, NOT_CONFIGURED_MESSAGE);
    }

    let stageName: string;
    let pipelineName: string;

    try {
      const client = getPipedriveClient();
      const stage = await client.getStage(input.stageId);

      if (stage.pipelineId !== input.pipelineId) {
        throw new HttpError(400, 'A coluna escolhida não pertence ao funil.');
      }

      const pipeline = (await client.listPipelines()).find((entry) => entry.id === input.pipelineId);

      if (!pipeline) {
        throw new HttpError(400, 'Funil não encontrado no Pipedrive.');
      }

      stageName = stage.name;
      pipelineName = pipeline.name;
    } catch (error) {
      throw await IndentIntegrationConfigService.failWith(error);
    }

    await IndentIntegrationConfigService.get(env);

    await prisma.$transaction(async (tx) => {
      const before = await tx.indentIntegrationConfig.findUnique({ where: { id: CONFIG_ID } });
      const after = await tx.indentIntegrationConfig.update({
        where: { id: CONFIG_ID },
        data: {
          pipelineId: input.pipelineId,
          pipelineName,
          stageId: input.stageId,
          stageName,
          ...(input.slaBusinessDays !== undefined ? { slaBusinessDays: input.slaBusinessDays } : {}),
          connectionStatus: 'ok',
          connectionCheckedAt: now,
          updatedById: user.id,
        },
      });

      await AuditLogService.log(
        {
          entityType: ENTITY_TYPE,
          entityId: CONFIG_ID,
          action: 'indent_integration_config.updated',
          performedById: user.id,
          beforeData: before
            ? {
                pipelineId: before.pipelineId,
                stageId: before.stageId,
                slaBusinessDays: before.slaBusinessDays,
              }
            : null,
          afterData: {
            pipelineId: after.pipelineId,
            stageId: after.stageId,
            slaBusinessDays: after.slaBusinessDays,
          },
        },
        tx,
      );
    });

    return IndentIntegrationConfigService.getStatus(env);
  }

  /** Grava o estado de conexao (melhor esforco) e devolve o erro HTTP equivalente para a tela. */
  private static async failWith(error: unknown): Promise<Error> {
    const mapped = toPipedriveHttpError(error);

    if (!mapped) {
      return error instanceof Error ? error : new Error('Falha inesperada.');
    }

    const status =
      error instanceof PipedriveAuthError ? 'auth_failed' : error instanceof PipedriveRateLimitError ? 'rate_limited' : null;

    if (status) {
      try {
        await prisma.indentIntegrationConfig.updateMany({
          where: { id: CONFIG_ID },
          data: { connectionStatus: status, connectionCheckedAt: new Date() },
        });
      } catch {
        // Gravar o estado e melhor esforco: o erro da chamada original e o que importa para a tela.
      }
    }

    return mapped;
  }
}
