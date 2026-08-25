import { describe, expect, it } from 'vitest';
import {
  renderItemsTable,
  renderSections,
  type QuoteDispatchItem,
  type QuoteDispatchVars,
} from '../src/mailer/renderQuoteDispatch';

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

const fullItem: QuoteDispatchItem = {
  marketName: 'Sodium Hydroxide',
  quantity: 10,
  unit: 'MT',
  desiredIncoterm: 'FOB',
  originPort: 'Santos',
  destinationPort: 'Rotterdam',
};

const bareItem: QuoteDispatchItem = {
  marketName: 'Sulfuric Acid',
  quantity: 5,
  unit: 'MT',
};

describe('renderItemsTable', () => {
  it('emits a fixed-layout table at width:100%', () => {
    const html = renderItemsTable([fullItem]);
    expect(html).toContain('table-layout:fixed');
    expect(html).toContain('width:100%');
  });

  it('emits a colgroup with the 5 fixed column widths', () => {
    const html = renderItemsTable([fullItem]);
    expect(html).toContain('<colgroup>');
    expect(html).toContain('width:182px');
    expect(html).toContain('width:80px');
    expect(html).toContain('width:100px');
    expect(html).toContain('width:120px');
    const eightyMatches = html.match(/width:80px/g) ?? [];
    // QTY and INCOTERM columns both use 80px (colgroup <col> + <th> for each)
    expect(eightyMatches.length).toBeGreaterThanOrEqual(2);
  });

  it('emits a thead with the 5 expected labels', () => {
    const html = renderItemsTable([fullItem]);
    expect(html).toContain('<thead>');
    expect(html).toContain('PRODUCT');
    expect(html).toContain('QTY');
    expect(html).toContain('INCOTERM');
    expect(html).toContain('ORIGIN');
    expect(html).toContain('DESTINATION');
  });

  it('reuses renderItemsRows output for the tbody with item data', () => {
    const html = renderItemsTable([fullItem]);
    expect(html).toContain('<tbody>');
    expect(html).toContain('Sodium Hydroxide');
    expect(html).toContain('10 MT');
    expect(html).toContain('FOB');
    expect(html).toContain('Santos');
    expect(html).toContain('Rotterdam');
  });

  it('renders an em-dash placeholder when incoterm/origin/destination are missing', () => {
    const html = renderItemsTable([bareItem]);
    expect(html).toContain('Sulfuric Acid');
    expect(html).toContain('5 MT');
    const dashCount = html.split('&#8212;').length - 1;
    expect(dashCount).toBe(3);
  });

  it('escapes HTML in marketName', () => {
    const dangerousItem: QuoteDispatchItem = {
      marketName: '<script>alert("x")</script> & Co',
      quantity: 1,
      unit: 'KG',
    };
    const html = renderItemsTable([dangerousItem]);
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp;');
    expect(html).toContain('&quot;');
  });

  it('renders the empty state with colspan=5 and the fallback message', () => {
    const html = renderItemsTable([]);
    expect(html).toContain('colspan="5"');
    expect(html).toContain('No items listed');
  });
});

describe('{{itemsTable}} marker via renderSections', () => {
  it('replaces {{itemsTable}} with the rendered table (no literal marker left behind)', () => {
    const template = '<div>{{itemsTable}}</div>';
    const vars: QuoteDispatchVars = { ...baseVars, items: [fullItem] };
    const out = renderSections(template, vars);
    expect(out).not.toContain('{{itemsTable}}');
    expect(out).toContain('<table');
    expect(out).toContain('Sodium Hydroxide');
    expect(out).toContain('table-layout:fixed');
  });

  it('keeps {{itemsRows}} working (compat regression check)', () => {
    const template = '<tbody>{{itemsRows}}</tbody>';
    const vars: QuoteDispatchVars = { ...baseVars, items: [fullItem] };
    const out = renderSections(template, vars);
    expect(out).not.toContain('{{itemsRows}}');
    expect(out).toContain('Sodium Hydroxide');
    expect(out).not.toContain('<colgroup>');
  });
});
