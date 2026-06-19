import { Prisma } from '@prisma/client';
import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { AuditLogService } from '../services/AuditLogService';
import {
  supplierContactCreateSchema,
  supplierContactUpdateSchema,
} from '../validators/domain';
import {
  handleControllerError,
  HttpError,
  parseId,
  parseOptionalQueryId,
} from '../utils/http';

export class SupplierContactController {
  static async list(req: Request, res: Response): Promise<Response> {
    try {
      const supplierIdFromRoute = parseId(req.params.supplierId);
      const supplierId = supplierIdFromRoute ?? parseOptionalQueryId(req.query.supplierId);
      const where: Prisma.SupplierContactWhereInput = {};
      if (supplierId) {
        where.supplierId = supplierId;
      }

        // Modo bulk: GET /api/v1/supplier-contacts?supplierIds=1,2,3
        // Retorna todos os contatos dos fornecedores listados, agrupados por supplierId.
        // Usado pela listagem de fornecedores para descobrir o "contato principal" sem
        // precisar fazer N requests (um por fornecedor).
        const bulkIdsRaw = req.query.supplierIds;
        if (typeof bulkIdsRaw === 'string' && bulkIdsRaw.trim().length > 0) {
          const supplierIds = bulkIdsRaw
            .split(',')
            .map((value) => Number(value.trim()))
            .filter((value) => Number.isInteger(value) && value > 0);

          if (supplierIds.length === 0) {
            return res.status(200).json({ bySupplier: {} });
          }

          const contacts = await prisma.supplierContact.findMany({
            where: { supplierId: { in: supplierIds } },
            orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }],
          });

          const bySupplier: Record<string, typeof contacts> = {};
          for (const contact of contacts) {
            const key = String(contact.supplierId);
            if (!bySupplier[key]) bySupplier[key] = [];
            bySupplier[key].push(contact);
          }
          return res.status(200).json({ bySupplier });
        }

        const contacts = await prisma.supplierContact.findMany({
          where,
          orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }],
        });
        return res.status(200).json(contacts);
      } catch (error) {
        const handled = handleControllerError(error);
        return res.status(handled.status).json({ message: handled.message });
      }
    }

  static async create(req: Request, res: Response): Promise<Response> {
    try {
      const parsed = supplierContactCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          message: 'Informe name, email e supplierId validos para o contato.',
        });
      }

      const payload = parsed.data;
      const supplierIdFromRoute = parseId(req.params.supplierId);
      const effectiveSupplierId = supplierIdFromRoute ?? payload.supplierId;

      if (!effectiveSupplierId) {
        return res
          .status(400)
          .json({ message: 'Informe name, email e supplierId validos para o contato.' });
      }

      const supplier = await prisma.supplier.findUnique({
        where: { id: effectiveSupplierId },
      });
      if (!supplier) {
        return res.status(404).json({ message: 'Fornecedor nao encontrado para o contato.' });
      }

      if (payload.isPrimary) {
        await prisma.supplierContact.updateMany({
          where: { supplierId: effectiveSupplierId, isPrimary: true },
          data: { isPrimary: false },
        });
      }

      const contact = await prisma.supplierContact.create({
        data: {
          supplierId: effectiveSupplierId,
          name: payload.name,
          email: payload.email,
          phone: payload.phone ?? null,
          position: payload.position ?? null,
          isPrimary: payload.isPrimary ?? false,
        },
      });

      await AuditLogService.log({
        entityType: 'supplier_contact',
        entityId: contact.id,
        action: 'create',
        performedById: req.user?.id ?? null,
        afterData: contact,
        metadata: { supplierId: effectiveSupplierId },
      });

      return res.status(201).json(contact);
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async update(req: Request, res: Response): Promise<Response> {
    try {
      const id = parseId(req.params.id);
      if (!id) {
        return res.status(400).json({ message: 'ID do contato invalido.' });
      }

      const parsed = supplierContactUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          message: 'Os dados enviados para atualizar o contato sao invalidos.',
        });
      }

      const payload = parsed.data;
      const existing = await prisma.supplierContact.findUnique({ where: { id } });
      if (!existing) {
        return res.status(404).json({ message: 'Contato nao encontrado.' });
      }

      if (payload.isPrimary === true) {
        await prisma.supplierContact.updateMany({
          where: {
            supplierId: existing.supplierId,
            isPrimary: true,
            id: { not: id },
          },
          data: { isPrimary: false },
        });
      }

      const updated = await prisma.supplierContact.update({
        where: { id },
        data: {
          name: payload.name,
          email: payload.email,
          phone: payload.phone,
          position: payload.position,
          isPrimary: payload.isPrimary,
        },
      });

      await AuditLogService.log({
        entityType: 'supplier_contact',
        entityId: updated.id,
        action: 'update',
        performedById: req.user?.id ?? null,
        beforeData: existing,
        afterData: updated,
        metadata: { supplierId: existing.supplierId },
      });

      return res.status(200).json(updated);
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async delete(req: Request, res: Response): Promise<Response> {
    try {
      const id = parseId(req.params.id);
      if (!id) {
        return res.status(400).json({ message: 'ID do contato invalido.' });
      }

      const existing = await prisma.supplierContact.findUnique({ where: { id } });
      if (!existing) {
        return res.status(404).json({ message: 'Contato nao encontrado.' });
      }

      await prisma.supplierContact.delete({ where: { id } });

      await AuditLogService.log({
        entityType: 'supplier_contact',
        entityId: existing.id,
        action: 'delete',
        performedById: req.user?.id ?? null,
        beforeData: existing,
        afterData: null,
        metadata: { supplierId: existing.supplierId },
      });

      return res.status(204).send();
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }
}
