import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { buildPaginatedResponse, HttpError } from '../utils/http';
import { normalizeCnpj } from '../utils/cnpj';
import type {
  IndentClientCreateInput,
  IndentClientRuleInput,
  IndentClientUpdateInput,
  IndentListQuery,
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
  static async list(query: IndentListQuery) {
    const digits = query.q ? normalizeCnpj(query.q) : '';
    const where: Prisma.IndentClientWhereInput = {
      ...(query.inativos ? {} : { isActive: true }),
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

    const [rows, total] = await Promise.all([
      prisma.indentClient.findMany({
        where,
        include: clientInclude,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: pagination.skip,
        take: pagination.take,
      }),
      prisma.indentClient.count({ where }),
    ]);

    return buildPaginatedResponse(rows, total, pagination);
  }

  static async create(input: IndentClientCreateInput, userId: number | null) {
    try {
      return await prisma.$transaction(async (tx) => {
        const created = await tx.indentClient.create({
          data: {
            name: input.name,
            cnpj: input.cnpj,
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

        const updated = await tx.indentClient.update({
          where: { id },
          data: {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.cnpj !== undefined ? { cnpj: input.cnpj } : {}),
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
