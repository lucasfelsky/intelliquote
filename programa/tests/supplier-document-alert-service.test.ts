import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  docFindMany: vi.fn(),
  alertFindMany: vi.fn(),
  alertCreate: vi.fn(),
  alertDeleteMany: vi.fn(),
  alertUpdateMany: vi.fn(),
  mailLogFindFirst: vi.fn(),
  sendAndLog: vi.fn(),
  loadComexCc: vi.fn(),
  auditLog: vi.fn(),
  loggerWarn: vi.fn(),
  loggerInfo: vi.fn(),
  loggerError: vi.fn(),
  renderOverride: null as null | (() => never),
}));

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    supplierDocument: { findMany: mocks.docFindMany },
    supplierDocumentAlert: {
      findMany: mocks.alertFindMany,
      create: mocks.alertCreate,
      deleteMany: mocks.alertDeleteMany,
      updateMany: mocks.alertUpdateMany,
    },
    mailLog: { findFirst: mocks.mailLogFindFirst },
  },
}));

vi.mock('../src/lib/logger', () => ({
  logger: { warn: mocks.loggerWarn, info: mocks.loggerInfo, error: mocks.loggerError, debug: vi.fn() },
}));

vi.mock('../src/mailer/renderSupplierDocumentExpiry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/mailer/renderSupplierDocumentExpiry')>();
  return {
    ...actual,
    renderSupplierDocumentExpiry: (...args: Parameters<typeof actual.renderSupplierDocumentExpiry>) =>
      mocks.renderOverride ? mocks.renderOverride() : actual.renderSupplierDocumentExpiry(...args),
  };
});

vi.mock('../src/mailer/MailerService', () => ({ sendAndLog: mocks.sendAndLog }));
vi.mock('../src/services/CreditSupportService', () => ({ loadComexCc: mocks.loadComexCc }));
vi.mock('../src/services/AuditLogService', () => ({ AuditLogService: { log: mocks.auditLog } }));

import {
  ALERT_RUN_ENTITY_TYPE,
  SupplierDocumentAlertService,
} from '../src/services/SupplierDocumentAlertService';

const NOW = new Date('2026-10-19T12:00:00Z'); // hoje BRT = 2026-10-19

function doc(id: number, expiresOn: string, alertCycle = 1, supplierName = `Fornecedor ${id}`) {
  return {
    id,
    name: `Documento ${id}`,
    expiresOn: new Date(`${expiresOn}T00:00:00.000Z`),
    alertCycle,
    supplier: { id: id * 10, name: supplierName },
  };
}

function p2002() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

const COMEX = [
  { email: 'a@comex.test', name: 'A' },
  { email: 'b@comex.test', name: '' },
  { email: 'c@comex.test', name: 'C' },
];

beforeEach(() => {
  vi.resetAllMocks();
  mocks.renderOverride = null;
  mocks.docFindMany.mockResolvedValue([]);
  mocks.alertFindMany.mockResolvedValue([]);
  mocks.alertCreate.mockResolvedValue({});
  mocks.alertDeleteMany.mockResolvedValue({ count: 0 });
  mocks.alertUpdateMany.mockResolvedValue({ count: 0 });
  mocks.mailLogFindFirst.mockResolvedValue(null);
  mocks.loadComexCc.mockResolvedValue(COMEX);
  mocks.sendAndLog.mockResolvedValue({ providerMessageId: 'm1', status: 'sent' });
  mocks.auditLog.mockResolvedValue(undefined);
});

function createdKeys(): Array<{ documentId: number; alertCycle: number; milestone: string }> {
  return mocks.alertCreate.mock.calls.map(([args]) => ({
    documentId: args.data.documentId,
    alertCycle: args.data.alertCycle,
    milestone: args.data.milestone,
  }));
}

