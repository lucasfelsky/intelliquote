import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeNote, type PdNote } from '../src/lib/pipedriveClient';
import {
  NOTE_HTML_MAX_CHARS,
  NOTE_MAX_ITEMS,
  NOTE_TEXT_MAX_CHARS,
  extractMentions,
  noteHtmlToText,
  parseDealNote,
  parseQuantityKg,
  selectItemsNote,
  type NoteCatalogProduct,
} from '../src/utils/indentPipedriveNote';

// Tudo FICTICIO (repositorio publico): notas no formato real do Pipedrive, ids 9000xx.
const COMEX_ID = 900302; // "Equipe Compras" de teste
const SELLER_ID = 900301;
const fixtureNotes = (JSON.parse(readFileSync(join(resolve(__dirname, 'fixtures', 'pipedrive'), 'notes-v1.json'), 'utf8')) as { data: unknown[] }).data.map(
  normalizeNote,
);
const LIST_NOTE = fixtureNotes[0] as PdNote;
const REPLY_NOTE = fixtureNotes[1] as PdNote;

const CATALOG: NoteCatalogProduct[] = [
  { id: 11, name: 'Resina Exemplo 223', acronym: 'RXE', synonyms: [] },
  { id: 12, name: 'Solvente Teste 99%', acronym: null, synonyms: ['Solvente T99'] },
];

function note(id: number, authorId: number | null, addTime: string, html: string): PdNote {
  const date = new Date(addTime);
  return { id, authorId, addTime: date, updateTime: date, html };
}

const LIST_TEXT =
  '@Equipe Compras\nBom dia, podem cotar para o cliente?\n\nRESINA EXEMPLO 223 (RXE)\t2.000\nSOLVENTE TESTE 99%\t25.000\n\nCFR Santos - Fabricante Exemplo';

