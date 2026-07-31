import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { z } from 'zod';

const createFamilySchema = z.object({
  name: z.string().trim().min(1, 'O nome da família é obrigatório.'),
});

export class ItemFamilyController {
  static async listFamilies(req: Request, res: Response) {
    try {
      const families = await prisma.itemFamily.findMany({
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
}
