import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { buildPaginatedResponse, HttpError } from '../utils/http';
import { normalizeCnpj } from '../utils/cnpj';
import { normalizeItemNameKey } from '../utils/commercialItemName';
import type {
  IndentClientCreateInput,
  IndentClientListQuery,
  IndentClientRuleInput,
  IndentClientUpdateInput,
} from '../validators/indent';
import { AuditLogService } from './AuditLogService';

const ENTITY_TYPE = 'indent_client';

const clientInclude = {
  supplierRules: {
    select: { supplierId: true, supplier: { select: { name: true } } },
    orderBy: { supplier: { name: 'asc' as const } },
  },
} satisfies Prisma.IndentClientInclude;

type ClientRow = Prisma.IndentClientGetPayload<{ include: typeof clientInclude }>;

function ruleSnapshot(client: {
  supplierRuleMode: string;
  ruleReason: string | null;
  supplierRules: Array<{ supplierId: number }>;
}) {
  return {
    mode: client.supplierRuleMode,
    supplierIds: client.supplierRules.map((rule) => rule.supplierId).sort((a, b) => a - b),
    reason: client.ruleReason,
  };
}

function clientSnapshot(client: ClientRow) {
  return {
    id: client.id,
    name: client.name,
    cnpj: client.cnpj,
    city: client.city,
    ownerName: client.ownerName,
    pipedriveOrgId: client.pipedriveOrgId,
    isActive: client.isActive,
    ...ruleSnapshot(client),
  };
}

function uniqueTarget(error: unknown): string | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return null;
  }

  const target = (error.meta as { target?: unknown } | undefined)?.target;
  if (Array.isArray(target)) {
    return target.join(',');
  }
  return typeof target === 'string' ? target : '';
}

function translateConflict(error: unknown): never {
  const target = uniqueTarget(error);

  if (target === null) {
    throw error;
  }
  if (target.includes('pipedriveOrgId')) {
    throw new HttpError(409, 'Organização do Pipedrive já vinculada a outro cliente.');
  }
  if (target.includes('cnpj')) {
    throw new HttpError(409, 'Já existe um cliente com este CNPJ.');
  }

  throw error;
}

