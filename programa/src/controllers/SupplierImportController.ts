import { Request, Response } from 'express';
import exceljs from 'exceljs';
import { Incoterm, SupplierStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AuditLogService } from '../services/AuditLogService';
import { handleControllerError, HttpError } from '../utils/http';
import {
  supplierImportConfirmSchema,
  supplierImportPreviewSchema,
} from '../validators/domain';
import {
  SUPPLIER_IMPORT_MAX_ROWS,
  buildSupplierImportTemplate,
  isSupplierImportHeaderValid,
  normalizeSupplierName,
  parseSupplierRow,
  type SupplierImportContext,
  type SupplierImportFamilyRef,
  type SupplierImportRowData,
} from '../utils/supplierImport';

export class SupplierImportController {
  static async template(_req: Request, res: Response): Promise<Response> {
    try {
      const buffer = await buildSupplierImportTemplate();
      return res.status(200).json({
        data: {
          fileName: 'modelo-importacao-fornecedores.xlsx',
          contentBase64: buffer.toString('base64'),
        },
      });
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async preview(req: Request, res: Response): Promise<Response> {
    try {
      const parsedBody = supplierImportPreviewSchema.safeParse(req.body);
      if (!parsedBody.success) {
        return res.status(400).json({ message: 'Envie a planilha em contentBase64.' });
      }

      const buffer = Buffer.from(parsedBody.data.contentBase64, 'base64');
      const workbook = new exceljs.Workbook();
      try {
        await workbook.xlsx.load(buffer as any);
      } catch {
        return res.status(400).json({
          message: 'Arquivo inválido. Envie uma planilha .xlsx gerada a partir do modelo.',
        });
      }

      const worksheet = workbook.worksheets[0];
      if (!worksheet) {
        return res.status(400).json({ message: 'Nenhuma aba encontrada na planilha.' });
      }

      const headerCells: string[] = [];
      for (let i = 1; i <= 12; i++) {
        headerCells.push(String(worksheet.getRow(1).getCell(i).text ?? '').trim());
      }
      if (!isSupplierImportHeaderValid(headerCells)) {
        return res.status(400).json({
          message:
            'Cabeçalho da planilha não corresponde ao modelo. Baixe o modelo e tente novamente.',
        });
      }

      const [families, existingSuppliers] = await Promise.all([
        prisma.itemFamily.findMany({
          where: { isActive: true },
          select: { id: true, name: true },
        }),
        prisma.supplier.findMany({ where: { deletedAt: null }, select: { name: true } }),
      ]);

      const familiesByName = new Map<string, SupplierImportFamilyRef>(
        families.map((family) => [family.name.toLowerCase(), { id: family.id, name: family.name }]),
      );
      const existingNames = new Set(existingSuppliers.map((s) => normalizeSupplierName(s.name)));
      const seenNames = new Map<string, number>();

      const validLines: Array<{ row: number } & SupplierImportRowData> = [];
      const errorLines: Array<{ row: number; name: string; reason: string }> = [];

      let rowCount = 0;
      let limitExceeded = false;
      worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        if (!row.hasValues) return;

        if (rowCount >= SUPPLIER_IMPORT_MAX_ROWS) {
          if (!limitExceeded) {
            errorLines.push({ row: rowNumber, name: '', reason: 'Limite de 500 linhas excedido' });
            limitExceeded = true;
          }
          rowCount++;
          return;
        }
        rowCount++;

        const cells: string[] = [];
        for (let i = 1; i <= 12; i++) {
          cells.push(String(row.getCell(i).text ?? '').trim());
        }

        const ctx: SupplierImportContext = {
          familiesByName,
          existingNames,
          seenNames,
          rowNumber,
        };

        const result = parseSupplierRow(cells, ctx);
        if (result.ok) {
          validLines.push({ row: rowNumber, ...result.data });
        } else {
          errorLines.push({ row: rowNumber, name: result.name, reason: result.reasons.join('; ') });
        }
      });

      return res.status(200).json({ data: { validLines, errorLines } });
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async confirm(req: Request, res: Response): Promise<Response> {
    try {
      const parsedBody = supplierImportConfirmSchema.safeParse(req.body);
      if (!parsedBody.success) {
        return res.status(400).json({ message: 'Envie ao menos uma linha válida para importar.' });
      }

      const successLines: Array<{ row: number; supplierId: number; name: string }> = [];
      const errorLines: Array<{ row: number; name: string; reason: string }> = [];

      for (const { row, data } of parsedBody.data.rows) {
        try {
          const supplier = await prisma.$transaction(async (tx) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${normalizeSupplierName(
              data.name,
            )}))`;

            const existing = await tx.supplier.findFirst({
              where: { deletedAt: null, name: { equals: data.name.trim(), mode: 'insensitive' } },
              select: { id: true },
            });
            if (existing) {
              throw new HttpError(409, 'Fornecedor já cadastrado');
            }

            if (data.familyIds.length > 0) {
              const activeCount = await tx.itemFamily.count({
                where: { id: { in: data.familyIds }, isActive: true },
              });
              if (activeCount !== data.familyIds.length) {
                throw new HttpError(400, 'Família inativa ou removida');
              }
            }

            const created = await tx.supplier.create({
              data: {
                name: data.name,
                website: data.website,
                country: data.country,
                notes: data.notes,
                paymentTermsDays: data.paymentTermsDays,
                acceptedIncoterms: data.acceptedIncoterms as Incoterm[],
                tags: data.tags ?? [],
                status: SupplierStatus.active,
                createdById: req.user?.id ?? null,
                ...(data.familyIds.length > 0
                  ? { families: { connect: data.familyIds.map((id) => ({ id })) } }
                  : {}),
              },
              include: { families: { select: { id: true, name: true } } },
            });

            await AuditLogService.log(
              {
                entityType: 'supplier',
                entityId: created.id,
                action: 'create',
                performedById: req.user?.id ?? null,
                afterData: created,
                metadata: { source: 'spreadsheet_import', row },
              },
              tx,
            );

            // isPrimary e decisao do servidor: o 1o contato da planilha e o principal.
            for (const [index, c] of data.contacts.entries()) {
              const contact = await tx.supplierContact.create({
                data: {
                  supplierId: created.id,
                  name: c.name,
                  email: c.email,
                  phone: c.phone ?? null,
                  position: c.position ?? null,
                  isPrimary: index === 0,
                },
              });

              await AuditLogService.log(
                {
                  entityType: 'supplier_contact',
                  entityId: contact.id,
                  action: 'create',
                  performedById: req.user?.id ?? null,
                  afterData: contact,
                  metadata: { supplierId: created.id, source: 'spreadsheet_import' },
                },
                tx,
              );
            }

            return created;
          });

          successLines.push({ row, supplierId: supplier.id, name: supplier.name });
        } catch (error) {
          const handled = handleControllerError(error);
          errorLines.push({ row, name: data.name, reason: handled.message });
        }
      }

      return res.status(200).json({ data: { successLines, errorLines } });
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }
}
