import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AuditLogService } from '../services/AuditLogService';
import {
  forwarderCreateSchema,
  forwarderListQuerySchema,
  forwarderUpdateSchema,
} from '../validators/domain';
import { handleControllerError, HttpError, parseId } from '../utils/http';

const ENTITY_TYPE = 'forwarder';

const forwarderInclude = {
  contacts: {
    orderBy: { id: 'asc' as const },
  },
} satisfies Prisma.ForwarderInclude;

type ForwarderWithContacts = Prisma.ForwarderGetPayload<{
  include: typeof forwarderInclude;
}>;

interface NormalizedContact {
  id?: number;
  name: string;
  email: string | null;
  phone: string | null;
}

// Shape publico do CRUD: sem createdById/deletedAt e sem timestamps dos contatos.
function serializeForwarder(forwarder: ForwarderWithContacts) {
  return {
    id: forwarder.id,
    companyName: forwarder.companyName,
    address: forwarder.address,
    website: forwarder.website,
    notes: forwarder.notes,
    isActive: forwarder.isActive,
    isDefault: forwarder.isDefault,
    createdAt: forwarder.createdAt,
    updatedAt: forwarder.updatedAt,
    contacts: forwarder.contacts.map((contact) => ({
      id: contact.id,
      name: contact.name,
      email: contact.email,
      phone: contact.phone,
    })),
  };
}

function normalizeContacts(
  contacts: ReadonlyArray<{
    id?: number;
    name: string;
    email?: string | null;
    phone?: string | null;
  }>,
): NormalizedContact[] {
  return contacts.map((contact) => ({
    id: contact.id,
    name: contact.name,
    email: contact.email ?? null,
    phone: contact.phone ?? null,
  }));
}