export class IndentClientService {
  static async list(query: IndentClientListQuery) {
    const digits = query.q ? normalizeCnpj(query.q) : '';
    const scope: Prisma.IndentClientWhereInput = query.inativos ? {} : { isActive: true };
    const where: Prisma.IndentClientWhereInput = {
      ...scope,
      ...(query.semCnpj ? { cnpj: null } : {}),
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' } },
              { city: { contains: query.q, mode: 'insensitive' } },
              ...(digits ? [{ cnpj: { contains: digits } }] : []),
            ],
          }
        : {}),
    };
    const pagination = {
      page: query.page,
      pageSize: query.pageSize,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    };

    // Contagens dos chips (Todos / Sem CNPJ): respeitam "inativos", ignoram busca e chip ativo.
    const [rows, total, todos, semCnpj] = await Promise.all([
      prisma.indentClient.findMany({
        where,
        include: clientInclude,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: pagination.skip,
        take: pagination.take,
      }),
      prisma.indentClient.count({ where }),
      prisma.indentClient.count({ where: scope }),
      prisma.indentClient.count({ where: { ...scope, cnpj: null } }),
    ]);

    return { ...buildPaginatedResponse(rows, total, pagination), counts: { todos, semCnpj } };
  }

  static async create(input: IndentClientCreateInput, userId: number | null) {
    try {
      return await prisma.$transaction(async (tx) => {
        const cnpj = input.cnpj ?? null;

        // Sem CNPJ nao ha indice que barre duplicidade: confere o mesmo nome (sem acento/caixa) entre os sem CNPJ.
        if (cnpj === null) {
          const key = normalizeItemNameKey(input.name);
          const semCnpj = await tx.indentClient.findMany({ where: { cnpj: null }, select: { name: true } });

          if (semCnpj.some((other) => normalizeItemNameKey(other.name) === key)) {
            throw new HttpError(409, 'Já existe um cliente sem CNPJ com este nome.');
          }
        }

        const created = await tx.indentClient.create({
          data: {
            name: input.name,
            cnpj,
            city: input.city ?? null,
            ownerName: input.ownerName ?? null,
            pipedriveOrgId: input.pipedriveOrgId ?? null,
          },
          include: clientInclude,
        });

        await AuditLogService.log(
          {
            entityType: ENTITY_TYPE,
            entityId: created.id,
            action: 'indent_client.created',
            performedById: userId,
            afterData: clientSnapshot(created),
          },
          tx,
        );

        return created;
      });
    } catch (error) {
      return translateConflict(error);
    }
  }

  static async update(id: number, input: IndentClientUpdateInput, userId: number | null) {
    try {
      return await prisma.$transaction(async (tx) => {
        const before = await tx.indentClient.findUnique({ where: { id }, include: clientInclude });

        if (!before) {
          throw new HttpError(404, 'Cliente não encontrado.');
        }

        // CNPJ gravado nao pode ser removido; completar (null -> valor) e trocar por outro valido seguem permitidos.
        if (input.cnpj === null && before.cnpj !== null) {
          throw new HttpError(400, 'O CNPJ não pode ser removido.');
        }

        const updated = await tx.indentClient.update({
          where: { id },
          data: {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.cnpj ? { cnpj: input.cnpj } : {}),
            ...(input.city !== undefined ? { city: input.city } : {}),
            ...(input.ownerName !== undefined ? { ownerName: input.ownerName } : {}),
            ...(input.pipedriveOrgId !== undefined ? { pipedriveOrgId: input.pipedriveOrgId } : {}),
            ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          },
          include: clientInclude,
        });

        await AuditLogService.log(
          {
            entityType: ENTITY_TYPE,
            entityId: id,
            action: 'indent_client.updated',
            performedById: userId,
            beforeData: clientSnapshot(before),
            afterData: clientSnapshot(updated),
          },
          tx,
        );

        return updated;
      });
    } catch (error) {
      return translateConflict(error);
    }
  }

  // Regra de restricao de fornecedores: o conjunto inteiro e substituido (deleteMany + createMany).
  // LIVRE zera a lista e o motivo. Fornecedor inexistente na lista -> 400 sem gravar nada.
  static async setSupplierRule(id: number, input: IndentClientRuleInput, userId: number | null) {
    return prisma.$transaction(async (tx) => {
      const before = await tx.indentClient.findUnique({ where: { id }, include: clientInclude });

      if (!before) {
        throw new HttpError(404, 'Cliente não encontrado.');
      }

      const restricted = input.mode !== 'LIVRE';

      if (restricted) {
        const existing = await tx.indentSupplier.count({
          where: { id: { in: input.supplierIds } },
        });

        if (existing !== input.supplierIds.length) {
          throw new HttpError(400, 'Fornecedor inexistente na lista.');
        }
      }

      await tx.indentClientSupplierRule.deleteMany({ where: { clientId: id } });

      if (restricted) {
        await tx.indentClientSupplierRule.createMany({
          data: input.supplierIds.map((supplierId) => ({ clientId: id, supplierId })),
        });
      }

      const updated = await tx.indentClient.update({
        where: { id },
        data: {
          supplierRuleMode: input.mode,
          ruleReason: restricted ? (input.reason ?? '').trim() : null,
        },
        include: clientInclude,
      });

      await AuditLogService.log(
        {
          entityType: ENTITY_TYPE,
          entityId: id,
          action: 'indent_client.rule_updated',
          performedById: userId,
          beforeData: ruleSnapshot(before),
          afterData: ruleSnapshot(updated),
        },
        tx,
      );

      return updated;
    });
  }
}
