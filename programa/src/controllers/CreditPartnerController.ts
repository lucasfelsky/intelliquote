import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AuditLogService } from '../services/AuditLogService';
import {
  creditPartnerCreateSchema,
  creditPartnerListQuerySchema,
  creditPartnerUpdateSchema,
} from '../validators/domain';
import { handleControllerError, HttpError, parseId } from '../utils/http';

const ENTITY_TYPE = 'credit_partner';

const creditPartnerInclude = {
  contacts: {
    orderBy: [{ isPrimary: 'desc' as const }, { id: 'asc' as const }],
  },
} satisfies Prisma.CreditPartnerInclude;

type CreditPartnerWithContacts = Prisma.CreditPartnerGetPayload<{
  include: typeof creditPartnerInclude;
}>;

interface NormalizedContact {
  id?: number;
  name: string;
  email: string;
  phone: string | null;
  position: string | null;
  isPrimary: boolean;
}

// Shape publico do CRUD: sem createdById/deletedAt e sem timestamps dos contatos.
function serializeCreditPartner(partner: CreditPartnerWithContacts) {
  return {
    id: partner.id,
    name: partner.name,
    taxId: partner.taxId,
    website: partner.website,
    country: partner.country,
    notes: partner.notes,
    isActive: partner.isActive,
    createdAt: partner.createdAt,
    updatedAt: partner.updatedAt,
    contacts: partner.contacts.map((contact) => ({
      id: contact.id,
      name: contact.name,
      email: contact.email,
      phone: contact.phone,
      position: contact.position,
      isPrimary: contact.isPrimary,
    })),
  };
}

// Garante exatamente 1 contato principal: se nenhum veio marcado, o 1o vira principal.
function normalizeContacts(
  contacts: ReadonlyArray<{
    id?: number;
    name: string;
    email: string;
    phone?: string | null;
    position?: string | null;
    isPrimary?: boolean;
  }>,
): NormalizedContact[] {
  const hasPrimary = contacts.some((contact) => contact.isPrimary === true);
  return contacts.map((contact, index) => ({
    id: contact.id,
    name: contact.name,
    email: contact.email,
    phone: contact.phone ?? null,
    position: contact.position ?? null,
    isPrimary: hasPrimary ? contact.isPrimary === true : index === 0,
  }));
}

