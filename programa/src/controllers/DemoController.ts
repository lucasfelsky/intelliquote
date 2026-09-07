import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { demoEnv } from '../config/env';
import { seedDemo } from '../../prisma/seed-demo';
import { handleControllerError } from '../utils/http';

/**
 * Reset da area de teste (demo): apaga os dados de aplicacao da instancia
 * demo e re-executa o seed demo. Guarda dupla ANTES de qualquer delete:
 *
 *   1. `!demoEnv.enabled` -> 404 (o endpoint nem existe em producao normal).
 *   2. Header `x-demo-reset-token` != `demoEnv.resetToken` (ou token nao
 *      configurado) -> 401.
 *
 * So' liberado apos as duas guardas o delete + reseed roda dentro de uma
 * unica transacao. Isolamento extra: a instancia demo aponta pro schema
 * `demo` do Postgres, entao mesmo o delete fisico so' atinge esse schema.
 */
export class DemoController {
  static async reset(req: Request, res: Response): Promise<void> {
    if (!demoEnv.enabled) {
      res.status(404).json({ message: 'Nao encontrado.' });
      return;
    }

    const providedToken = req.header('x-demo-reset-token');
    if (!demoEnv.resetToken || providedToken !== demoEnv.resetToken) {
      res.status(401).json({ message: 'Token de reset invalido.' });
      return;
    }

    try {
      const reseeded = await prisma.$transaction(async (tx) => {
        await deleteApplicationData(tx);
        return seedDemo(tx);
      });

      res.status(200).json({ ok: true, reseeded });
    } catch (error) {
      const handled = handleControllerError(error);
      res.status(handled.status).json({ message: handled.message });
    }
  }
}

// Ordem FK-safe: audit/maillog/dispatch/portal-tokens (nada mais referencia
// essas linhas) -> comparacoes/respostas/itens de cotacao (Supplier tem
// Restrict em QuoteResponse.supplierId, entao precisa esvaziar antes de
// apagar fornecedor) -> cotacoes -> attachments -> catalogo/familias ->
// fornecedores/contatos -> sessions/tokens de usuario -> users (User e'
// Restrict em DispatchEvent.createdById e SupplierPortalToken.createdById,
// ja removidos no primeiro bloco). Roles ficam intactas (estrutura, nao
// dado de aplicacao).
async function deleteApplicationData(tx: Prisma.TransactionClient): Promise<void> {
  await tx.auditLog.deleteMany({});
  await tx.mailLog.deleteMany({});
  await tx.supplierPortalTokenLog.deleteMany({});
  await tx.supplierPortalResponseRevision.deleteMany({});
  await tx.supplierPortalResponseItem.deleteMany({});
  await tx.supplierPortalResponse.deleteMany({});
  await tx.dispatchEvent.deleteMany({});
  await tx.supplierPortalToken.deleteMany({});

  await tx.quoteResponseTargetPriceHistory.deleteMany({});
  await tx.quoteComparisonResult.deleteMany({});
  await tx.quoteComparison.deleteMany({});
  await tx.quoteResponseItem.deleteMany({});
  await tx.quoteResponse.deleteMany({});
  await tx.quoteRequestItem.deleteMany({});
  await tx.supplierReview.deleteMany({});

  await tx.quoteRequest.deleteMany({});

  await tx.attachment.deleteMany({});

  await tx.catalogItem.deleteMany({});
  await tx.itemFamily.deleteMany({});

  await tx.supplierContact.deleteMany({});
  await tx.supplier.deleteMany({});

  await tx.session.deleteMany({});
  await tx.passwordResetToken.deleteMany({});

  await tx.user.deleteMany({});
}
