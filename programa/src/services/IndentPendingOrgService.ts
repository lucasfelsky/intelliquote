import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { HttpError } from '../utils/http';
import type { PendingOrgCreateClientInput, PendingOrgLinkInput } from '../validators/indentPipedrive';
import { AuditLogService } from './AuditLogService';
import { IndentClientService } from './IndentClientService';
import type { IndentActor } from './IndentRequestService';

// Fila de vinculo do Pipedrive (PR 5a.3): organizacao do Pipedrive sem cliente do IQ Indent. Resolver = criar o cliente ou ligar a um
// existente; a solicitacao recebe o cliente e as outras pendencias ABERTAS cujo unico candidato e a mesma organizacao tambem.
// O IQ nunca escreve no Pipedrive: tudo aqui e banco local (Indent*). Pendencia de cliente NAO e reavaliada pela sincronizacao.

const ENTITY_TYPE = 'indent_pending_org';
const LIST_LIMIT = 200;
const PROPAGATION_LIMIT = 500;
const TX_TIMEOUT_MS = 20_000;
const ALREADY_RESOLVED_MESSAGE = 'Pendência já resolvida.';
const FOREIGN_ORG_MESSAGE = 'Organização fora deste negócio.';

export interface PendingOrgCandidate {
  orgId: number;
  name: string;
  /** 14 digitos (CNPJ valido da organizacao) ou `null`. */
  cnpj: string | null;
  city: string | null;
}

/** Le o JSON gravado pela sincronizacao sem confiar no formato (campo fora do esperado vira `null`/e descartado). */
export function readCandidates(value: unknown): PendingOrgCandidate[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const list: PendingOrgCandidate[] = [];

  for (const entry of value) {
    const row = (entry ?? {}) as Record<string, unknown>;

    if (typeof row.orgId !== 'number' || !Number.isInteger(row.orgId) || row.orgId <= 0) {
      continue;
    }

    list.push({
      orgId: row.orgId,
      name: typeof row.name === 'string' ? row.name : '',
      cnpj: typeof row.cnpj === 'string' && /^\d{14}$/.test(row.cnpj) ? row.cnpj : null,
      city: typeof row.city === 'string' && row.city.trim() !== '' ? row.city : null,
    });
  }

  return list;
}

function clientOut(client: { id: number; name: string; cnpj: string | null; city: string | null; pipedriveOrgId: number | null }) {
  return { id: client.id, name: client.name, cnpj: client.cnpj, city: client.city, pipedriveOrgId: client.pipedriveOrgId };
}

type OpenPending = {
  id: number;
  requestId: number;
  dealId: number;
  candidates: Prisma.JsonValue;
};