describe('noteHtmlToText', () => {
  it('nota real da fixture: menção, &nbsp;, div, br e tabela de 2 colunas viram texto com TAB', () => {
    expect(noteHtmlToText(LIST_NOTE.html)).toBe(LIST_TEXT);
  });

  it('remove script e style com conteudo, inclusive sem fechamento, e nao mantem tag nem atributo de evento', () => {
    expect(noteHtmlToText('<p>Oi</p><script>alert(1)</script><style>p{color:red}</style><p>fim</p>')).toBe('Oi\nfim');
    expect(noteHtmlToText('<p>a</p><SCRIPT type="x">alert(1)')).toBe('a');
    expect(noteHtmlToText('a<img src=x onerror=alert(1)>b')).toBe('ab');
    expect(noteHtmlToText('ab<img src=x onerror=alert(1)')).toBe('ab');
    const hostile = noteHtmlToText('<a href="javascript:alert(1)" onclick="x()">link</a><!-- <script>x</script> -->texto');
    expect(hostile).toBe('linktexto');
    expect(hostile).not.toMatch(/[<>]|onerror|onclick|javascript/);
  });

  it('entidades nomeadas e numericas (decimal e hex); invalidas mantem o literal; sem dupla decodificacao', () => {
    expect(noteHtmlToText('A&nbsp;B &amp; C &lt;x&gt; &quot;q&quot; &#39;s&#39; &apos;t&apos;')).toBe('A B & C <x> "q" \'s\' \'t\'');
    expect(noteHtmlToText('&#65;&#x42;&#X43;')).toBe('ABC');
    expect(noteHtmlToText('&#0; &#1114112; &#xD800; &#99999999;')).toBe('&#0; &#1114112; &#xD800; &#99999999;');
    expect(noteHtmlToText('&amp;lt;b&amp;gt;')).toBe('&lt;b&gt;');
  });

  it('o texto decodificado nunca e tratado como tag (resultado e so texto)', () => {
    expect(noteHtmlToText('&lt;script&gt;alert(1)&lt;/script&gt;')).toBe('<script>alert(1)</script>');
  });

  it('colapsa espacos, apara linhas e mantem no maximo 1 linha vazia seguida', () => {
    expect(noteHtmlToText('<div>  a   b  </div><div><br></div><div><br></div><div><br></div><div>c</div>')).toBe('a b\n\nc');
    expect(noteHtmlToText('  \n\n texto \r\n\r\n\r\n fim ')).toBe('texto\n\nfim');
  });

  it('quebras: br, p, li e h1-h6; celulas de tabela ficam na mesma linha separadas por TAB', () => {
    expect(noteHtmlToText('a<br>b<br/>c<p>d</p><ul><li>e</li><li>f</li></ul><h2>g</h2>h')).toBe('a\nb\nc\nd\ne\nf\ng\nh');
    expect(noteHtmlToText('<table><tr><th>Produto</th><th>Qtd</th></tr><tr><td>A<br>B</td><td>1</td></tr></table>')).toBe('Produto\tQtd\nA B\t1');
  });

  it('"a < b" nao e tag', () => {
    expect(noteHtmlToText('1 < 2 e 3 > 2')).toBe('1 < 2 e 3 > 2');
  });

  it('entrada truncada em 100.000 caracteres e saida em 20.000', () => {
    const tail = `${'x'.repeat(NOTE_HTML_MAX_CHARS)}SEGREDO-APOS-O-LIMITE`;
    const out = noteHtmlToText(tail);
    expect(out).not.toContain('SEGREDO');
    expect(out.length).toBe(NOTE_TEXT_MAX_CHARS);
  });

  // Cada entrada e medida POR CHAMADA (nao somada): o limite de 100.000 caracteres nao protege o pior caso.
  const pathological: Array<[string, () => string]> = [
    ['<script> repetido', () => '<script>'.repeat(14_000)],
    ['<style> repetido', () => '<style>'.repeat(14_000)],
    ['< e a repetidos sem >', () => '<a'.repeat(50_000)],
    ['<td> repetido sem fechamento', () => '<td>'.repeat(25_000)],
    ['&# repetido', () => '&#'.repeat(50_000)],
    ['a + 99.000 TABs + b', () => 'a' + '\t'.repeat(99_000) + 'b'],
    ['99.999 TABs + x', () => '\t'.repeat(99_999) + 'x'],
    ['99.999 espacos + x', () => ' '.repeat(99_999) + 'x'],
    ['</td> repetido dentro de div', () => '<div>a' + '</td>'.repeat(19_000) + 'b</div>'],
    ['comentarios abertos', () => '<!--'.repeat(25_000)],
    ['entidades validas repetidas', () => '&amp;'.repeat(19_000)],
  ];
  it.each(pathological)('entrada patologica (%s) termina em menos de 500 ms', (_label, build) => {
    const input = build();
    const started = performance.now();
    noteHtmlToText(input);
    expect(performance.now() - started).toBeLessThan(500);
  });

  it('o fim de <script> e achado sem desalinhar indices (U+0130 muda o comprimento em toLowerCase)', () => {
    const dotted = String.fromCharCode(0x130).repeat(30);
    expect(noteHtmlToText(`<script>${dotted}</script><div>visivel</div><div>fim</div>`)).toBe('visivel\nfim');
    expect(noteHtmlToText(`<STYLE>${dotted}</STYLE><div>visivel</div>`)).toBe('visivel');
  });

  it('entrada nula ou vazia', () => {
    expect(noteHtmlToText('')).toBe('');
    expect(noteHtmlToText(undefined as unknown as string)).toBe('');
  });
});

describe('extractMentions', () => {
  it('le data-mentions="AUTOR:MENCIONADO" em ordem', () => {
    expect(extractMentions(LIST_NOTE.html)).toEqual([{ authorId: SELLER_ID, mentionedId: COMEX_ID }]);
    expect(extractMentions(REPLY_NOTE.html)).toEqual([{ authorId: COMEX_ID, mentionedId: SELLER_ID }]);
    expect(extractMentions('<a data-mentions="1:2">a</a><a data-mentions="3:4">b</a>')).toHaveLength(2);
    expect(extractMentions('<a data-mentions="x:2">a</a> sem menção')).toEqual([]);
  });
});

describe('parseQuantityKg', () => {
  it('so quantidade pt-BR: milhar com ponto, decimal com virgula e unidade', () => {
    expect(parseQuantityKg('2.000')).toBe(2000);
    expect(parseQuantityKg('500.000 kg')).toBe(500000);
    expect(parseQuantityKg('2,5 t')).toBe(2500);
    expect(parseQuantityKg('25 MT')).toBe(25000);
    expect(parseQuantityKg('1,5 ton')).toBe(1500);
    expect(parseQuantityKg('0,5')).toBe(0.5);
    expect(parseQuantityKg('12 kgs')).toBe(12);
    expect(parseQuantityKg('99999999999')).toBeNull();
    expect(parseQuantityKg('0')).toBeNull();
    expect(parseQuantityKg('SOLVENTE TESTE 99%')).toBeUndefined();
    expect(parseQuantityKg('223 (RXE)')).toBeUndefined();
  });
});

