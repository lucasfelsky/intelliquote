import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

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
      const { name } = req.body;
      if (!name) {
        return res.status(400).json({ error: 'O nome da família é obrigatório.' });
      }

      const existing = await prisma.itemFamily.findUnique({
        where: { name }
      });

      if (existing) {
        return res.status(400).json({ error: 'Família já existe com esse nome.' });
      }

      const family = await prisma.itemFamily.create({
        data: { name }
      });

      res.status(201).json({ data: family });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
}
