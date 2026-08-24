import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { z } from 'zod';
import { AuditLogService } from '../services/AuditLogService';
import { handleControllerError, parseId } from '../utils/http';

const createFamilySchema = z.object({
  name: z.string().trim().min(1, 'O nome da família é obrigatório.'),
});

const updateFamilySchema = z
  .object({
    name: z.string().trim().min(1, 'O nome da família é obrigatório.').optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => v.name !== undefined || v.isActive !== undefined, {
    message: 'Informe ao menos um campo para atualizar.',
  });

export class ItemFamilyController {
  static async listFamilies(req: Request, res: Response) {
    try {
      const includeInactive = req.query.includeInactive === 'true';
      const where: Record<string, unknown> = {};
      if (!includeInactive) {
        where.isActive = true;
      }
      const families = await prisma.itemFamily.findMany({
        where,
        orderBy: { name: 'asc' }
      });
      res.json({ data: families });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  static async createFamily(req: Request, res: Response) {
    try {
      const parsed = createFamilySchema.parse(req.body);

      const existing = await prisma.itemFamily.findFirst({
        where: { name: { equals: parsed.name, mode: 'insensitive' } }
      });

      if (existing) {
        return res.status(400).json({ error: 'Família já existe com esse nome.' });
      }

      const family = await prisma.itemFamily.create({
        data: { name: parsed.name }
      });

      res.status(201).json({ data: family });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.issues[0].message });
      }
      res.status(500).json({ error: error.message });
    }
  }

  static async updateFamily(req: Request, res: Response) {
    try {
      const id = parseId(req.params.id);

      if (!id) {
        return res.status(400).json({ message: 'ID da familia invalido.' });
      }

      const parsed = updateFamilySchema.parse(req.body);

      const existing = await prisma.itemFamily.findUnique({ where: { id } });

      if (!existing) {
        return res.status(404).json({ message: 'Familia nao encontrada.' });
      }

      if (parsed.name !== undefined) {
        const clash = await prisma.itemFamily.findFirst({
          where: { name: { equals: parsed.name, mode: 'insensitive' }, id: { not: id } },
        });

        if (clash) {
          return res.status(400).json({ message: 'Família já existe com esse nome.' });
        }
      }

      const data: { name?: string; isActive?: boolean } = {};
      if (parsed.name !== undefined) data.name = parsed.name;
      if (parsed.isActive !== undefined) data.isActive = parsed.isActive;

      const family = await prisma.itemFamily.update({
        where: { id },
        data,
      });

      await AuditLogService.log({
        entityType: 'item_family',
        entityId: family.id,
        action: 'update',
        performedById: req.user?.id ?? null,
        beforeData: { id: existing.id, name: existing.name, isActive: existing.isActive },
        afterData: { id: family.id, name: family.name, isActive: family.isActive },
      });

      return res.json({ data: family });
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }
}