describe('parseDealNote: tabela', () => {
  it('tabela de 2 colunas sem cabecalho (formato real): itens, quantidade e metadados da linha solta', () => {
    const parsed = parseDealNote(LIST_TEXT);
    expect(parsed.mode).toBe('table');
    expect(parsed.items).toEqual([
      { text: 'RESINA EXEMPLO 223 (RXE)', quantityKg: 2000, productId: null, line: 4 },
      { text: 'SOLVENTE TESTE 99%', quantityKg: 25000, productId: null, line: 5 },
    ]);
    expect(parsed.incoterm).toBe('CFR');
    expect(parsed.destination).toBe('Santos');
    expect(parsed.supplierHint).toBe('Fabricante Exemplo');
    expect(parsed.ignoredLines).toBe(2); // linha da mencao e saudacao com pergunta
  });

  it('casa com o catalogo por nome, sigla entre parenteses e sinonimo; ambiguo ou sem casamento -> null', () => {
    const parsed = parseDealNote(LIST_TEXT, CATALOG);
    expect(parsed.items.map((item) => item.productId)).toEqual([11, 12]);

    const bySynonym = parseDealNote('Solvente T99\t1.000', CATALOG);
    expect(bySynonym.items[0]?.productId).toBe(12);
    const byAcronym = parseDealNote('RXE\t1.000', CATALOG);
    expect(byAcronym.items[0]?.productId).toBe(11);

    const ambiguous = parseDealNote(LIST_TEXT, [
      { id: 1, name: 'Resina A', acronym: 'RXE' },
      { id: 2, name: 'Resina B', acronym: 'rxe' },
    ]);
    expect(ambiguous.items[0]?.productId).toBeNull();
    expect(parseDealNote(LIST_TEXT, []).items[0]?.productId).toBeNull();
  });

  it('tabela com cabecalho mapeia produto, quantidade e incoterm/porto/fornecedor', () => {
    const text = [
      'Produto\tQuantidade\tIncoterm\tPorto\tFornecedor',
      'RESINA EXEMPLO 223 (RXE)\t2.000\tCFR\tSantos\tFabricante Exemplo',
      'SOLVENTE TESTE 99%\t2,5 t\tCFR\tSantos\tFabricante Exemplo',
    ].join('\n');
    const parsed = parseDealNote(text);
    expect(parsed.mode).toBe('table');
    expect(parsed.items.map((item) => [item.text, item.quantityKg, item.line])).toEqual([
      ['RESINA EXEMPLO 223 (RXE)', 2000, 2],
      ['SOLVENTE TESTE 99%', 2500, 3],
    ]);
    expect([parsed.incoterm, parsed.destination, parsed.supplierHint]).toEqual(['CFR', 'Santos', 'Fabricante Exemplo']);
  });

  it('cabecalho com colunas invertidas e outro nome (Descricao / Qtd)', () => {
    const parsed = parseDealNote('Qtd (kg)\tDescrição do produto\n1.500\tRESINA EXEMPLO 223 (RXE)');
    expect(parsed.items).toEqual([{ text: 'RESINA EXEMPLO 223 (RXE)', quantityKg: 1500, productId: null, line: 2 }]);
  });

  it('linha de tabela sem quantidade vira item sem quantidade; linha so de incoterm vira metadado', () => {
    const parsed = parseDealNote('SOLVENTE TESTE 99%\t\tobs\nRESINA EXEMPLO 223 (RXE)\t3.000\nFOB\tSantos\tFabricante Exemplo');
    expect(parsed.items.map((item) => [item.text, item.quantityKg])).toEqual([
      ['SOLVENTE TESTE 99%', null],
      ['RESINA EXEMPLO 223 (RXE)', 3000],
    ]);
    expect([parsed.incoterm, parsed.destination, parsed.supplierHint]).toEqual(['FOB', 'Santos', 'Fabricante Exemplo']);
  });

  it('limita a 50 itens', () => {
    const rows = Array.from({ length: 60 }, (_, index) => `PRODUTO EXEMPLO ${String.fromCharCode(65 + (index % 26))}\t${index + 1}.000`);
    const parsed = parseDealNote(rows.join('\n'));
    expect(parsed.items).toHaveLength(NOTE_MAX_ITEMS);
    expect(parsed.ignoredLines).toBe(10);
  });
});