export class IndentPendingOrgService {
  static async list() {
    const where = { status: 'OPEN' as const };
    const [rows, total] = await Promise.all([
      prisma.indentPendingOrg.findMany({
        where,
        select: {
          id: true,
          requestId: true,
          dealId: true,
          candidates: true,
          createdAt: true,
          request: { select: { processNumber: true } },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: LIST_LIMIT,
      }),
      prisma.indentPendingOrg.count({ where }),
    ]);

    return {
      data: rows.map((row) => ({
        id: row.id,
        requestId: row.requestId,
        processNumber: row.request.processNumber,
        dealId: row.dealId,
        candidates: readCandidates(row.candidates),
        createdAt: row.createdAt,
      })),
      total,
    };
  }

  /** Cria o cliente (regra de fornecedores LIVRE) a partir da organizacao escolhida e liga a solicitacao, na mesma transacao. */
  static async createClient(id: number, input: PendingOrgCreateClientInput, user: IndentActor, now: Date = new Date()) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const pending = await IndentPendingOrgService.openForResolution(tx, id);
          const candidate = readCandidates(pending.candidates).find((entry) => entry.orgId === input.orgId);

          if (!candidate) {
            throw new HttpError(400, FOREIGN_ORG_MESSAGE);
          }

          const name = (input.name ?? candidate.name).trim().slice(0, 200);

          if (name === '') {
            throw new HttpError(400, 'Informe a razão social.');
          }

          // CNPJ da organizacao (ja validado na sincronizacao) tem prioridade; sem ele vale o digitado; sem os dois = "CNPJ pendente".
          const client = await IndentClientService.createInTx(
            tx,
            {
              name,
              cnpj: candidate.cnpj ?? input.cnpj ?? null,
              city: input.city ?? candidate.city ?? null,
              pipedriveOrgId: input.orgId,
            },
            user.id,
            { action: 'indent_client.created_from_pipedrive', metadata: { source: 'pipedrive', pendingOrgId: id, orgId: input.orgId } },
          );
          const resolved = await IndentPendingOrgService.resolve(tx, pending, client.id, input.orgId, user, 'create', now);

          return { client: clientOut(client), resolved };
        },
        { timeout: TX_TIMEOUT_MS },
      );
    } catch (error) {
      return IndentClientService.translateConflict(error);
    }
  }

  /** Liga a pendencia a um cliente ativo; grava a organizacao no cliente (se vazia e livre) e completa o CNPJ do cliente sem CNPJ (P5). */
  static async link(id: number, input: PendingOrgLinkInput, user: IndentActor, now: Date = new Date()) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const pending = await IndentPendingOrgService.openForResolution(tx, id);
          const candidates = readCandidates(pending.candidates);
          let orgId: number | null;

          if (input.orgId !== undefined) {
            if (!candidates.some((entry) => entry.orgId === input.orgId)) {
              throw new HttpError(400, FOREIGN_ORG_MESSAGE);
            }
            orgId = input.orgId;
          } else if (candidates.length === 0) {
            orgId = null; // negocio sem organizacao: so o cliente e ligado
          } else if (candidates.length === 1) {
            orgId = (candidates[0] as PendingOrgCandidate).orgId;
          } else {
            throw new HttpError(400, 'Escolha a organização deste negócio.');
          }

          const client = await tx.indentClient.findUnique({
            where: { id: input.clientId },
            select: { id: true, name: true, cnpj: true, city: true, pipedriveOrgId: true, isActive: true },
          });

          if (!client || !client.isActive) {
            throw new HttpError(400, 'Cliente inexistente ou inativo.');
          }

          const candidate = candidates.find((entry) => entry.orgId === orgId);
          const data: { pipedriveOrgId?: number; cnpj?: string } = {};

          if (orgId !== null) {
            if (client.pipedriveOrgId === null) {
              const holder = await tx.indentClient.findUnique({ where: { pipedriveOrgId: orgId }, select: { id: true } });

              if (holder && holder.id !== client.id) {
                throw new HttpError(409, 'Organização do Pipedrive já vinculada a outro cliente.');
              }
              data.pipedriveOrgId = orgId;
            } else if (client.pipedriveOrgId !== orgId) {
              throw new HttpError(409, 'O cliente já está vinculado a outra organização do Pipedrive.');
            }

            // P5: cliente sem CNPJ recebe o CNPJ valido da organizacao, se ninguem mais o usa.
            if (client.cnpj === null && candidate?.cnpj) {
              const used = await tx.indentClient.findFirst({ where: { cnpj: candidate.cnpj }, select: { id: true } });

              if (!used) {
                data.cnpj = candidate.cnpj;
              }
            }
          }

          let linked = client;

          if (Object.keys(data).length > 0) {
            linked = await tx.indentClient.update({
              where: { id: client.id },
              data,
              select: { id: true, name: true, cnpj: true, city: true, pipedriveOrgId: true, isActive: true },
            });

            if (data.pipedriveOrgId !== undefined) {
              await AuditLogService.log(
                {
                  entityType: 'indent_client',
                  entityId: client.id,
                  action: 'indent_client.pipedrive_org_linked',
                  performedById: user.id,
                  afterData: { pipedriveOrgId: data.pipedriveOrgId },
                  metadata: { source: 'pipedrive', pendingOrgId: id },
                },
                tx,
              );
            }
            if (data.cnpj !== undefined) {
              await AuditLogService.log(
                {
                  entityType: 'indent_client',
                  entityId: client.id,
                  action: 'indent_client.cnpj_from_pipedrive',
                  performedById: user.id,
                  afterData: { cnpjFilled: true },
                  metadata: { source: 'pipedrive', pendingOrgId: id, orgId },
                },
                tx,
              );
            }
          }

          const resolved = await IndentPendingOrgService.resolve(tx, pending, client.id, orgId, user, 'link', now);

          return { client: clientOut(linked), cnpjCompleted: data.cnpj !== undefined, resolved };
        },
        { timeout: TX_TIMEOUT_MS },
      );
    } catch (error) {
      return IndentClientService.translateConflict(error);
    }
  }

  /**
   * Resolucoes sao serializadas por uma trava advisory unica (acao manual e rara): duas pessoas resolvendo a mesma pendencia, ou
   * pendencias irmas (mesma organizacao), nunca se cruzam. Depois da trava le a pendencia de novo: resolvida -> 409.
   */
  private static async openForResolution(tx: Prisma.TransactionClient, id: number): Promise<OpenPending> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('indent_pending_orgs'))`;

    const pending = await tx.indentPendingOrg.findUnique({
      where: { id },
      select: {
        id: true,
        requestId: true,
        dealId: true,
        status: true,
        candidates: true,
        request: { select: { clientId: true } },
      },
    });

    if (!pending) {
      throw new HttpError(404, 'Pendência não encontrada.');
    }
    // Solicitacao que ja tem cliente nunca troca de cliente por esta fila.
    if (pending.status !== 'OPEN' || pending.request.clientId !== null) {
      throw new HttpError(409, ALREADY_RESOLVED_MESSAGE);
    }

    return { id: pending.id, requestId: pending.requestId, dealId: pending.dealId, candidates: pending.candidates };
  }

  /** Liga a solicitacao desta pendencia e as das ABERTAS cujo unico candidato e a mesma organizacao. */
  private static async resolve(
    tx: Prisma.TransactionClient,
    pending: OpenPending,
    clientId: number,
    orgId: number | null,
    user: IndentActor,
    kind: 'create' | 'link',
    now: Date,
  ): Promise<Array<{ id: number; requestId: number }>> {
    const targets: Array<{ id: number; requestId: number; propagated: boolean }> = [
      { id: pending.id, requestId: pending.requestId, propagated: false },
    ];

    if (orgId !== null) {
      const others = await tx.indentPendingOrg.findMany({
        where: { status: 'OPEN', id: { not: pending.id } },
        select: { id: true, requestId: true, candidates: true, request: { select: { clientId: true } } },
        orderBy: { id: 'asc' },
        take: PROPAGATION_LIMIT,
      });

      for (const other of others) {
        const candidates = readCandidates(other.candidates);

        if (candidates.length === 1 && candidates[0]?.orgId === orgId && other.request.clientId === null) {
          targets.push({ id: other.id, requestId: other.requestId, propagated: true });
        }
      }
    }

    for (const target of targets) {
      await tx.$queryRaw`SELECT id FROM "IndentRequest" WHERE id = ${target.requestId} FOR NO KEY UPDATE`;
      await tx.indentRequest.update({ where: { id: target.requestId }, data: { clientId } });
      await tx.indentPendingOrg.update({
        where: { id: target.id },
        data: { status: 'RESOLVED', resolvedClientId: clientId, resolvedOrgId: orgId, resolvedById: user.id, resolvedAt: now },
      });
      await AuditLogService.log(
        {
          entityType: ENTITY_TYPE,
          entityId: target.id,
          action: kind === 'create' ? 'indent_pending_org.resolved_create' : 'indent_pending_org.resolved_link',
          performedById: user.id,
          afterData: { clientId, orgId },
          metadata: { requestId: target.requestId, propagated: target.propagated },
        },
        tx,
      );
    }

    return targets.map((target) => ({ id: target.id, requestId: target.requestId }));
  }
}
