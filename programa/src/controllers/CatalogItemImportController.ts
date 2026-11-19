import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import exceljs from 'exceljs';

const NCM_REGEX = /^\d{8}$/;

type ExistingCatalogItem = { id: number; commercialName: string; marketName: string };

function normalizeDbcorpCode(value: unknown): string | null {
  return typeof value === 'string' ? value.trim().toUpperCase() || null : null;
}

// Uma query por request: itens ATIVOS cujo codigo DBCorp (normalizado) esta na lista.
async function findActiveByDbcorpCodes(codes: string[]): Promise<Map<string, ExistingCatalogItem>> {
  const result = new Map<string, ExistingCatalogItem>();
  if (codes.length === 0) return result;

  const found = await prisma.catalogItem.findMany({
    where: { isActive: true, dbcorpCode: { in: codes, mode: 'insensitive' } },
    select: { id: true, commercialName: true, marketName: true, dbcorpCode: true },
    orderBy: { id: 'asc' },
  });

  for (const item of found) {
    const code = normalizeDbcorpCode(item.dbcorpCode);
    if (code && !result.has(code)) {
      result.set(code, { id: item.id, commercialName: item.commercialName, marketName: item.marketName });
    }
  }
  return result;
}

function buildDuplicateReason(code: string, existing: ExistingCatalogItem): string {
  return `Código DBCorp ${code} já existe no item #${existing.id} "${existing.commercialName}" (nome de mercado: ${existing.marketName}). Linha não importada; se for um item distinto (outra marca/fornecedor), cadastre manualmente.`;
}

export class CatalogItemImportController {
  static async preview(req: Request, res: Response) {
    try {
      const { contentBase64 } = req.body;
      if (!contentBase64) {
        return res.status(400).json({ error: 'Faltou o campo contentBase64' });
      }

      const buffer = Buffer.from(contentBase64, 'base64');
      const workbook = new exceljs.Workbook();
      try {
        await workbook.xlsx.load(buffer as any);
      } catch {
        return res.status(400).json({ message: 'Arquivo inválido. Envie uma planilha .xlsx válida.' });
      }

      const worksheet = workbook.worksheets[0];
      if (!worksheet) {
        return res.status(400).json({ error: 'Nenhuma aba encontrada na planilha' });
      }

      const families = await prisma.itemFamily.findMany();
      const familyMap = new Map(families.map((f) => [f.name.toLowerCase(), f.id]));

      const validLines: any[] = [];
      // Numero da linha da planilha de cada validLine (array paralelo: o shape de validLines nao muda).
      const validRows: number[] = [];
      const errorLines: any[] = [];
      // Coluna 6 (antiga "Dangerous goods") e posicional e foi mantida so para nao deslocar
      // "Notas": o DG agora e informado pelo fornecedor na resposta, entao o valor e ignorado.
      let ignoredDangerousGoodRows = 0;

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
        const dbcorpCode = normalizeDbcorpCode(row.getCell(4).text);
        const familyName = row.getCell(5).text?.trim();
        const ignoredDangerousGoodText = row.getCell(6).text?.trim().toLowerCase();
        const notes = row.getCell(7).text?.trim() || null;

        if (!commercialName || !marketName) {
          errorLines.push({ row: rowNumber, reason: 'Nome comercial e Nome de mercado são obrigatórios' });
          return;
        }

        if (ncm && !NCM_REGEX.test(ncm)) {
          errorLines.push({ row: rowNumber, reason: 'NCM deve ter 8 dígitos numéricos' });
          return;
        }

        let familyId: number | null = null;
        let familyToCreate = false;
        if (familyName) {
          const match = familyMap.get(familyName.toLowerCase());
          if (match) {
            familyId = match;
          } else {
            familyToCreate = true;
          }
        }

        if (ignoredDangerousGoodText === 'sim' || ignoredDangerousGoodText === 'true') {
          ignoredDangerousGoodRows++;
        }

        validLines.push({
          commercialName,
          marketName,
          ncm,
          dbcorpCode,
          familyId,
          familyName: familyName || null,
          familyToCreate,
          notes,
        });
        validRows.push(rowNumber);
      });