// UM unico lock para TODA escrita de forwarder (create/update/delete), sempre o PRIMEIRO
// statement da transacao. Serializa o check-and-write do nome e o "no maximo um padrao"
// (sem indice unico parcial: nao e representavel no schema Prisma e geraria drift). Um lock
// so, em vez de um por nome + um do padrao, elimina deadlock por ordem de aquisicao; o
// volume de escrita deste cadastro e irrisorio.
async function lockForwarderWrites(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'forwarder:write'}))`;
}

async function assertNameAvailable(
  tx: Prisma.TransactionClient,
  companyName: string,
  excludeId?: number,
): Promise<void> {
  const duplicate = await tx.forwarder.findFirst({
    where: {
      deletedAt: null,
      companyName: { equals: companyName, mode: 'insensitive' },
      ...(excludeId !== undefined ? { id: { not: excludeId } } : {}),
    },
    select: { id: true },
  });

  if (duplicate) {
    throw new HttpError(409, 'Ja existe um forwarder com esse nome.');
  }
}

// Remove a marca de padrao de qualquer OUTRO forwarder (chamado dentro do lock) e audita cada um.
async function unsetOtherDefaults(
  tx: Prisma.TransactionClient,
  newDefaultId: number,
  performedById: number | null,
): Promise<void> {
  const previous = await tx.forwarder.findMany({
    where: { isDefault: true, deletedAt: null, id: { not: newDefaultId } },
    select: { id: true },
  });

  if (previous.length === 0) {
    return;
  }

  await tx.forwarder.updateMany({
    where: { isDefault: true, deletedAt: null, id: { not: newDefaultId } },
    data: { isDefault: false },
  });

  for (const item of previous) {
    await AuditLogService.log(
      {
        entityType: ENTITY_TYPE,
        entityId: item.id,
        action: 'unset_default',
        performedById,
        beforeData: { isDefault: true },
        afterData: { isDefault: false },
        metadata: { replacedByForwarderId: newDefaultId },
      },
      tx,
    );
  }
}

export class ForwarderController {
  static async list(req: Request, res: Response): Promise<Response> {
    try {
      const query = forwarderListQuerySchema.parse({
        active: typeof req.query.active === 'string' ? req.query.active : undefined,
      });

      const forwarders = await prisma.forwarder.findMany({
        where: {
          deletedAt: null,
          ...(query.active !== undefined ? { isActive: query.active === 'true' } : {}),
        },
        orderBy: [{ isDefault: 'desc' }, { companyName: 'asc' }],
        include: forwarderInclude,
      });

      return res.status(200).json(forwarders.map(serializeForwarder));
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async create(req: Request, res: Response): Promise<Response> {
    try {
      const payload = forwarderCreateSchema.parse(req.body);
      const contacts = normalizeContacts(payload.contacts);
      const performedById = req.user?.id ?? null;

      const created = await prisma.$transaction(async (tx) => {
        await lockForwarderWrites(tx);
        await assertNameAvailable(tx, payload.companyName);

        const forwarder = await tx.forwarder.create({
          data: {
            companyName: payload.companyName,
            address: payload.address ?? null,
            website: payload.website ?? null,
            notes: payload.notes ?? null,
            isActive: payload.isActive ?? true,
            isDefault: payload.isDefault === true,
            createdById: performedById,
            contacts: {
              create: contacts.map((contact) => ({
                name: contact.name,
                email: contact.email,
                phone: contact.phone,
              })),
            },
          },
          include: forwarderInclude,
        });

        if (forwarder.isDefault) {
          await unsetOtherDefaults(tx, forwarder.id, performedById);
        }

        await AuditLogService.log(
          {
            entityType: ENTITY_TYPE,
            entityId: forwarder.id,
            action: 'create',
            performedById,
            afterData: serializeForwarder(forwarder),
          },
          tx,
        );

        return forwarder;
      });

      return res.status(201).json(serializeForwarder(created));
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async update(req: Request, res: Response): Promise<Response> {
    try {
      const id = parseId(req.params.id);

      if (!id) {
        return res.status(400).json({ message: 'ID do forwarder invalido.' });
      }

      const payload = forwarderUpdateSchema.parse(req.body);
      const performedById = req.user?.id ?? null;

      const updated = await prisma.$transaction(async (tx) => {
        await lockForwarderWrites(tx);

        const before = await tx.forwarder.findFirst({
          where: { id, deletedAt: null },
          include: forwarderInclude,
        });

        if (!before) {
          throw new HttpError(404, 'Forwarder nao encontrado.');
        }

        if (
          payload.companyName !== undefined &&
          payload.companyName.toLowerCase() !== before.companyName.toLowerCase()
        ) {
          await assertNameAvailable(tx, payload.companyName, id);
        }

        // Estado final do padrao: o que veio no payload; sem isso, inativar zera o padrao.
        const finalIsActive = payload.isActive ?? before.isActive;
        const finalIsDefault =
          payload.isDefault !== undefined
            ? payload.isDefault
            : finalIsActive
              ? before.isDefault
              : false;

        if (finalIsDefault && !finalIsActive) {
          throw new HttpError(400, 'Forwarder inativo nao pode ser o padrao.');
        }

        if (finalIsDefault) {
          await unsetOtherDefaults(tx, id, performedById);
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
              throw new HttpError(400, 'Contato nao pertence a este forwarder.');
            }
            keptIds.add(contact.id);
          }

          await tx.forwarderContact.deleteMany({
            where: {
              forwarderId: id,
              id: { notIn: Array.from(keptIds) },
            },
          });

          for (const contact of contacts) {
            const data = {
              name: contact.name,
              email: contact.email,
              phone: contact.phone,
            };

            if (contact.id !== undefined) {
              await tx.forwarderContact.update({ where: { id: contact.id }, data });
            } else {
              await tx.forwarderContact.create({ data: { ...data, forwarderId: id } });
            }
          }
        }

        const forwarder = await tx.forwarder.update({
          where: { id },
          data: {
            ...(payload.companyName !== undefined ? { companyName: payload.companyName } : {}),
            ...(payload.address !== undefined ? { address: payload.address } : {}),
            ...(payload.website !== undefined ? { website: payload.website } : {}),
            ...(payload.notes !== undefined ? { notes: payload.notes } : {}),
            ...(payload.isActive !== undefined ? { isActive: payload.isActive } : {}),
            isDefault: finalIsDefault,
          },
          include: forwarderInclude,
        });

        await AuditLogService.log(
          {
            entityType: ENTITY_TYPE,
            entityId: id,
            action: 'update',
            performedById,
            beforeData: serializeForwarder(before),
            afterData: serializeForwarder(forwarder),
          },
          tx,
        );

        return forwarder;
      });

      return res.status(200).json(serializeForwarder(updated));
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async remove(req: Request, res: Response): Promise<Response> {
    try {
      const id = parseId(req.params.id);

      if (!id) {
        return res.status(400).json({ message: 'ID do forwarder invalido.' });
      }

      await prisma.$transaction(async (tx) => {
        await lockForwarderWrites(tx);

        const before = await tx.forwarder.findFirst({
          where: { id, deletedAt: null },
          include: forwarderInclude,
        });

        if (!before) {
          throw new HttpError(404, 'Forwarder nao encontrado.');
        }

        const deleted = await tx.forwarder.update({
          where: { id },
          data: { deletedAt: new Date(), isActive: false, isDefault: false },
          include: forwarderInclude,
        });

        await AuditLogService.log(
          {
            entityType: ENTITY_TYPE,
            entityId: id,
            action: 'delete',
            performedById: req.user?.id ?? null,
            beforeData: serializeForwarder(before),
            afterData: { ...serializeForwarder(deleted), deletedAt: deleted.deletedAt },
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
