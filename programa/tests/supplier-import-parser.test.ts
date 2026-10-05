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
    expect(result.data.contacts).toEqual([
      {
        name: 'Fulano',
        email: 'fulano@exemplo.com',
        phone: '11999999999',
        position: 'Comprador',
      },
    ]);
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
    expect(result.reasons).toContain('E-mail do contato inválido: nao-e-email');
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

  it('sem nenhum campo de contato preenchido, contacts fica vazio', () => {
    const ctx = buildCtx();
    const cells = [...validRow];
    cells[8] = '';
    cells[9] = '';
    cells[10] = '';
    cells[11] = '';
    const result = parseSupplierRow(cells, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('esperava sucesso');
    expect(result.data.contacts).toEqual([]);
  });
});

describe('parseSupplierRow - multiplos contatos', () => {
  function rowWithContacts(name: string, email: string, phone = '', position = ''): string[] {
    const cells = [...validRow];
    cells[8] = name;
    cells[9] = email;
    cells[10] = phone;
    cells[11] = position;
    return cells;
  }

  function expectFail(cells: string[]): string[] {
    const result = parseSupplierRow(cells, buildCtx());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('esperava falha');
    return result.reasons;
  }

  function expectOk(cells: string[]) {
    const result = parseSupplierRow(cells, buildCtx());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('esperava sucesso');
    return result.data;
  }

  it('(a) 2 contatos separados por ; ficam pareados e em ordem', () => {
    const data = expectOk(
      rowWithContacts('Ana; Beto', 'ana@x.com; beto@y.com', '111;222', 'Compras;Diretor'),
    );
    expect(data.contacts).toEqual([
      { name: 'Ana', email: 'ana@x.com', phone: '111', position: 'Compras' },
      { name: 'Beto', email: 'beto@y.com', phone: '222', position: 'Diretor' },
    ]);
    expect(data.contacts[0]?.email).toBe('ana@x.com');
  });

  it('(b) quebra de linha separa nomes e e-mails (inclusive \\r\\n)', () => {
    const data = expectOk(rowWithContacts('Ana\nBeto', 'ana@x.com\r\nbeto@y.com'));
    expect(data.contacts.map((c) => c.name)).toEqual(['Ana', 'Beto']);
    expect(data.contacts.map((c) => c.email)).toEqual(['ana@x.com', 'beto@y.com']);
  });

  it('(c) virgula separa e-mails, mas nao separa nome', () => {
    const data = expectOk(rowWithContacts('Silva, Ana', 'ana@x.com'));
    expect(data.contacts).toHaveLength(1);
    expect(data.contacts[0]?.name).toBe('Silva, Ana');

    const two = expectOk(rowWithContacts('Ana;Beto', 'ana@x.com, beto@y.com'));
    expect(two.contacts.map((c) => c.email)).toEqual(['ana@x.com', 'beto@y.com']);
  });

  it('(d) quantidade de nomes diferente da de e-mails rejeita', () => {
    const reasons = expectFail(rowWithContacts('Ana;Beto', 'a@x.com;b@y.com;c@z.com'));
    expect(reasons).toContain(
      'Contato: 2 nomes e 3 e-mails — informe a mesma quantidade, separados por ;',
    );
  });

  it('(e) gera 1 motivo por e-mail invalido sem citar os validos', () => {
    const reasons = expectFail(rowWithContacts('A;B;C', 'a@x.com;nao-e-email;b@y.com'));
    expect(reasons).toContain('E-mail do contato inválido: nao-e-email');
    expect(reasons.some((r) => r.includes('a@x.com') || r.includes('b@y.com'))).toBe(false);
  });

  it('(f) telefone com menos itens deixa o restante null', () => {
    const data = expectOk(rowWithContacts('Ana;Beto', 'a@x.com;b@y.com', '111'));
    expect(data.contacts[0]?.phone).toBe('111');
    expect(data.contacts[1]?.phone).toBeNull();
  });

  it('(g) telefone com mais itens que e-mails rejeita', () => {
    const reasons = expectFail(rowWithContacts('Ana', 'a@x.com', '111;222'));
    expect(reasons).toContain(
      'Contato: 2 telefones para 1 e-mail — não pode haver mais telefones que e-mails',
    );
  });

  it('(g2) cargo com mais itens que e-mails rejeita', () => {
    const reasons = expectFail(rowWithContacts('Ana;Beto', 'a@x.com;b@y.com', '', 'x;y;z'));
    expect(reasons).toContain(
      'Contato: 3 cargos para 2 e-mails — não pode haver mais cargos que e-mails',
    );
  });

  it('(h) item vazio no final e ignorado', () => {
    const data = expectOk(rowWithContacts('Ana;', 'a@x.com;'));
    expect(data.contacts).toHaveLength(1);
    expect(data.contacts[0]?.email).toBe('a@x.com');
  });

  it('(i) item vazio no meio de e-mail ou nome rejeita', () => {
    const emailReasons = expectFail(rowWithContacts('A;B;C', 'a@x.com;;b@y.com'));
    expect(emailReasons).toContain(
      'Contato: item vazio na coluna "Contato e-mail" (posição 2) — remova o separador sobrando',
    );
    const nameReasons = expectFail(rowWithContacts('A;;C', 'a@x.com;b@y.com;c@z.com'));
    expect(nameReasons).toContain(
      'Contato: item vazio na coluna "Contato nome" (posição 2) — remova o separador sobrando',
    );
  });

  it('(j) telefone vazio no meio vira null naquela posicao', () => {
    const data = expectOk(rowWithContacts('A;B;C', 'a@x.com;b@y.com;c@z.com', '111;;333'));
    expect(data.contacts[0]?.phone).toBe('111');
    expect(data.contacts[1]?.phone).toBeNull();
    expect(data.contacts[2]?.phone).toBe('333');
  });

  it('(k) e-mail duplicado na linha (case-insensitive) rejeita', () => {
    const reasons = expectFail(rowWithContacts('Ana;Beto', 'a@x.com;A@X.com'));
    expect(reasons).toContain('E-mail do contato duplicado na linha: a@x.com');
  });

  it('(l) mais de 20 contatos rejeita; 20 aceita', () => {
    const build = (count: number) => ({
      names: Array.from({ length: count }, (_, i) => `Contato ${i + 1}`).join(';'),
      emails: Array.from({ length: count }, (_, i) => `c${i + 1}@x.com`).join(';'),
    });
    const over = build(21);
    const reasons = expectFail(rowWithContacts(over.names, over.emails));
    expect(reasons).toContain('Contato: no máximo 20 contatos por fornecedor');

    const exact = build(20);
    const data = expectOk(rowWithContacts(exact.names, exact.emails));
    expect(data.contacts).toHaveLength(20);
  });

  it('coluna de contato so com separadores equivale a vazia', () => {
    const data = expectOk(rowWithContacts(';', ';;', '', ''));
    expect(data.contacts).toEqual([]);
  });

  it('dado sem e-mail (so telefone) mantem a mensagem de obrigatoriedade', () => {
    const reasons = expectFail(rowWithContacts('', '', '111;222', ''));
    expect(reasons).toContain(
      'Contato: nome e e-mail são obrigatórios quando algum campo de contato é preenchido',
    );
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

  it('(m) a aba Instruções explica o formato de múltiplos contatos', async () => {
    const buffer = await buildSupplierImportTemplate();
    const workbook = new exceljs.Workbook();
    await workbook.xlsx.load(buffer as any);
    const sheet = workbook.getWorksheet('Instruções');
    expect(sheet).toBeDefined();
    let emailInstruction = '';
    sheet!.eachRow((row) => {
      if (String(row.getCell(1).text) === 'Contato e-mail') {
        emailInstruction = String(row.getCell(2).text);
      }
    });
    expect(emailInstruction).toContain('ponto e vírgula (;)');
  });
});
