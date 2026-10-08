import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/EmailTemplateService', () => ({
  EmailTemplateService: { get: vi.fn() },
}));

import { EmailTemplateService } from '../src/services/EmailTemplateService';
import {
  groupDispatchItemsByPurchaseOrder,
  renderDispatchFromTemplate,
  renderItemsTable,
  renderItemsText,
  renderSections,
  type QuoteDispatchItem,
  type QuoteDispatchPurchaseOrder,
  type QuoteDispatchVars,
} from '../src/mailer/renderQuoteDispatch';

const getTemplateMock = EmailTemplateService.get as unknown as ReturnType<typeof vi.fn>;

const baseVars: Omit<QuoteDispatchVars, 'items'> = {
  subject: 'Sourcing request',
  supplierContactName: 'Jane Doe',
  requestCode: 'REQ-001',
  productName: 'Sodium Hydroxide',
  quantity: 10,
  unit: 'MT',
  desiredIncoterm: 'FOB',
  currency: 'USD',
  deadlineAt: '2026-09-01',
  expiresAt: '2026-09-15',
  portalLink: 'https://example.com/portal/token',
  companyName: 'SQ Quimica',
  purchasingEmail: 'buyer@example.com',
};

function item(name: string, purchaseOrderId?: number | null): QuoteDispatchItem {
  return {
    marketName: name,
    quantity: 5,
    unit: 'MT',
    desiredIncoterm: 'FOB',
    originPort: 'Santos',
    destinationPort: 'Shanghai',
    purchaseOrderId,
  };
}

function stripPo(items: QuoteDispatchItem[]): QuoteDispatchItem[] {
  return items.map(({ purchaseOrderId: _ignored, ...rest }) => rest);
}

const twoPos: QuoteDispatchPurchaseOrder[] = [
  { id: 10, label: 'PO-A', position: 1 },
  { id: 11, label: 'PO-B', position: 2 },
];

const TITLE_ROW = /<tr><td colspan="5" align="left" bgcolor="#ffffff"/g;
const pill = (n: string) =>
  `<span style="display:inline-block;margin-left:4px;padding:2px 10px;border-radius:999px;background-color:#ECF1EF;font-family:Arial,sans-serif;font-size:12px;font-weight:bold;color:#4A5560;white-space:nowrap;">${n}</span>`;