describe('parseDealNote: linhas de texto', () => {
  it('"RESINA EXEMPLO 223 (RXE)  2.000" = 2000; numero no meio do nome nao e quantidade; 99% sem quantidade', () => {
    const parsed = parseDealNote('Cotar RESINA EXEMPLO 223 (RXE)  2.000\nSOLVENTE TESTE 99%\nCFR Santos - Fabricante Exemplo');
    expect(parsed.mode).toBe('lines');
    expect(parsed.items).toEqual([
      { text: 'RESINA EXEMPLO 223 (RXE)', quantityKg: 2000, productId: null, line: 1 },
      { text: 'SOLVENTE TESTE 99%', quantityKg: null, productId: null, line: 2 },
    ]);
    expect([parsed.incoterm, parsed.destination, parsed.supplierHint]).toEqual(['CFR', 'Santos', 'Fabricante Exemplo']);
  });

  it('quantidade na linha seguinte vai para o item anterior, com incoterm no fim da linha de quantidade', () => {
    const parsed = parseDealNote('RESINA EXEMPLO 223 (RXE)\n500.000 kg - CFR Santos');
    expect(parsed.items).toEqual([{ text: 'RESINA EXEMPLO 223 (RXE)', quantityKg: 500000, productId: null, line: 1 }]);
    expect([parsed.incoterm, parsed.destination, parsed.supplierHint]).toEqual(['CFR', 'Santos', null]);
  });

  it('linhas longas de separadores ou numeros terminam rapido', () => {
    const inputs = [
      `${'-'.repeat(19_000)}x 1.000`,
      `PRODUTO EXEMPLO ${'-,'.repeat(9_000)}x 1.000`,
      `${'1.000 '.repeat(3_000)}x`,
      `${'('.repeat(19_000)}`,
      `PRODUTO (${'a'.repeat(19_000)}`,
      `${'a '.repeat(9_000)}2.000`,
      `CFR ${'a - '.repeat(5_000)}`,
      `${'x\t'.repeat(9_000)}`,
    ];
    for (const input of inputs) {
      const started = performance.now();
      parseDealNote(input);
      expect(performance.now() - started).toBeLessThan(500);
    }
  });

  it('toneladas: 2,5 t = 2500 e 25 MT = 25000; > 1e9 vira nulo', () => {
    const parsed = parseDealNote('ACIDO EXEMPLO 2,5 t\nBASE TESTE 25 MT\nSAL EXEMPLO 99999999999');
    expect(parsed.items.map((item) => [item.text, item.quantityKg])).toEqual([
      ['ACIDO EXEMPLO', 2500],
      ['BASE TESTE', 25000],
      ['SAL EXEMPLO', null],
    ]);
  });

  it('ignora vazias, mencoes, perguntas, saudacoes e pedidos', () => {
    const parsed = parseDealNote(
      ['@Equipe Compras', 'Bom dia!', 'Boa tarde, tudo bem?', 'Por favor cotar:', 'Obrigada', 'Podem cotar o item abaixo', '', 'RESINA EXEMPLO 223 (RXE) 1.000'].join('\n'),
    );
    expect(parsed.items.map((item) => item.text)).toEqual(['RESINA EXEMPLO 223 (RXE)']);
    expect(parsed.ignoredLines).toBe(6);
  });

  it('marcadores de lista no inicio da linha sao removidos', () => {
    const parsed = parseDealNote('- RESINA EXEMPLO 223 (RXE) 1.000\n• SOLVENTE TESTE 99% 2.000');
    expect(parsed.items.map((item) => item.text)).toEqual(['RESINA EXEMPLO 223 (RXE)', 'SOLVENTE TESTE 99%']);
  });

  it('texto corrido sem quantidade nao gera item (resposta sem tabela)', () => {
    const reply = parseDealNote(noteHtmlToText(REPLY_NOTE.html));
    expect(reply).toMatchObject({ mode: 'none', items: [] });
    const plain = parseDealNote('Recebido, retornamos com os precos amanha.');
    expect(plain).toMatchObject({ mode: 'none', items: [] });
    expect(plain.ignoredLines).toBe(1);
  });

  it('incoterm em qualquer caixa e sem fornecedor; so o primeiro prevalece', () => {
    const parsed = parseDealNote('cif Paranagua\nFOB Santos - Fabricante Exemplo');
    expect([parsed.incoterm, parsed.destination, parsed.supplierHint]).toEqual(['CIF', 'Paranagua', null]);
  });

  it('entrada vazia ou nula', () => {
    expect(parseDealNote('')).toMatchObject({ mode: 'none', items: [], incoterm: null, ignoredLines: 0 });
    expect(parseDealNote(undefined as unknown as string)).toMatchObject({ mode: 'none', items: [] });
  });
});