describe('SupplierDocumentAlertService.runExpiryAlertSweep', () => {
  it('filtra elegibilidade no banco (doc/fornecedor ativos, janela de 30 dias) e nunca le o arquivo', async () => {
    await SupplierDocumentAlertService.runExpiryAlertSweep(NOW);

    expect(mocks.docFindMany).toHaveBeenCalledTimes(1);
    const args = mocks.docFindMany.mock.calls[0][0];
    expect(args.where.deletedAt).toBeNull();
    expect(args.where.supplier).toEqual({ deletedAt: null, status: 'active' });
    expect(args.where.expiresOn.lte).toEqual(new Date('2026-11-18T00:00:00.000Z'));
    expect(args.select).not.toHaveProperty('file');
    expect(args).not.toHaveProperty('include');
  });

  it('sem candidatos: nothing_due e nao carrega destinatarios', async () => {
    const result = await SupplierDocumentAlertService.runExpiryAlertSweep(NOW);
    expect(result).toEqual({
      outcome: 'nothing_due',
      documents: 0,
      releasedOrphans: 0,
      recoveredOrphans: 0,
      inFlight: 0,
    });
    expect(mocks.loadComexCc).not.toHaveBeenCalled();
    expect(mocks.alertCreate).not.toHaveBeenCalled();
    expect(mocks.sendAndLog).not.toHaveBeenCalled();
  });

  it('fuso: 23:30 BRT (02:30Z do dia seguinte) com vencimento "hoje" cria D0, nao EXPIRED', async () => {
    mocks.docFindMany.mockResolvedValue([doc(1, '2026-10-19')]);
    await SupplierDocumentAlertService.runExpiryAlertSweep(new Date('2026-10-20T02:30:00Z'));

    expect(mocks.docFindMany.mock.calls[0][0].where.expiresOn.lte).toEqual(new Date('2026-11-18T00:00:00.000Z'));
    expect(createdKeys()).toEqual([{ documentId: 1, alertCycle: 1, milestone: 'D0' }]);
  });

  it('bissexto: 2028-02-29 a 30 dias de 2028-01-30 cria D30', async () => {
    mocks.docFindMany.mockResolvedValue([doc(1, '2028-02-29')]);
    await SupplierDocumentAlertService.runExpiryAlertSweep(new Date('2028-01-30T15:00:00Z'));
    expect(createdKeys()).toEqual([{ documentId: 1, alertCycle: 1, milestone: 'D30' }]);
  });

  it('descarta documento fora da janela (31 dias)', async () => {
    mocks.docFindMany.mockResolvedValue([doc(1, '2026-11-19')]);
    const result = await SupplierDocumentAlertService.runExpiryAlertSweep(NOW);
    expect(result.outcome).toBe('nothing_due');
    expect(mocks.alertCreate).not.toHaveBeenCalled();
  });

  it('renovado: ciclo 2 com alerta do ciclo 1 ja existente cria o claim do ciclo 2', async () => {
    mocks.docFindMany.mockResolvedValue([doc(1, '2026-11-10', 2)]);
    mocks.alertFindMany.mockResolvedValue([{ documentId: 1, alertCycle: 1, milestone: 'D30', status: 'sent' }]);
    await SupplierDocumentAlertService.runExpiryAlertSweep(NOW);
    expect(createdKeys()).toEqual([{ documentId: 1, alertCycle: 2, milestone: 'D30' }]);
  });

  it('pre-filtro: alerta ja SENT para (doc, ciclo, marco) nao cria nem envia (nothing_due)', async () => {
    mocks.docFindMany.mockResolvedValue([doc(1, '2026-11-10', 1)]);
    mocks.alertFindMany.mockResolvedValue([{ documentId: 1, alertCycle: 1, milestone: 'D30', status: 'sent' }]);
    const result = await SupplierDocumentAlertService.runExpiryAlertSweep(NOW);
    expect(result).toMatchObject({ outcome: 'nothing_due', inFlight: 0 });
    expect(mocks.alertCreate).not.toHaveBeenCalled();
    expect(mocks.sendAndLog).not.toHaveBeenCalled();
    expect(mocks.loadComexCc).not.toHaveBeenCalled();
  });

  it('pre-filtro: claim claimed recente de outra execucao vira in_progress, sem e-mail', async () => {
    mocks.docFindMany.mockResolvedValue([doc(1, '2026-11-10', 1)]);
    mocks.alertFindMany.mockResolvedValue([{ documentId: 1, alertCycle: 1, milestone: 'D30', status: 'claimed' }]);
    const result = await SupplierDocumentAlertService.runExpiryAlertSweep(NOW);
    expect(result).toMatchObject({ outcome: 'in_progress', documents: 0, inFlight: 1 });
    expect(mocks.alertCreate).not.toHaveBeenCalled();
    expect(mocks.sendAndLog).not.toHaveBeenCalled();
  });

  it('P2002 cuja linha esta claimed (corrida): in_progress, sem e-mail', async () => {
    mocks.docFindMany.mockResolvedValue([doc(1, '2026-11-10'), doc(2, '2026-10-25')]);
    mocks.alertCreate.mockRejectedValue(p2002());
    mocks.alertFindMany
      .mockResolvedValueOnce([]) // orfaos
      .mockResolvedValueOnce([]) // pre-filtro
      .mockResolvedValueOnce([
        { documentId: 1, alertCycle: 1, milestone: 'D30', status: 'claimed' },
        { documentId: 2, alertCycle: 1, milestone: 'D7', status: 'sent' },
      ]);
    const result = await SupplierDocumentAlertService.runExpiryAlertSweep(NOW);
    expect(result).toMatchObject({ outcome: 'in_progress', documents: 0, inFlight: 1 });
    expect(mocks.sendAndLog).not.toHaveBeenCalled();
  });

  it('P2002 cuja linha ja esta sent: already_claimed, sem e-mail (200 na rota)', async () => {
    mocks.docFindMany.mockResolvedValue([doc(1, '2026-11-10'), doc(2, '2026-10-25')]);
    mocks.alertCreate.mockRejectedValue(p2002());
    mocks.alertFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { documentId: 1, alertCycle: 1, milestone: 'D30', status: 'sent' },
        { documentId: 2, alertCycle: 1, milestone: 'D7', status: 'sent' },
      ]);
    const result = await SupplierDocumentAlertService.runExpiryAlertSweep(NOW);
    expect(result).toMatchObject({ outcome: 'already_claimed', inFlight: 0 });
    expect(mocks.sendAndLog).not.toHaveBeenCalled();
  });

  it('P2002 em parte dos documentos (outro marco em andamento): envia so os claims ganhos e informa inFlight', async () => {
    mocks.docFindMany.mockResolvedValue([doc(1, '2026-11-10'), doc(2, '2026-10-25')]);
    mocks.alertCreate.mockRejectedValueOnce(p2002()).mockResolvedValueOnce({});
    mocks.alertFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ documentId: 1, alertCycle: 1, milestone: 'D30', status: 'claimed' }]);
    const result = await SupplierDocumentAlertService.runExpiryAlertSweep(NOW);
    expect(result).toMatchObject({ outcome: 'sent', documents: 1, inFlight: 1 });
    expect(mocks.sendAndLog).toHaveBeenCalledTimes(1);
  });

  it('pre-filtro com 1 marco em andamento e outro novo: envia o novo (sent) e informa inFlight', async () => {
    mocks.docFindMany.mockResolvedValue([doc(1, '2026-11-10'), doc(2, '2026-10-25')]);
    mocks.alertFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ documentId: 1, alertCycle: 1, milestone: 'D30', status: 'claimed' }]);
    const result = await SupplierDocumentAlertService.runExpiryAlertSweep(NOW);
    expect(result).toMatchObject({ outcome: 'sent', documents: 1, inFlight: 1 });
    expect(createdKeys()).toEqual([{ documentId: 2, alertCycle: 1, milestone: 'D7' }]);
  });

  it('render lanca: claims do run apagados e send_failed (sem sendAndLog)', async () => {
    mocks.docFindMany.mockResolvedValue([doc(1, '2026-11-10')]);
    mocks.renderOverride = () => {
      throw new Error('render quebrou');
    };
    const result = await SupplierDocumentAlertService.runExpiryAlertSweep(NOW);
    const runId = mocks.alertCreate.mock.calls[0][0].data.runId;
    expect(result).toMatchObject({ outcome: 'send_failed', documents: 1 });
    expect(mocks.alertDeleteMany).toHaveBeenCalledWith({ where: { runId, status: 'claimed' } });
    expect(mocks.sendAndLog).not.toHaveBeenCalled();
  });

  it('erro inesperado no claim: libera os claims do run e propaga', async () => {
    mocks.docFindMany.mockResolvedValue([doc(1, '2026-11-10'), doc(2, '2026-10-25')]);
    mocks.alertCreate.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('db caiu'));
    await expect(SupplierDocumentAlertService.runExpiryAlertSweep(NOW)).rejects.toThrow('db caiu');
    const runId = mocks.alertCreate.mock.calls[0][0].data.runId;
    expect(mocks.alertDeleteMany).toHaveBeenCalledWith({ where: { runId, status: 'claimed' } });
    expect(mocks.sendAndLog).not.toHaveBeenCalled();
  });

  it('lista COMEX vazia: warn, nenhum claim e nenhum e-mail', async () => {
    mocks.docFindMany.mockResolvedValue([doc(1, '2026-11-10')]);
    mocks.loadComexCc.mockResolvedValue([]);
    const result = await SupplierDocumentAlertService.runExpiryAlertSweep(NOW);
    expect(result.outcome).toBe('no_recipients');
    expect(mocks.alertCreate).not.toHaveBeenCalled();
    expect(mocks.sendAndLog).not.toHaveBeenCalled();
    expect(mocks.loggerWarn).toHaveBeenCalledTimes(1);
    expect(mocks.loggerWarn.mock.calls[0][0]).toMatchObject({ pending: 1 });
  });

  it('sucesso com 3 documentos e 3 destinatarios: 1 e-mail, 1o em To e demais em Cc', async () => {
    mocks.docFindMany.mockResolvedValue([
      doc(1, '2026-10-18'), // EXPIRED
      doc(2, '2026-10-19'), // D0
      doc(3, '2026-10-30'), // D15
    ]);
    const result = await SupplierDocumentAlertService.runExpiryAlertSweep(NOW);

    expect(result).toEqual({
      outcome: 'sent',
      documents: 3,
      releasedOrphans: 0,
      recoveredOrphans: 0,
      inFlight: 0,
    });
    expect(createdKeys().map((k) => k.milestone)).toEqual(['EXPIRED', 'D0', 'D15']);
    const runId = mocks.alertCreate.mock.calls[0][0].data.runId;
    expect(
      mocks.alertCreate.mock.calls.every(([a]) => a.data.runId === runId && a.data.status === 'claimed'),
    ).toBe(true);

    expect(mocks.sendAndLog).toHaveBeenCalledTimes(1);
    const sent = mocks.sendAndLog.mock.calls[0][0];
    expect(sent.to.email).toBe('a@comex.test');
    expect(sent.cc.map((c: { email: string }) => c.email)).toEqual(['b@comex.test', 'c@comex.test']);
    expect(sent.templateId).toBe('supplier_document_expiry');
    expect(sent.relatedEntityType).toBe(ALERT_RUN_ENTITY_TYPE);
    expect(sent.relatedEntityId).toBe(runId);
    expect(sent.subject).toBe('[IntelliQuote] Documentos de fornecedor: 1 vencido, 1 vence hoje, 1 a vencer');
    expect(sent.allowComercialRecipients).toBeUndefined();

    expect(mocks.alertUpdateMany).toHaveBeenCalledWith({
      where: { runId, status: 'claimed' },
      data: { status: 'sent', sentAt: NOW },
    });
    expect(mocks.auditLog).toHaveBeenCalledTimes(3);
    expect(mocks.auditLog.mock.calls[0][0]).toMatchObject({
      entityType: 'supplier_document',
      entityId: 1,
      action: 'expiry_alert_sent',
      performedById: null,
      metadata: { milestone: 'EXPIRED', alertCycle: 1, runId, expiresOn: '2026-10-18' },
    });
    expect(mocks.alertDeleteMany).not.toHaveBeenCalled();
  });

  it('1 destinatario: sendAndLog sem cc', async () => {
    mocks.docFindMany.mockResolvedValue([doc(1, '2026-11-10')]);
    mocks.loadComexCc.mockResolvedValue([COMEX[0]]);
    await SupplierDocumentAlertService.runExpiryAlertSweep(NOW);
    const sent = mocks.sendAndLog.mock.calls[0][0];
    expect(sent.to.email).toBe('a@comex.test');
    expect(sent).not.toHaveProperty('cc');
  });

  it('falha SMTP (status failed): libera os claims do run e devolve send_failed', async () => {
    mocks.docFindMany.mockResolvedValue([doc(1, '2026-11-10'), doc(2, '2026-10-25')]);
    mocks.sendAndLog.mockResolvedValue({ providerMessageId: '', status: 'failed', error: 'smtp' });
    const result = await SupplierDocumentAlertService.runExpiryAlertSweep(NOW);
    const runId = mocks.alertCreate.mock.calls[0][0].data.runId;

    expect(result).toEqual({
      outcome: 'send_failed',
      documents: 2,
      releasedOrphans: 0,
      recoveredOrphans: 0,
      inFlight: 0,
    });
    expect(mocks.alertDeleteMany).toHaveBeenCalledWith({ where: { runId, status: 'claimed' } });
    expect(mocks.alertUpdateMany).not.toHaveBeenCalled();
    expect(mocks.auditLog).not.toHaveBeenCalled();
  });

  it('sendAndLog lanca: mesmo resultado (claims apagados, send_failed)', async () => {
    mocks.docFindMany.mockResolvedValue([doc(1, '2026-11-10')]);
    mocks.sendAndLog.mockRejectedValue(new Error('sem SMTP'));
    const result = await SupplierDocumentAlertService.runExpiryAlertSweep(NOW);
    const runId = mocks.alertCreate.mock.calls[0][0].data.runId;

    expect(result.outcome).toBe('send_failed');
    expect(mocks.alertDeleteMany).toHaveBeenCalledWith({ where: { runId, status: 'claimed' } });
    expect(mocks.alertUpdateMany).not.toHaveBeenCalled();
  });

  it('falha no pos-envio (updateMany): continua sent e NAO apaga os claims do run', async () => {
    mocks.docFindMany.mockResolvedValue([doc(1, '2026-11-10')]);
    mocks.alertUpdateMany.mockRejectedValue(new Error('flake de db'));
    const result = await SupplierDocumentAlertService.runExpiryAlertSweep(NOW);

    expect(result.outcome).toBe('sent');
    expect(mocks.alertDeleteMany).not.toHaveBeenCalled();
    expect(mocks.loggerError).toHaveBeenCalled();
  });

  it('falha no AuditLog apos o envio: continua sent e NAO apaga os claims', async () => {
    mocks.docFindMany.mockResolvedValue([doc(1, '2026-11-10')]);
    mocks.auditLog.mockRejectedValue(new Error('audit fora'));
    const result = await SupplierDocumentAlertService.runExpiryAlertSweep(NOW);
    expect(result.outcome).toBe('sent');
    expect(mocks.alertDeleteMany).not.toHaveBeenCalled();
  });

  it('orfao sem MailLog sent: apaga os claims do run e conta releasedOrphans', async () => {
    mocks.alertFindMany.mockResolvedValueOnce([{ runId: 'run-orfao' }, { runId: 'run-orfao' }]);
    mocks.mailLogFindFirst.mockResolvedValue(null);
    const result = await SupplierDocumentAlertService.runExpiryAlertSweep(NOW);

    const cutoff = new Date(NOW.getTime() - 15 * 60 * 1000);
    expect(mocks.alertFindMany.mock.calls[0][0].where).toEqual({ status: 'claimed', claimedAt: { lt: cutoff } });
    expect(mocks.mailLogFindFirst).toHaveBeenCalledTimes(1);
    expect(mocks.alertDeleteMany).toHaveBeenCalledWith({
      where: { runId: 'run-orfao', status: 'claimed', claimedAt: { lt: cutoff } },
    });
    expect(result).toMatchObject({ releasedOrphans: 1, recoveredOrphans: 0 });
  });

  it('orfao com MailLog sent: marca como sent, nao apaga e conta recoveredOrphans', async () => {
    const sentAt = new Date('2026-10-19T08:00:05Z');
    mocks.alertFindMany.mockResolvedValueOnce([{ runId: 'run-enviado' }]);
    mocks.mailLogFindFirst.mockResolvedValue({ sentAt });
    const result = await SupplierDocumentAlertService.runExpiryAlertSweep(NOW);

    expect(mocks.mailLogFindFirst.mock.calls[0][0].where).toEqual({
      templateId: 'supplier_document_expiry',
      relatedEntityType: 'supplier_document_alert_run',
      relatedEntityId: 'run-enviado',
      status: 'sent',
    });
    expect(mocks.alertUpdateMany).toHaveBeenCalledWith({
      where: { runId: 'run-enviado', status: 'claimed' },
      data: { status: 'sent', sentAt },
    });
    expect(mocks.alertDeleteMany).not.toHaveBeenCalled();
    expect(result).toMatchObject({ releasedOrphans: 0, recoveredOrphans: 1 });
  });
});
