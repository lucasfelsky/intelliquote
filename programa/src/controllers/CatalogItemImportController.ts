import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import exceljs from 'exceljs';

const NCM_REGEX = /^\d{8}$/;

export class CatalogItemImportController {
  static async preview(req: Request, res: Response) {
    try {
      const { contentBase64 } = req.body;
      if (!contentBase64) {
        return res.status(400).json({ error: 'Faltou o campo contentBase64' });
      }

      const buffer = Buffer.from(contentBase64, 'base64');
      const workbook = new exceljs.Workbook();
      await workbook.xlsx.load(buffer as any);

      const worksheet = workbook.worksheets[0];
      if (!worksheet) {
        return res.status(400).json({ error: 'Nenhuma aba encontrada na planilha' });
      }

      const families = await prisma.itemFamily.findMany();
      const familyMap = new Map(families.map((f) => [f.name.toLowerCase(), f.id]));

      const validLines: any[] = [];
      const errorLines: any[] = [];

      let rowCount = 0;
      worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return; // skip header
        if (!row.hasValues) return; // skip empty rows
        if (rowCount >= 500) {
          if (rowCount === 500) {
            errorLines.push({ row: rowNumber, reason: 'Limite de 500 linhas excedido' });
          }
          rowCount++;
          return;
        }

        rowCount++;

        const commercialName = row.getCell(1).text?.trim();
        const marketName = row.getCell(2).text?.trim();
        let ncm = row.getCell(3).text?.replace(/\D/g, '').trim() || null;
        let dbcorpCode = row.getCell(4).text?.trim() || null;
        const familyName = row.getCell(5).text?.trim();
        const isDangerousGoodText = row.getCell(6).text?.trim().toLowerCase();
        const notes = row.getCell(7).text?.trim() || null;

        if (!commercialName || !marketName) {
          errorLines.push({ row: rowNumber, reason: 'Nome comercial e Nome de mercado são obrigatórios' });
          return;
        }

        if (ncm && !NCM_REGEX.test(ncm)) {
          errorLines.push({ row: rowNumber, reason: 'NCM deve ter 8 dígitos numéricos' });
          return;
        }

        if (dbcorpCode) {
          dbcorpCode = dbcorpCode.toUpperCase();
        }

        let familyId: number | null = null;
        if (familyName) {
          const match = familyMap.get(familyName.toLowerCase());
          if (match) {
            familyId = match;
          } else {
            errorLines.push({ row: rowNumber, reason: `Família "${familyName}" não encontrada` });
            return;
          }
        }

        const isDangerousGood = isDangerousGoodText === 'sim' || isDangerousGoodText === 'true';

        validLines.push({
          commercialName,
          marketName,
          ncm,
          dbcorpCode,
          familyId,
          isDangerousGood,
          notes,
        });
      });

      res.json({ data: { validLines, errorLines } });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  static async confirm(req: Request, res: Response) {
    try {
      const { items } = req.body;
      if (!Array.isArray(items)) {
        return res.status(400).json({ error: 'O campo items é obrigatório' });
      }

      const successLines: any[] = [];
      const errorLines: any[] = [];

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        try {
          await prisma.catalogItem.create({
            data: {
              commercialName: item.commercialName,
              marketName: item.marketName,
              ncm: item.ncm,
              dbcorpCode: item.dbcorpCode,
              isDangerousGood: item.isDangerousGood,
              familyId: item.familyId,
              notes: item.notes,
              isActive: true,
            }
          });
          successLines.push({ row: i + 2, commercialName: item.commercialName });
        } catch (error: any) {
          if (error.code === 'P2002' && error.meta?.target?.includes('marketName')) {
            errorLines.push({ row: i + 2, reason: 'Já existe um item de catálogo com o Nome de Mercado fornecido.' });
          } else {
            errorLines.push({ row: i + 2, reason: error.message });
          }
        }
      }

      res.json({ data: { successLines, errorLines } });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
}