describe('renderItemsTable - agrupamento por PO', () => {
  it('a) 0 POs: igual a lista vazia de POs, sem titulos nem Other items', () => {
    const items = [item('A', 10), item('B', null)];
    const none = renderItemsTable(items);
    expect(renderItemsTable(items, [])).toBe(none);
    expect(none).not.toContain('Other items');
    expect(none.match(TITLE_ROW)).toBeNull();
  });

  it('b) 1 PO: HTML e texto identicos ao modo plano', () => {
    const items = [item('A', 10), item('B', 10)];
    const onePo = [{ id: 10, label: 'PO-A', position: 1 }];
    expect(renderItemsTable(items, onePo)).toBe(renderItemsTable(stripPo(items)));
    expect(renderItemsText(items, onePo)).toBe(renderItemsText(stripPo(items)));
    expect(renderItemsText(items, onePo)).toBe(
      '  - A | FOB | Dest: Shanghai | Origin: Santos | 5 MT\n  - B | FOB | Dest: Shanghai | Origin: Santos | 5 MT',
    );
  });

  it('c) 2 POs: ordem por position, contadores, Other items, PO vazia omitida, itens sem zebra', () => {
    const pos: QuoteDispatchPurchaseOrder[] = [
      { id: 11, label: 'PO-B', position: 2 },
      { id: 10, label: 'PO-A', position: 1 },
      { id: 12, label: 'PO-VAZIA', position: 3 },
    ];
    const items = [
      item('B1', 11),
      item('A1', 10),
      item('A2', 10),
      item('SEM-PO', null),
      item('DESCONHECIDA', 999),
    ];
    const html = renderItemsTable(items, pos);
    expect(html.indexOf('PO-A')).toBeGreaterThan(-1);
    expect(html.indexOf('PO-A')).toBeLessThan(html.indexOf('PO-B'));
    expect(html.indexOf('PO-B')).toBeLessThan(html.indexOf('Other items'));
    expect(html).toContain(`PO-A ${pill('2 items')}`);
    expect(html).toContain(`PO-B ${pill('1 item')}`);
    expect(html).toContain(`Other items ${pill('2 items')}`);
    // padrao do portal: fundo branco, nome 15px negrito, sem fundo verde
    expect(html).not.toContain('#E6F8F3');
    expect(html).toContain('font-size:15px;font-weight:bold;color:#1F2933;');
    // separador so a partir do 2o grupo
    const titles = html.match(/<tr><td colspan="5" align="left"[^>]*>/g) ?? [];
    expect(titles).toHaveLength(3);
    expect(titles[0]).toContain('padding:14px 12px 8px;');
    expect(titles[0]).not.toContain('border-top');
    for (const t of titles.slice(1)) {
      expect(t).toContain('padding:22px 12px 8px;border-top:1px solid #ECF1EF;');
    }
    expect(html).not.toContain('PO-VAZIA');
    expect(html.match(TITLE_ROW)).toHaveLength(3);
    // agrupado: itens sem zebra (todos brancos)
    const tbody = html.slice(html.indexOf('<tbody>'));
    const rowBgs = [...tbody.matchAll(/<tr bgcolor="(#[0-9A-Fa-f]{6})" style/g)].map((m) => m[1]);
    // grupos: A (A1, A2), B (B1), Other (SEM-PO, DESCONHECIDA)
    expect(rowBgs).toEqual(['#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff']);
    expect(html.indexOf('A1')).toBeLessThan(html.indexOf('A2'));
  });

  it('d) 2 POs com todos os itens sem PO: modo plano', () => {
    const items = [item('A', null), item('B', undefined)];
    expect(groupDispatchItemsByPurchaseOrder(items, twoPos)).toBeNull();
    const html = renderItemsTable(items, twoPos);
    expect(html).toBe(renderItemsTable(items));
    expect(html.match(TITLE_ROW)).toBeNull();
    expect(html).not.toContain('Other items');
  });

  it('nao muta o array de POs e retorna null sem itens', () => {
    const pos: QuoteDispatchPurchaseOrder[] = [
      { id: 2, label: 'B', position: 2 },
      { id: 1, label: 'A', position: 1 },
    ];
    groupDispatchItemsByPurchaseOrder([item('x', 1)], pos);
    expect(pos.map((p) => p.id)).toEqual([2, 1]);
    expect(groupDispatchItemsByPurchaseOrder([], pos)).toBeNull();
  });

  it('desempata por id quando position e igual', () => {
    const pos: QuoteDispatchPurchaseOrder[] = [
      { id: 5, label: 'PO-5', position: 1 },
      { id: 3, label: 'PO-3', position: 1 },
    ];
    const groups = groupDispatchItemsByPurchaseOrder([item('a', 5), item('b', 3)], pos);
    expect(groups?.map((g) => g.label)).toEqual(['PO-3', 'PO-5']);
  });

  it('e) escapa o rotulo da PO no HTML', () => {
    const pos: QuoteDispatchPurchaseOrder[] = [
      { id: 10, label: '<b>PO & "1"</b>', position: 1 },
      { id: 11, label: 'PO-B', position: 2 },
    ];
    const html = renderItemsTable([item('A', 10), item('B', 11)], pos);
    expect(html).toContain('&lt;b&gt;PO &amp; &quot;1&quot;&lt;/b&gt;');
    expect(html).not.toContain('<b>PO');
  });

  it('j) nao usa display:flex nem display:grid', () => {
    const html = renderItemsTable([item('A', 10), item('B', 11), item('C', null)], twoPos);
    expect(html).not.toMatch(/display:\s*(flex|grid)/);
    expect(html).not.toContain('<style');
  });
});

describe('renderSections - marcadores itemsRows e itemsTable', () => {
  const vars: QuoteDispatchVars = {
    ...baseVars,
    items: [item('A1', 10), item('B1', 11), item('SEM', null)],
    purchaseOrders: twoPos,
  };

  it('f) {{itemsRows}} agrupa', () => {
    const out = renderSections('<table><tbody>{{itemsRows}}</tbody></table>', vars);
    expect(out).toContain('PO-A');
    expect(out).toContain('PO-B');
    expect(out).toContain('Other items');
  });

  it('f) {{itemsTable}} agrupa', () => {
    const out = renderSections('<div>{{itemsTable}}</div>', vars);
    expect(out).toContain('PO-A');
    expect(out).toContain('PO-B');
    expect(out).toContain('Other items');
  });
});

