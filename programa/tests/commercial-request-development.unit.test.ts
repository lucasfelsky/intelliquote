// Solicitacao de desenvolvimento (item novo sem catalogo): normalizacao do nome e schemas Zod.
import { describe, expect, it } from 'vitest';
import { cleanProposedName, normalizeItemNameKey } from '../src/utils/commercialItemName';
import {
  commercialRequestCreateSchema,
  commercialRequestListQuerySchema,
} from '../src/validators/domain';
import { commercialRequestLinkCatalogSchema } from '../src/validators/commercialRequestDevelopment';

const BASE = { quantity: 10, unit: 'KG' };

function parseItems(items: unknown[], extra: Record<string, unknown> = {}) {
  return commercialRequestCreateSchema.safeParse({ items, ...extra });
}

describe('commercialItemName', () => {
  it('cleanProposedName: trim e espacos internos colapsados', () => {
    expect(cleanProposedName('  Acido   Citrico  ')).toBe('Acido Citrico');
  });

  it('normalizeItemNameKey: sem acento, minusculas e espacos colapsados', () => {
    expect(normalizeItemNameKey('  Ácido   Cítrico ')).toBe('acido citrico');
  });
});

describe('commercialRequestCreateSchema - item de catalogo ou item novo', () => {
  it('aceita item de catalogo', () => {
    expect(parseItems([{ catalogItemId: 10, ...BASE }]).success).toBe(true);
  });

  it('aceita item novo e limpa o nome', () => {
    const parsed = parseItems([{ proposedName: '  Resina   Nova  ', notes: ' obs ', ...BASE }]);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.items[0].proposedName).toBe('Resina Nova');
      expect(parsed.data.items[0].notes).toBe('obs');
      expect(parsed.data.items[0].catalogItemId).toBeUndefined();
    }
  });

  it('recusa os dois juntos', () => {
    const parsed = parseItems([{ catalogItemId: 10, proposedName: 'Resina Nova', ...BASE }]);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.map((i) => i.message)).toContain(
        'Informe o item do catalogo ou o nome do item novo.',
      );
    }
  });

  it('recusa nenhum dos dois', () => {
    const parsed = parseItems([{ ...BASE }]);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.map((i) => i.message)).toContain(
        'Informe o item do catalogo ou o nome do item novo.',
      );
    }
  });

  it('recusa nome com 1 caractere e com mais de 120', () => {
    expect(parseItems([{ proposedName: 'A', ...BASE }]).success).toBe(false);
    expect(parseItems([{ proposedName: 'A'.repeat(121), ...BASE }]).success).toBe(false);
    expect(parseItems([{ proposedName: 'A'.repeat(120), ...BASE }]).success).toBe(true);
  });

  it('recusa observacao do item acima de 500 caracteres', () => {
    expect(parseItems([{ proposedName: 'Resina Nova', notes: 'x'.repeat(501), ...BASE }]).success).toBe(
      false,
    );
    expect(parseItems([{ proposedName: 'Resina Nova', notes: 'x'.repeat(500), ...BASE }]).success).toBe(
      true,
    );
  });

  it('recusa item novo repetido pela chave normalizada', () => {
    const parsed = parseItems([
      { proposedName: 'Acido X', ...BASE },
      { proposedName: 'ÁCIDO  x', ...BASE },
    ]);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.map((i) => i.message)).toContain(
        'Ha itens novos repetidos na solicitacao.',
      );
    }
  });

  it('continua recusando item de catalogo repetido', () => {
    const parsed = parseItems([
      { catalogItemId: 10, ...BASE },
      { catalogItemId: 10, ...BASE },
    ]);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.map((i) => i.message)).toContain(
        'Ha itens repetidos na solicitacao.',
      );
    }
  });

  it('aceita misturar catalogo e item novo', () => {
    expect(
      parseItems([
        { catalogItemId: 10, ...BASE },
        { proposedName: 'Resina Nova', ...BASE },
      ]).success,
    ).toBe(true);
  });

  it('customerName ausente, vazio ou so espacos vira null/ausente', () => {
    const items = [{ catalogItemId: 10, ...BASE }];
    const ausente = parseItems(items);
    expect(ausente.success).toBe(true);
    if (ausente.success) expect(ausente.data.customerName ?? null).toBeNull();

    for (const customerName of ['', '   ']) {
      const parsed = parseItems(items, { customerName });
      expect(parsed.success).toBe(true);
      if (parsed.success) expect(parsed.data.customerName).toBeNull();
    }
  });
});

describe('commercialRequestListQuerySchema - quoteRequestId', () => {
  it('aceita quoteRequestId numerico (string da query) e ignora vazio', () => {
    expect(commercialRequestListQuerySchema.parse({ quoteRequestId: '7' }).quoteRequestId).toBe(7);
    expect(commercialRequestListQuerySchema.parse({ quoteRequestId: '' }).quoteRequestId).toBeUndefined();
    expect(commercialRequestListQuerySchema.parse({}).quoteRequestId).toBeUndefined();
  });

  it('recusa quoteRequestId invalido', () => {
    expect(commercialRequestListQuerySchema.safeParse({ quoteRequestId: '0' }).success).toBe(false);
    expect(commercialRequestListQuerySchema.safeParse({ quoteRequestId: 'abc' }).success).toBe(false);
    expect(commercialRequestListQuerySchema.safeParse({ quoteRequestId: '2147483648' }).success).toBe(
      false,
    );
  });
});

describe('commercialRequestLinkCatalogSchema', () => {
  it('aceita id inteiro positivo ate o limite do Int do Postgres', () => {
    expect(commercialRequestLinkCatalogSchema.safeParse({ catalogItemId: 5 }).success).toBe(true);
    expect(commercialRequestLinkCatalogSchema.safeParse({ catalogItemId: 2147483647 }).success).toBe(true);
  });

  it('recusa zero, fracao, acima do limite e ausente', () => {
    for (const catalogItemId of [0, -1, 1.5, 2147483648, undefined, '5']) {
      expect(commercialRequestLinkCatalogSchema.safeParse({ catalogItemId }).success).toBe(false);
    }
  });
});
