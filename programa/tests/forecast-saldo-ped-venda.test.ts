import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import exceljs from 'exceljs';
import { describe, expect, it } from 'vitest';
import { parseSaldo } from '../src/utils/forecastDbcorp';
import { coletorSaldoPedVenda } from '../src/utils/forecastSaldoPedVenda';

// Dados 100% sinteticos (repositorio publico): codigos TST..., quantidades inventadas.

describe('coletorSaldoPedVenda', () => {
  it('soma por codigo normalizado (trim + maiusculas)', () => {
    const c = coletorSaldoPedVenda();
    c.adicionar('TST0001', 10);
    c.adicionar(' tst0001 ', 5);
    c.adicionar('TST0002', 3);
    expect(c.linhas()).toEqual([
      { codigo: 'TST0001', qtd: 15 },
      { codigo: 'TST0002', qtd: 3 },
    ]);
  });

  it('arredonda a soma em 6 casas (0.1 + 0.2 = 0.3)', () => {
    const c = coletorSaldoPedVenda();
    c.adicionar('TST0001', 0.1);
    c.adicionar('TST0001', 0.2);
    expect(c.linhas()).toEqual([{ codigo: 'TST0001', qtd: 0.3 }]);
  });

  it('guarda so qtd > 0 e ordena por codigo com comparacao simples', () => {
    const c = coletorSaldoPedVenda();
    c.adicionar('TST0003', 1);
    c.adicionar('TST0002', 0);
    c.adicionar('TST0001', 2);
    c.adicionar('TST00010', 4);
    expect(c.linhas().map((l) => l.codigo)).toEqual(['TST0001', 'TST00010', 'TST0003']);
  });

  it('vazio vale 0 e nao descarta nada', () => {
    const c = coletorSaldoPedVenda();
    c.adicionar('TST0001', null);
    c.adicionar('TST0001', '   ');
    c.adicionar('TST0001', 7);
    expect(c.linhas()).toEqual([{ codigo: 'TST0001', qtd: 7 }]);
  });

  it('descarta em silencio negativo, nao finito, texto e data', () => {
    const c = coletorSaldoPedVenda();
    c.adicionar('TST0001', 4);
    c.adicionar('TST0001', -2);
    c.adicionar('TST0001', Number.NaN);
    c.adicionar('TST0001', Number.POSITIVE_INFINITY);
    c.adicionar('TST0001', Number.NEGATIVE_INFINITY);
    c.adicionar('TST0001', 'abc');
    c.adicionar('TST0001', '12');
    c.adicionar('TST0001', '2026-10-15');
    expect(c.linhas()).toEqual([{ codigo: 'TST0001', qtd: 4 }]);
  });

  it('codigo vazio nao entra', () => {
    const c = coletorSaldoPedVenda();
    c.adicionar('   ', 9);
    expect(c.linhas()).toEqual([]);
  });

  it('sem nada (ou so zeros/invalidos) devolve []', () => {
    const c = coletorSaldoPedVenda();
    expect(c.linhas()).toEqual([]);
    c.adicionar('TST0001', 0);
    c.adicionar('TST0002', -1);
    c.adicionar('TST0003', 'x');
    expect(c.linhas()).toEqual([]);
  });
});

// --- parseSaldo com a coluna opcional ---------------------------------------------------------------

type Cell = string | number | Date | null;