async function assertNameAvailable(
  tx: Prisma.TransactionClient,
  name: string,
  excludeId?: number,
): Promise<void> {
  // Serializa check-and-write por nome (mesmo padrao do import de fornecedores): sem isso dois
  // POST/PUT concorrentes passam pelo findFirst antes de qualquer escrita e gravam duplicados.
  // Indice unico parcial/case-insensitive nao e representavel no schema Prisma (geraria drift).
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`credit_partner:${name.trim().toLowerCase()}`}))`;
  const duplicate = await tx.creditPartner.findFirst({
    where: {
      deletedAt: null,
      name: { equals: name, mode: 'insensitive' },
      ...(excludeId !== undefined ? { id: { not: excludeId } } : {}),
    },
    select: { id: true },
  });

  if (duplicate) {
    throw new HttpError(409, 'Ja existe um parceiro de credito com esse nome.');
  }
}

export class CreditPartnerController {
  static async list(req: Request, res: Response): Promise<Response> {
    try {
      const query = creditPartnerListQuerySchema.parse({
        active: typeof req.query.active === 'string' ? req.query.active : undefined,
      });

      const partners = await prisma.creditPartner.findMany({
        where: {
          deletedAt: null,
          ...(query.active !== undefined ? { isActive: query.active === 'true' } : {}),
        },
        orderBy: { name: 'asc' },
        include: creditPartnerInclude,
      });

      return res.status(200).json(partners.map(serializeCreditPartner));
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async create(req: Request, res: Response): Promise<Response> {
    try {
      const payload = creditPartnerCreateSchema.parse(req.body);
      const contacts = normalizeContacts(payload.contacts);

      const created = await prisma.$transaction(async (tx) => {
        await assertNameAvailable(tx, payload.name);

        const partner = await tx.creditPartner.create({
          data: {
            name: payload.name,
            taxId: payload.taxId ?? null,
            website: payload.website ?? null,
            country: payload.country ?? null,
            notes: payload.notes ?? null,
            isActive: payload.isActive ?? true,
            createdById: req.user?.id ?? null,
            contacts: {
              create: contacts.map((contact) => ({
                name: contact.name,
                email: contact.email,
                phone: contact.phone,
                position: contact.position,
                isPrimary: contact.isPrimary,
              })),
            },
          },
          include: creditPartnerInclude,
        });

        await AuditLogService.log(
          {
            entityType: ENTITY_TYPE,
            entityId: partner.id,
            action: 'create',
            performedById: req.user?.id ?? null,
            afterData: serializeCreditPartner(partner),
          },
          tx,
        );

        return partner;
      });

      return res.status(201).json(serializeCreditPartner(created));
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async update(req: Request, res: Response): Promise<Response> {
    try {
      const id = parseId(req.params.id);

      if (!id) {
        return res.status(400).json({ message: 'ID do parceiro de credito invalido.' });
      }

      const payload = creditPartnerUpdateSchema.parse(req.body);

      const updated = await prisma.$transaction(async (tx) => {
        const before = await tx.creditPartner.findFirst({
          where: { id, deletedAt: null },
          include: creditPartnerInclude,
        });

        if (!before) {
          throw new HttpError(404, 'Parceiro de credito nao encontrado.');
        }

        if (payload.name !== undefined && payload.name.toLowerCase() !== before.name.toLowerCase()) {
          await assertNameAvailable(tx, payload.name, id);
        }

        if (payload.contacts !== undefined) {
          const contacts = normalizeContacts(payload.contacts);
          const ownedIds = new Set(before.contacts.map((contact) => contact.id));
          const keptIds = new Set<number>();

          for (const contact of contacts) {
            if (contact.id === undefined) {
              continue;
            }
            if (!ownedIds.has(contact.id) || keptIds.has(contact.id)) {
              throw new HttpError(400, 'Contato nao pertence a este parceiro de credito.');
            }
            keptIds.add(contact.id);
          }

          await tx.creditPartnerContact.deleteMany({
            where: {
              creditPartnerId: id,
              id: { notIn: Array.from(keptIds) },
            },
          });

          for (const contact of contacts) {
            const data = {
              name: contact.name,
              email: contact.email,
              phone: contact.phone,
              position: contact.position,
              isPrimary: contact.isPrimary,
            };

            if (contact.id !== undefined) {
              await tx.creditPartnerContact.update({ where: { id: contact.id }, data });
            } else {
              await tx.creditPartnerContact.create({ data: { ...data, creditPartnerId: id } });
            }
          }
        }

        const partner = await tx.creditPartner.update({
          where: { id },
          data: {
            ...(payload.name !== undefined ? { name: payload.name } : {}),
            ...(payload.taxId !== undefined ? { taxId: payload.taxId } : {}),
            ...(payload.website !== undefined ? { website: payload.website } : {}),
            ...(payload.country !== undefined ? { country: payload.country } : {}),
            ...(payload.notes !== undefined ? { notes: payload.notes } : {}),
            ...(payload.isActive !== undefined ? { isActive: payload.isActive } : {}),
          },
          include: creditPartnerInclude,
        });

        await AuditLogService.log(
          {
            entityType: ENTITY_TYPE,
            entityId: id,
            action: 'update',
            performedById: req.user?.id ?? null,
            beforeData: serializeCreditPartner(before),
            afterData: serializeCreditPartner(partner),
          },
          tx,
        );

        return partner;
      });

      return res.status(200).json(serializeCreditPartner(updated));
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async remove(req: Request, res: Response): Promise<Response> {
    try {
      const id = parseId(req.params.id);

      if (!id) {
        return res.status(400).json({ message: 'ID do parceiro de credito invalido.' });
      }

      await prisma.$transaction(async (tx) => {
        const before = await tx.creditPartner.findFirst({
          where: { id, deletedAt: null },
          include: creditPartnerInclude,
        });

        if (!before) {
          throw new HttpError(404, 'Parceiro de credito nao encontrado.');
        }

        const now = new Date();
        const deleted = await tx.creditPartner.update({
          where: { id },
          data: { deletedAt: now, isActive: false },
          include: creditPartnerInclude,
        });

        // Credit Support: excluir o parceiro revoga os encaminhamentos ativos (links deixam de abrir).
        const revoked = await tx.creditSupportRequest.updateMany({
          where: { creditPartnerId: id, revokedAt: null },
          data: { revokedAt: now },
        });

        await AuditLogService.log(
          {
            entityType: ENTITY_TYPE,
            entityId: id,
            action: 'delete',
            performedById: req.user?.id ?? null,
            beforeData: serializeCreditPartner(before),
            afterData: { ...serializeCreditPartner(deleted), deletedAt: deleted.deletedAt },
            metadata: { revokedCreditSupportRequests: revoked.count },
          },
          tx,
        );
      });

      return res.status(200).json({ id });
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }
}
