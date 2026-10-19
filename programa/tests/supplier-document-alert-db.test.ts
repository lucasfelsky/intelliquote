import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { CompanyProfileService } from '../src/services/CompanyProfileService';
import { SupplierDocumentAlertService } from '../src/services/SupplierDocumentAlertService';
import { dateKeyToDbDate, todayKeyInSaoPaulo } from '../src/utils/supplierDocumentDates';

const testDbSkip = process.env.RUN_DB_TESTS !== 'true' ? it.skip : it;
const runId = `supplier-document-alert-db-${Date.now()}`;

// Chave YYYY-MM-DD de hoje (calendario de Sao Paulo) deslocada em `offsetDays`.
function keyFromToday(offsetDays: number): string {
  const [y, m, d] = todayKeyInSaoPaulo(new Date()).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + offsetDays)).toISOString().slice(0, 10);
}

describe('SupplierDocumentAlertService (DB)', () => {
  let originalDispatchCc: string | null = null;
  const supplierIds: Record<'A' | 'B' | 'C' | 'D', number> = { A: 0, B: 0, C: 0, D: 0 };
  const docIds: Record<'A1' | 'A2' | 'A3' | 'B1' | 'C1' | 'D1', number> = {
    A1: 0,
    A2: 0,
    A3: 0,
    B1: 0,
    C1: 0,
    D1: 0,
  };

  async function createDoc(supplierId: number, name: string, offsetDays: number, deletedAt?: Date) {
    const doc = await prisma.supplierDocument.create({
      data: {
        supplierId,
        name,
        expiresOn: dateKeyToDbDate(keyFromToday(offsetDays)),
        fileName: 'doc.pdf',
        mimeType: 'application/pdf',
        fileSize: 10,
        deletedAt: deletedAt ?? null,
      },
    });
    return doc.id;
  }

  async function alertsOf(documentId: number) {
    return prisma.supplierDocumentAlert.findMany({
      where: { documentId },
      orderBy: { id: 'asc' },
    });
  }

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== 'true') return;

    const profile = await CompanyProfileService.get();
    originalDispatchCc = profile.dispatchCc;
    await prisma.companyProfile.update({
      where: { id: 1 },
      data: { dispatchCc: JSON.stringify([`comex-${runId}@intelliquote.local`]) },
    });

    const make = (suffix: string, status: 'active' | 'inactive' | 'blocked', deletedAt?: Date) =>
      prisma.supplier.create({
        data: {
          name: `Fornecedor ${runId} ${suffix}`,
          acceptedIncoterms: ['FOB'],
          status,
          deletedAt: deletedAt ?? null,
        },
      });
    supplierIds.A = (await make('A', 'active')).id;
    supplierIds.B = (await make('B', 'inactive')).id;
    supplierIds.C = (await make('C', 'blocked')).id;
    supplierIds.D = (await make('D', 'active', new Date())).id;

    docIds.A1 = await createDoc(supplierIds.A, 'A1 hoje+10', 10);
    docIds.A2 = await createDoc(supplierIds.A, 'A2 ontem', -1);
    docIds.A3 = await createDoc(supplierIds.A, 'A3 excluido', 5, new Date());
    docIds.B1 = await createDoc(supplierIds.B, 'B1 inativo', 5);
    docIds.C1 = await createDoc(supplierIds.C, 'C1 bloqueado', 5);
    docIds.D1 = await createDoc(supplierIds.D, 'D1 fornecedor excluido', 5);
  });

  afterAll(async () => {
    if (process.env.RUN_DB_TESTS !== 'true') return;

    const ids = Object.values(docIds).filter(Boolean);
    const alerts = await prisma.supplierDocumentAlert.findMany({
      where: { documentId: { in: ids } },
      select: { runId: true },
    });
    const alertRunIds = [...new Set(alerts.map((a) => a.runId))];

    if (alertRunIds.length > 0) {
      await prisma.mailLog.deleteMany({
        where: {
          templateId: 'supplier_document_expiry',
          relatedEntityType: 'supplier_document_alert_run',
          relatedEntityId: { in: alertRunIds },
        },
      });
    }
    await prisma.auditLog.deleteMany({
      where: { entityType: 'supplier_document', entityId: { in: ids.map(String) } },
    });
    // Os alertas e os documentos caem em cascata com o fornecedor.
    await prisma.supplier.deleteMany({
      where: { id: { in: Object.values(supplierIds).filter(Boolean) } },
    });
    await prisma.companyProfile.update({
      where: { id: 1 },
      data: { dispatchCc: originalDispatchCc },
    });
    await prisma.$disconnect();
  });

  testDbSkip('duas execucoes simultaneas: 1 alerta por marco, so documentos elegiveis', async () => {
    const now = new Date();
    await Promise.all([
      SupplierDocumentAlertService.runExpiryAlertSweep(now),
      SupplierDocumentAlertService.runExpiryAlertSweep(now),
    ]);

    const a1 = await alertsOf(docIds.A1);
    expect(a1).toHaveLength(1);
    expect(a1[0]).toMatchObject({ alertCycle: 1, milestone: 'D15', status: 'sent' });

    const a2 = await alertsOf(docIds.A2);
    expect(a2).toHaveLength(1);
    expect(a2[0]).toMatchObject({ alertCycle: 1, milestone: 'EXPIRED', status: 'sent' });

    for (const key of ['A3', 'B1', 'C1', 'D1'] as const) {
      expect(await alertsOf(docIds[key])).toHaveLength(0);
    }

    const mail = await prisma.mailLog.findFirst({
      where: {
        templateId: 'supplier_document_expiry',
        status: 'sent',
        relatedEntityType: 'supplier_document_alert_run',
        relatedEntityId: a1[0].runId,
      },
    });
    expect(mail).not.toBeNull();
  });

  testDbSkip('3a execucao nao cria alerta novo para os documentos do teste', async () => {
    const before = await prisma.supplierDocumentAlert.count({
      where: { documentId: { in: Object.values(docIds) } },
    });
    await SupplierDocumentAlertService.runExpiryAlertSweep(new Date());
    const after = await prisma.supplierDocumentAlert.count({
      where: { documentId: { in: Object.values(docIds) } },
    });
    expect(after).toBe(before);
  });

  testDbSkip('renovacao (novo ciclo) reinicia os marcos: cria (A1, 2, D30)', async () => {
    await prisma.supplierDocument.update({
      where: { id: docIds.A1 },
      data: { expiresOn: dateKeyToDbDate(keyFromToday(30)), alertCycle: { increment: 1 } },
    });
    await SupplierDocumentAlertService.runExpiryAlertSweep(new Date());

    const a1 = await alertsOf(docIds.A1);
    expect(a1.map((a) => `${a.alertCycle}:${a.milestone}:${a.status}`)).toEqual([
      '1:D15:sent',
      '2:D30:sent',
    ]);
  });
});