      // Codigo DBCorp ja existente (item ativo) ou repetido na planilha: a linha vira erro.
      const distinctCodes = [
        ...new Set(validLines.map((l) => l.dbcorpCode).filter((c): c is string => typeof c === 'string')),
      ];
      const existingByCode = await findActiveByDbcorpCodes(distinctCodes);
      const acceptedLines: any[] = [];
      const firstRowByCode = new Map<string, number>();
      validLines.forEach((line, idx) => {
        const code: string | null = line.dbcorpCode;
        const rowNumber = validRows[idx];
        if (code) {
          const existing = existingByCode.get(code);
          if (existing) {
            errorLines.push({ row: rowNumber, reason: buildDuplicateReason(code, existing) });
            return;
          }
          const previousRow = firstRowByCode.get(code);
          if (previousRow !== undefined) {
            errorLines.push({
              row: rowNumber,
              reason: `Código DBCorp ${code} repetido na planilha (já usado na linha ${previousRow}). Linha não importada.`,
            });
            return;
          }
          firstRowByCode.set(code, rowNumber);
        }
        acceptedLines.push(line);
      });
      errorLines.sort((a, b) => a.row - b.row);

      const warnings: string[] = [];
      if (ignoredDangerousGoodRows > 0) {
        warnings.push(
          `${ignoredDangerousGoodRows} linha(s) marcam DG na coluna 6, que foi ignorada: o DG agora é informado pelo fornecedor na resposta da cotação.`,
        );
      }

      res.json({ data: { validLines: acceptedLines, errorLines, warnings } });
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
      const familyCache = new Map<string, number>();

      // Defesa em profundidade: o confirm pode ser chamado direto, sem passar pelo preview.
      const normalizedCodes = items.map((it: any) => normalizeDbcorpCode(it?.dbcorpCode));
      const existingByCode = await findActiveByDbcorpCodes([
        ...new Set(normalizedCodes.filter((c: string | null): c is string => c !== null)),
      ]);
      const createdCodes = new Map<string, number>();

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        try {
          // ANTES da criacao de familia: linha rejeitada nao pode deixar ItemFamily orfa.
          const code = normalizedCodes[i];
          if (code) {
            const existing = existingByCode.get(code);
            if (existing) {
              errorLines.push({ row: i + 2, reason: buildDuplicateReason(code, existing) });
              continue;
            }
            const previousRow = createdCodes.get(code);
            if (previousRow !== undefined) {
              errorLines.push({
                row: i + 2,
                reason: `Código DBCorp ${code} repetido no lote (já usado na linha ${previousRow}). Linha não importada.`,
              });
              continue;
            }
          }

          let familyId: number | null = null;
          const familyName = typeof item.familyName === 'string' ? item.familyName.trim() : '';
          if (familyName) {
            const cacheKey = familyName.toLowerCase();
            const cached = familyCache.get(cacheKey);
            if (cached) {
              familyId = cached;
            } else {
              const existing = await prisma.itemFamily.findFirst({
                where: { name: { equals: familyName, mode: 'insensitive' } }
              });
              if (existing) {
                familyId = existing.id;
              } else {
                const created = await prisma.itemFamily.create({
                  data: { name: familyName }
                });
                familyId = created.id;
              }
              familyCache.set(cacheKey, familyId);
            }
          }

          await prisma.catalogItem.create({
            data: {
              commercialName: item.commercialName,
              marketName: item.marketName,
              ncm: item.ncm,
              dbcorpCode: code,
              familyId,
              notes: item.notes,
              isActive: true,
            }
          });
          if (code) createdCodes.set(code, i + 2);
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
