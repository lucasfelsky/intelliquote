import { describe, expect, it } from 'vitest';
import exceljs from 'exceljs';
import {
  SUPPLIER_IMPORT_COLUMNS,
  buildSupplierImportTemplate,
  isSupplierImportHeaderValid,
  parseSupplierRow,
  type SupplierImportContext,
  type SupplierImportFamilyRef,
} from '../src/utils/supplierImport';

function buildCtx(overrides: Partial<SupplierImportContext> = {}): SupplierImportContext {
  const families: SupplierImportFamilyRef[] = [{ id: 1, name: 'Silano' }];
  return {
    familiesByName: new Map(families.map((f) => [f.name.toLowerCase(), f])),
    existingNames: new Set<string>(),
    seenNames: new Map<string, number>(),
    rowNumber: 2,
    ...overrides,
  };
}

const validRow = [
  'Fornecedor Teste',
  'China',
  'https://exemplo.com',
  'FOB, CIF',
  '45',
  'Silano',
  'confiavel, rapido',
  'observacao qualquer',
  'Fulano',
  'fulano@exemplo.com',
  '11999999999',
  'Comprador',
];

describe('parseSupplierRow', () => {
  it('aceita uma linha valida completa', () => {
    const ctx = buildCtx();
    const result = parseSupplierRow(validRow, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('esperava sucesso');
    expect(result.data.name).toBe('Fornecedor Teste');
    expect(result.data.acceptedIncoterms).toEqual(['FOB', 'CIF']);
    expect(result.data.paymentTermsDays).toBe(45);
    expect(result.data.familyIds).toEqual([1]);
    expect(result.data.familyNames).toEqual(['Silano']);
    expect(result.data.tags).toEqual(['confiavel', 'rapido']);
    expect(result.data.contact).toEqual({
      name: 'Fulano',
      email: 'fulano@exemplo.com',
      phone: '11999999999',
      position: 'Comprador',
    });
  });

  it('rejeita nome vazio', () => {
    const ctx = buildCtx();
    const cells = [...validRow];
    cells[0] = '';
    const result = parseSupplierRow(cells, ctx);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('esperava falha');
    expect(result.reasons).toContain('Nome é obrigatório');
  });

  it('rejeita incoterm invalido', () => {
    const ctx = buildCtx();
    const cells = [...validRow];
    cells[3] = 'XYZ';
    const result = parseSupplierRow(cells, ctx);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('esperava falha');
    expect(result.reasons.some((r) => r.includes('Incoterm inválido: XYZ'))).toBe(true);
  });

  it('rejeita incoterm vazio', () => {
    const ctx = buildCtx();
    const cells = [...validRow];
    cells[3] = '';
    const result = parseSupplierRow(cells, ctx);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('esperava falha');
    expect(result.reasons).toContain('Informe ao menos um Incoterm');
  });

  it('prazo vazio assume 30', () => {
    const ctx = buildCtx();
    const cells = [...validRow];
    cells[4] = '';
    const result = parseSupplierRow(cells, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('esperava sucesso');
    expect(result.data.paymentTermsDays).toBe(30);
  });

  it('prazo invalido rejeita', () => {
    const ctx = buildCtx();
    const cells = [...validRow];
    cells[4] = 'abc';
    const result = parseSupplierRow(cells, ctx);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('esperava falha');
    expect(result.reasons).toContain('Prazo de pagamento deve ser um número inteiro de dias');
  });

  it('familia desconhecida rejeita', () => {
    const ctx = buildCtx();
    const cells = [...validRow];
    cells[5] = 'Familia Que Nao Existe';
    const result = parseSupplierRow(cells, ctx);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('esperava falha');
    expect(result.reasons.some((r) => r.includes('Família não encontrada: Familia Que Nao Existe'))).toBe(
      true,
    );
  });

  it('familia com case diferente resolve o id', () => {
    const ctx = buildCtx();
    const cells = [...validRow];
    cells[5] = 'SILANO';
    const result = parseSupplierRow(cells, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('esperava sucesso');
    expect(result.data.familyIds).toEqual([1]);
    expect(result.data.familyNames).toEqual(['Silano']);
  });

  it('ja cadastrado (existingNames) rejeita', () => {
    const ctx = buildCtx({ existingNames: new Set(['fornecedor teste']) });
    const result = parseSupplierRow(validRow, ctx);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('esperava falha');
    expect(result.reasons).toContain('Fornecedor já cadastrado');
  });

  it('duplicado na planilha cita a linha da 1a ocorrencia', () => {
    const ctx = buildCtx();
    const first = parseSupplierRow(validRow, { ...ctx, rowNumber: 2 });
    expect(first.ok).toBe(true);
    const second = parseSupplierRow(validRow, { ...ctx, rowNumber: 5 });
    expect(second.ok).toBe(false);
    if (second.ok) throw new Error('esperava falha');
    expect(second.reasons).toContain('Fornecedor duplicado na planilha (linha 2)');
  });

  it('contato so com nome (sem e-mail) rejeita', () => {
    const ctx = buildCtx();
    const cells = [...validRow];
    cells[9] = '';
    const result = parseSupplierRow(cells, ctx);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('esperava falha');
    expect(result.reasons).toContain(
      'Contato: nome e e-mail são obrigatórios quando algum campo de contato é preenchido',
    );
  });

  it('e-mail de contato invalido rejeita', () => {
    const ctx = buildCtx();
    const cells = [...validRow];
    cells[9] = 'nao-e-email';
    const result = parseSupplierRow(cells, ctx);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('esperava falha');
    expect(result.reasons).toContain('E-mail do contato inválido');
  });

  it('so telefone preenchido (sem nome/e-mail) rejeita', () => {
    const ctx = buildCtx();
    const cells = [...validRow];
    cells[8] = '';
    cells[9] = '';
    cells[11] = '';
    const result = parseSupplierRow(cells, ctx);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('esperava falha');
    expect(result.reasons).toContain(
      'Contato: nome e e-mail são obrigatórios quando algum campo de contato é preenchido',
    );
  });

  it('sem nenhum campo de contato preenchido, contact fica null', () => {
    const ctx = buildCtx();
    const cells = [...validRow];
    cells[8] = '';
    cells[9] = '';
    cells[10] = '';
    cells[11] = '';
    const result = parseSupplierRow(cells, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('esperava sucesso');
    expect(result.data.contact).toBeNull();
  });
});

describe('isSupplierImportHeaderValid', () => {
  it('aceita o cabecalho oficial', () => {
    expect(isSupplierImportHeaderValid([...SUPPLIER_IMPORT_COLUMNS])).toBe(true);
  });

  it('aceita o cabecalho sem acentos e sem asterisco', () => {
    const header = [
      'Nome',
      'Pais',
      'Website',
      'Incoterms',
      'Prazo pagamento (dias)',
      'Familias',
      'Tags',
      'Observacoes',
      'Contato nome',
      'Contato e-mail',
      'Contato telefone',
      'Contato cargo',
    ];
    expect(isSupplierImportHeaderValid(header)).toBe(true);
  });

  it('rejeita colunas trocadas', () => {
    const header = [...SUPPLIER_IMPORT_COLUMNS];
    const swapped = [header[1], header[0], ...header.slice(2)] as string[];
    expect(isSupplierImportHeaderValid(swapped)).toBe(false);
  });
});

describe('buildSupplierImportTemplate', () => {
  it('gera um xlsx cuja linha 1 bate com SUPPLIER_IMPORT_COLUMNS', async () => {
    const buffer = await buildSupplierImportTemplate();
    const workbook = new exceljs.Workbook();
    await workbook.xlsx.load(buffer as any);
    const sheet = workbook.worksheets[0];
    expect(sheet).toBeDefined();
    const headerCells: string[] = [];
    for (let i = 1; i <= SUPPLIER_IMPORT_COLUMNS.length; i++) {
      headerCells.push(String(sheet!.getRow(1).getCell(i).text ?? ''));
    }
    expect(headerCells).toEqual([...SUPPLIER_IMPORT_COLUMNS]);
  });
});