describe('selectItemsNote', () => {
  it('descarta a resposta da equipe Compras e escolhe a nota da lista', () => {
    const selected = selectItemsNote([REPLY_NOTE, LIST_NOTE], { comexUserId: COMEX_ID, catalog: CATALOG });
    expect(selected?.note.id).toBe(LIST_NOTE.id);
    expect(selected?.text).toBe(LIST_TEXT);
    expect(selected?.parsed.items.map((item) => item.productId)).toEqual([11, 12]);
  });

  it('sem usuario da equipe configurado: tabela ou item parseavel; a resposta sem tabela nao vale', () => {
    expect(selectItemsNote([LIST_NOTE, REPLY_NOTE])?.note.id).toBe(LIST_NOTE.id);
    expect(selectItemsNote([REPLY_NOTE, LIST_NOTE])?.note.id).toBe(LIST_NOTE.id);
  });

  it('so a resposta da equipe -> nenhuma nota (null); sem notas -> null', () => {
    expect(selectItemsNote([REPLY_NOTE], { comexUserId: COMEX_ID })).toBeNull();
    expect(selectItemsNote([], { comexUserId: COMEX_ID })).toBeNull();
  });

  it('varias notas de lista: vale a MAIS RECENTE com item (nao concatena)', () => {
    const older = note(1, SELLER_ID, '2026-11-05T10:00:00Z', '<a data-mentions="900301:900302">@Equipe</a><div>RESINA EXEMPLO 223 (RXE) 1.000</div>');
    const newer = note(2, SELLER_ID, '2026-11-06T10:00:00Z', '<a data-mentions="900301:900302">@Equipe</a><div>RESINA EXEMPLO 223 (RXE) 3.000</div>');
    const selected = selectItemsNote([older, newer], { comexUserId: COMEX_ID });
    expect(selected?.note.id).toBe(2);
    expect(selected?.parsed.items).toHaveLength(1);
    expect(selected?.parsed.items[0]?.quantityKg).toBe(3000);
  });

  it('a mais recente sem item cede a vez a anterior que tem item', () => {
    const withItems = note(1, SELLER_ID, '2026-11-05T10:00:00Z', '<table><tr><td>RESINA EXEMPLO 223 (RXE)</td><td>1.000</td></tr></table>');
    const noItems = note(2, SELLER_ID, '2026-11-06T10:00:00Z', '<a data-mentions="900301:900302">@Equipe</a><div>Segue a lista em breve.</div>');
    expect(selectItemsNote([withItems, noItems], { comexUserId: COMEX_ID })?.note.id).toBe(1);
  });

  it('nenhuma parseavel: a candidata mais recente vira nota crua com 0 itens ("Itens a digitar")', () => {
    const mention = note(1, SELLER_ID, '2026-11-05T10:00:00Z', '<a data-mentions="900301:900302">@Equipe</a><div>Cotar o item em anexo.</div>');
    const selected = selectItemsNote([mention, REPLY_NOTE], { comexUserId: COMEX_ID });
    expect(selected?.note.id).toBe(1);
    expect(selected?.parsed.items).toEqual([]);
    expect(selected?.parsed.mode).toBe('none');
    expect(selected?.text).toBe('@Equipe\nCotar o item em anexo.');
  });

  it('sem candidata (nem mencao nem tabela): usa todas as restantes', () => {
    const plain = note(1, SELLER_ID, '2026-11-05T10:00:00Z', '<div>RESINA EXEMPLO 223 (RXE) 1.000</div>');
    const selected = selectItemsNote([plain], { comexUserId: COMEX_ID });
    expect(selected?.note.id).toBe(1);
    expect(selected?.parsed.items).toHaveLength(1);
  });

  it('nota sem autor conhecido segue a regra de tabela ou item parseavel', () => {
    const noAuthor = note(1, null, '2026-11-05T10:00:00Z', '<div>RESINA EXEMPLO 223 (RXE) 1.000</div>');
    const chatter = note(2, null, '2026-11-06T10:00:00Z', '<div>ok, obrigado</div>');
    expect(selectItemsNote([noAuthor, chatter], { comexUserId: COMEX_ID })?.note.id).toBe(1);
  });

  it('empate de data: vale a de maior id', () => {
    const a = note(1, SELLER_ID, '2026-11-05T10:00:00Z', '<table><tr><td>PRODUTO EXEMPLO A</td><td>1.000</td></tr></table>');
    const b = note(2, SELLER_ID, '2026-11-05T10:00:00Z', '<table><tr><td>PRODUTO EXEMPLO B</td><td>2.000</td></tr></table>');
    expect(selectItemsNote([a, b], { comexUserId: COMEX_ID })?.note.id).toBe(2);
  });
});