async function xlsx(headers: string[], rows: Cell[][], options: { headerRow?: number } = {}): Promise<Buffer> {
  const headerRow = options.headerRow ?? 1;
  const workbook = new exceljs.Workbook();
  const ws = workbook.addWorksheet('Sheet');
  for (let r = 1; r < headerRow; r++) ws.getCell(r, 1).value = `titulo do relatorio ${r}`;
  headers.forEach((h, i) => (ws.getCell(headerRow, i + 1).value = h));
  rows.forEach((row, ri) =>
    row.forEach((value, ci) => {
      if (value !== null) ws.getCell(headerRow + 1 + ri, ci + 1).value = value;
    }),
  );
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

const HEADERS = [
  'Código',
  'Descrição',
  'Depósito',
  'Unidade',
  'Saldo Físico Disponível',
  'Saldo Ped. Venda',
  'Saldo Final',
  'Empresa',
];
const HEADERS_SEM_COLUNA = HEADERS.filter((h) => h !== 'Saldo Ped. Venda');
const DEP = 'DEPOSITO TESTE';
const EXCLUIDO = 'QUALIDADE';

// [codigo, deposito, saldo fisico, saldo ped. venda, empresa]
type Linha = [string | null, string | null, number | string | null, Cell, string];

const linhaCom = ([codigo, deposito, fisico, pedVenda, empresa]: Linha): Cell[] => [
  codigo,
  `Produto ${codigo}`,
  deposito,
  'KG',
  fisico,
  pedVenda,
  fisico,
  empresa,
];
const linhaSem = ([codigo, deposito, fisico, , empresa]: Linha): Cell[] => [
  codigo,
  `Produto ${codigo}`,
  deposito,
  'KG',
  fisico,
  fisico,
  empresa,
];

const LINHAS: Linha[] = [
  ['TST0001', DEP, 100, 40, 'SQ QUIMICA'],
  ['TST0001', 'OUTRO DEPOSITO TESTE', 50, 2.5, 'SQ QUIMICA'],
  [' tst0002 ', DEP, 10, 0, 'SQ QUIMICA'],
  ['TST0003', EXCLUIDO, 70, 999, 'SQ QUIMICA'],
  ['TST0004', DEP, 80, 888, 'OUTRA EMPRESA'],
  [null, DEP, 90, 777, 'SQ QUIMICA'],
  ['TST0005', DEP, 'abc', 666, 'SQ QUIMICA'],
  ['TST0006', DEP, 30, null, 'SQ QUIMICA'],
];

// Tudo que o estoque e o resumo mostram, sem a coluna nova.
const base = (r: Awaited<ReturnType<typeof parseSaldo>>) => {
  const { saldoPedVenda, ...resto } = r;
  void saldoPedVenda;
  return resto;
};

describe('parseSaldo: Saldo Ped. Venda (coluna opcional)', () => {
  it('soma por codigo so nas linhas que entram no estoque', async () => {
    const r = await parseSaldo(await xlsx(HEADERS, LINHAS.map(linhaCom)));
    expect(r.erros).toEqual([]);
    expect(r.saldoPedVenda).toEqual([{ codigo: 'TST0001', qtd: 42.5 }]);
    expect(r.linhas.map((l) => l.codigo)).toEqual(['TST0001', 'TST0001', 'TST0002', 'TST0006']);
  });

  it('coluna zerada x com valores (inclusive invalidos): estoque e resumo identicos', async () => {
    const zerada = await parseSaldo(await xlsx(HEADERS, LINHAS.map((l) => linhaCom([l[0], l[1], l[2], 0, l[4]]))));
    const invalidos = LINHAS.map((l, i) =>
      linhaCom([l[0], l[1], l[2], i % 2 === 0 ? 'texto' : -5, l[4]]),
    );
    const comInvalidos = await parseSaldo(await xlsx(HEADERS, invalidos));
    const comValores = await parseSaldo(await xlsx(HEADERS, LINHAS.map(linhaCom)));
    for (const r of [comInvalidos, comValores]) {
      expect(base(r)).toEqual(base(zerada));
      expect(r.usadas).toBe(zerada.usadas);
      expect(r.ignoradas).toEqual(zerada.ignoradas);
      expect(r.total).toBe(zerada.total);
      expect(r.lidas).toBe(zerada.lidas);
      expect(r.porDeposito).toEqual(zerada.porDeposito);
      expect(r.outrasEmpresas).toEqual(zerada.outrasEmpresas);
      expect(r.avisos).toEqual(zerada.avisos);
      expect(r.erros).toEqual(zerada.erros);
    }
    expect(zerada.saldoPedVenda).toEqual([]);
    expect(comInvalidos.saldoPedVenda).toEqual([]);
    expect(comValores.saldoPedVenda).not.toEqual(zerada.saldoPedVenda);
  });

  it('coluna ausente: sem erro, sem aviso novo e sem a chave', async () => {
    const com = await parseSaldo(await xlsx(HEADERS, LINHAS.map(linhaCom)));
    const sem = await parseSaldo(await xlsx(HEADERS_SEM_COLUNA, LINHAS.map(linhaSem)));
    expect(sem.erros).toEqual([]);
    expect('saldoPedVenda' in sem).toBe(false);
    expect(sem).toEqual(base(com));
  });

  it('coluna presente com tudo 0 ou vazio devolve []', async () => {
    const r = await parseSaldo(
      await xlsx(HEADERS, [linhaCom(['TST0001', DEP, 5, 0, 'SQ QUIMICA']), linhaCom(['TST0002', DEP, 6, null, 'SQ QUIMICA'])]),
    );
    expect(r.erros).toEqual([]);
    expect(r.saldoPedVenda).toEqual([]);
    expect('saldoPedVenda' in r).toBe(true);
  });

  it('cabecalho na linha 5 e caixa diferente; sem o ponto nao casa (normalizeHeader nao tira pontuacao)', async () => {
    const dados = [linhaCom(['TST0001', DEP, 5, 3, 'SQ QUIMICA'])];
    const comCaixa = HEADERS.map((h) => (h === 'Saldo Ped. Venda' ? 'SALDO PED. VENDA' : h));
    const r1 = await parseSaldo(await xlsx(comCaixa, dados, { headerRow: 5 }));
    expect(r1.erros).toEqual([]);
    expect(r1.saldoPedVenda).toEqual([{ codigo: 'TST0001', qtd: 3 }]);
    const semPonto = HEADERS.map((h) => (h === 'Saldo Ped. Venda' ? 'saldo ped venda' : h));
    const r2 = await parseSaldo(await xlsx(semPonto, dados, { headerRow: 5 }));
    expect(r2.erros).toEqual([]);
    expect('saldoPedVenda' in r2).toBe(false);
  });

  it('cabecalho obrigatorio ausente: erro e sem a chave', async () => {
    const r = await parseSaldo(await xlsx(['Código', 'Saldo Ped. Venda'], [['TST0001', 3]]));
    expect(r.erros.length).toBeGreaterThan(0);
    expect(r.linhas).toEqual([]);
    expect('saldoPedVenda' in r).toBe(false);
  });
});

// Opcional (maquina do Lucas): le o SALDO real de uma pasta local e afirma SO estrutura (nenhum numero ou codigo real).
const realDir = process.env.FORECAST_DBCORP_DIR;
describe('SALDO real (opcional, FORECAST_DBCORP_DIR)', () => {
  it.skipIf(!realDir)(
    'saldoPedVenda: array de qtd finita > 0, codigos unicos e ordenados',
    async () => {
      const r = await parseSaldo(readFileSync(join(realDir ?? '', 'SALDO.xlsx')));
      expect(r.erros).toEqual([]);
      expect(Array.isArray(r.saldoPedVenda)).toBe(true);
      const lista = r.saldoPedVenda ?? [];
      expect(lista.every((l) => Number.isFinite(l.qtd) && l.qtd > 0)).toBe(true);
      const codigos = lista.map((l) => l.codigo);
      expect(new Set(codigos).size).toBe(codigos.length);
      expect(codigos).toEqual([...codigos].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    },
    60_000,
  );
});