describe('renderItemsText', () => {
  it('g) agrupa com titulo, contador, linhas de item e rotulo cru', () => {
    const pos: QuoteDispatchPurchaseOrder[] = [
      { id: 10, label: 'PO A', position: 1 },
      { id: 11, label: 'A & B', position: 2 },
    ];
    const text = renderItemsText(
      [item('X1', 10), item('X2', 10), item('Y1', 11), item('Z1', null)],
      pos,
    );
    expect(text).toContain('PO A - 2 items');
    expect(text).toContain('A & B - 1 item');
    expect(text).not.toContain('&amp;');
    expect(text).toContain('Other items - 1 item');
    expect(text).toContain('  - X1 | FOB | Dest: Shanghai | Origin: Santos | 5 MT');
    expect(text).toBe(
      [
        'PO A - 2 items',
        '  - X1 | FOB | Dest: Shanghai | Origin: Santos | 5 MT',
        '  - X2 | FOB | Dest: Shanghai | Origin: Santos | 5 MT',
        '',
        'A & B - 1 item',
        '  - Y1 | FOB | Dest: Shanghai | Origin: Santos | 5 MT',
        '',
        'Other items - 1 item',
        '  - Z1 | FOB | Dest: Shanghai | Origin: Santos | 5 MT',
      ].join('\n'),
    );
  });
});

describe('renderDispatchFromTemplate - agrupamento por PO', () => {
  beforeEach(() => {
    getTemplateMock.mockReset();
  });

  it('h) caminho do banco: {{itemsText}} deixa de sair vazio e vem agrupado', async () => {
    getTemplateMock.mockResolvedValue({
      subject: 'Sub {{requestCode}}',
      htmlBody: '<table><tbody>{{itemsRows}}</tbody></table>',
      textBody: 'Items:\n{{itemsText}}',
    });
    const out = await renderDispatchFromTemplate({
      ...baseVars,
      items: [item('Alpha', 10), item('Beta', 11), item('Gamma', null)],
      purchaseOrders: twoPos,
    });
    expect(out.source).toBe('database');
    expect(out.text).toContain('Alpha');
    expect(out.text).toContain('Beta');
    expect(out.text).toContain('PO-A - 1 item');
    expect(out.text).toContain('PO-B - 1 item');
    expect(out.text).toContain('Other items - 1 item');
    expect(out.html).toContain('PO-A');
    expect(out.html).toContain('Other items');
  });

  it('h) caminho do banco: nome de item com {{...}} fica literal e $ nao e interpretado', async () => {
    getTemplateMock.mockResolvedValue({
      subject: 'Sub',
      htmlBody: '<p>x</p>',
      textBody: 'Items:\n{{ itemsText }}\nLink: {{portalLink}}',
    });
    const out = await renderDispatchFromTemplate({
      ...baseVars,
      items: [item('{{portalLink}} $& costs', null)],
    });
    expect(out.text).toContain('  - {{portalLink}} $& costs | FOB');
    expect(out.text).toContain('Link: https://example.com/portal/token');
  });

  it('i) fallback: HTML do arquivo .html contem os titulos de grupo', async () => {
    getTemplateMock.mockResolvedValue(null);
    const out = await renderDispatchFromTemplate({
      ...baseVars,
      items: [item('Alpha', 10), item('Beta', 11), item('Gamma', null)],
      purchaseOrders: twoPos,
    });
    expect(out.source).toBe('fallback');
    expect(out.html).toContain('PO-A');
    expect(out.html).toContain('PO-B');
    expect(out.html).toContain('Other items');
    expect(out.text).toContain('PO-A - 1 item');
    expect(out.text).toContain('Other items - 1 item');
  });

  it('fallback com 1 PO: texto igual ao formato plano de antes', async () => {
    getTemplateMock.mockResolvedValue(null);
    const out = await renderDispatchFromTemplate({
      ...baseVars,
      items: [item('Alpha', 10)],
      purchaseOrders: [{ id: 10, label: 'PO-A', position: 1 }],
    });
    expect(out.text).toContain(
      'Items:\n  - Alpha | FOB | Dest: Shanghai | Origin: Santos | 5 MT\n\nSubmit your proposal:',
    );
    expect(out.html).not.toContain('PO-A');
  });
});
