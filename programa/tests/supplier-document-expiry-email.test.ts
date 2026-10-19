import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/prisma', () => ({ prisma: {} }));

import {
  SUPPLIER_DOCUMENT_EXPIRY_TEMPLATE_KEY,
  buildExpirySubject,
  formatDateKeyBR,
  renderSupplierDocumentExpiry,
  situationLabel,
  type SupplierDocumentExpiryRow,
} from '../src/mailer/renderSupplierDocumentExpiry';

function row(overrides: Partial<SupplierDocumentExpiryRow> = {}): SupplierDocumentExpiryRow {
  return {
    documentId: 1,
    documentName: 'Licenca ambiental',
    supplierId: 10,
    supplierName: 'Fornecedor X',
    expiresOn: '2026-10-31',
    daysLeft: 12,
    milestone: 'D15',
    ...overrides,
  };
}

describe('renderSupplierDocumentExpiry', () => {
  it('usa a chave de template fixa', () => {
    expect(SUPPLIER_DOCUMENT_EXPIRY_TEMPLATE_KEY).toBe('supplier_document_expiry');
  });

  it('assunto com vencido, vence hoje e a vencer', () => {
    const rows = [
      row({ documentId: 1, milestone: 'EXPIRED', daysLeft: -1, expiresOn: '2026-10-18' }),
      row({ documentId: 2, milestone: 'D0', daysLeft: 0 }),
      row({ documentId: 3, milestone: 'D15', daysLeft: 12 }),
    ];
    expect(buildExpirySubject(rows)).toBe(
      '[IntelliQuote] Documentos de fornecedor: 1 vencido, 1 vence hoje, 1 a vencer',
    );
  });

  it('assunto so com vencidos e so com D0 no plural', () => {
    expect(
      buildExpirySubject([
        row({ milestone: 'EXPIRED', daysLeft: -2 }),
        row({ documentId: 2, milestone: 'EXPIRED', daysLeft: -3 }),
      ]),
    ).toBe('[IntelliQuote] Documentos de fornecedor: 2 vencidos');
    expect(
      buildExpirySubject([
        row({ milestone: 'D0', daysLeft: 0 }),
        row({ documentId: 2, milestone: 'D0', daysLeft: 0 }),
      ]),
    ).toBe('[IntelliQuote] Documentos de fornecedor: 2 vencem hoje');
  });

  it('assunto conta D30/D7 como a vencer', () => {
    expect(
      buildExpirySubject([
        row({ milestone: 'D30', daysLeft: 25 }),
        row({ documentId: 2, milestone: 'D7', daysLeft: 3 }),
      ]),
    ).toBe('[IntelliQuote] Documentos de fornecedor: 2 a vencer');
  });

  it('textos de situacao', () => {
    expect(situationLabel({ daysLeft: -1, expiresOn: '2026-10-18' })).toBe('VENCIDO desde 19/10/2026');
    expect(situationLabel({ daysLeft: -40, expiresOn: '2026-09-09' })).toBe('VENCIDO desde 10/09/2026');
    expect(situationLabel({ daysLeft: 12, expiresOn: '2026-10-31' })).toBe('Vence em 12 dias');
    expect(situationLabel({ daysLeft: 1, expiresOn: '2026-10-20' })).toBe('Vence em 1 dia');
    expect(situationLabel({ daysLeft: 0, expiresOn: '2026-10-19' })).toBe('Vence HOJE');
  });

  it('formata a data em dd/mm/aaaa sem usar Date', () => {
    expect(formatDateKeyBR('2028-02-29')).toBe('29/02/2028');
  });

  it('HTML e texto trazem o link por fornecedor (barra final removida), data BR e o nome editado', () => {
    const out = renderSupplierDocumentExpiry({
      rows: [row({ documentName: 'Alvara editado', expiresOn: '2026-10-31' })],
      webBaseUrl: 'https://iq.test/',
    });
    expect(out.html).toContain('https://iq.test/fornecedores?supplier=10');
    expect(out.text).toContain('https://iq.test/fornecedores?supplier=10');
    expect(out.html).not.toContain('iq.test//fornecedores');
    expect(out.html).toContain('31/10/2026');
    expect(out.text).toContain('31/10/2026');
    expect(out.html).toContain('Alvara editado');
    expect(out.text).toContain('Alvara editado');
    expect(out.subject).toBe('[IntelliQuote] Documentos de fornecedor: 1 a vencer');
  });

  it('escapa nome de documento e de fornecedor no HTML', () => {
    const out = renderSupplierDocumentExpiry({
      rows: [row({ documentName: '<script>x</script>', supplierName: 'A & B' })],
      webBaseUrl: 'https://iq.test',
    });
    expect(out.html).toContain('&lt;script&gt;');
    expect(out.html).not.toContain('<script>');
    expect(out.html).toContain('A &amp; B');
  });

  it('ordena as linhas por daysLeft crescente', () => {
    const out = renderSupplierDocumentExpiry({
      rows: [
        row({ documentId: 1, documentName: 'Doc-D15', daysLeft: 12, milestone: 'D15' }),
        row({ documentId: 2, documentName: 'Doc-EXPIRED', daysLeft: -5, milestone: 'EXPIRED', expiresOn: '2026-10-14' }),
        row({ documentId: 3, documentName: 'Doc-D0', daysLeft: 0, milestone: 'D0' }),
      ],
      webBaseUrl: 'https://iq.test',
    });
    const order = ['Doc-EXPIRED', 'Doc-D0', 'Doc-D15'].map((name) => out.html.indexOf(name));
    expect(order[0]).toBeGreaterThan(-1);
    expect(order[0]).toBeLessThan(order[1]);
    expect(order[1]).toBeLessThan(order[2]);
    const textOrder = ['Doc-EXPIRED', 'Doc-D0', 'Doc-D15'].map((name) => out.text.indexOf(name));
    expect(textOrder[0]).toBeLessThan(textOrder[1]);
    expect(textOrder[1]).toBeLessThan(textOrder[2]);
  });
});
