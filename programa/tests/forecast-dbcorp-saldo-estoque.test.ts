import exceljs from 'exceljs';
import { describe, expect, it } from 'vitest';
import { FORECAST_DBCORP_DEPOSITOS_PERMITIDOS, FORECAST_DBCORP_SEM_DEPOSITO } from '../src/constants/forecast';
import { normalizeDbcorpText, parseSaldo, type ResumoRelatorio } from '../src/utils/forecastDbcorp';

// Fronteiras do estoque do SALDO (DS9004): SO a coluna "Saldo Final" e SO os depositos da allowlist.
// Workbooks em memoria, dados 100% sinteticos (repositorio publico). O "Saldo Físico Disponível" recebe sempre
// um valor DIFERENTE do "Saldo Final" (+1000): qualquer leitura da coluna errada quebra os totais.

type Cell = string | number | null;

const COLUNAS = [
  'Código',
  'Descrição',
  'Depósito',
  'Unidade',
  'Saldo Físico Disponível',
  'Saldo Ped. Venda',
  'Saldo Final',
  'Empresa',
] as const;

interface LinhaSaldo {
  codigo: string;
  deposito: string | null;
  final: number;
  pedVenda?: number | null;
  empresa?: string;
}

const linha = (codigo: string, deposito: string | null, final: number, extra: Partial<LinhaSaldo> = {}): LinhaSaldo => ({
  codigo,
  deposito,
  final,
  ...extra,
});

async function saldoXlsx(
  linhas: LinhaSaldo[],
  opcoes: { omitir?: string[]; renomear?: Record<string, string>; headerRow?: number } = {},
): Promise<Buffer> {
  const headerRow = opcoes.headerRow ?? 1;
  const colunas = COLUNAS.filter((c) => !(opcoes.omitir ?? []).includes(c));
  const workbook = new exceljs.Workbook();
  const ws = workbook.addWorksheet('Sheet');
  for (let r = 1; r < headerRow; r++) ws.getCell(r, 1).value = `titulo do relatorio ${r}`;
  colunas.forEach((c, i) => (ws.getCell(headerRow, i + 1).value = opcoes.renomear?.[c] ?? c));
  linhas.forEach((l, ri) => {
    const valores: Record<(typeof COLUNAS)[number], Cell> = {
      Código: l.codigo,
      Descrição: `Produto ${l.codigo}`,
      Depósito: l.deposito,
      Unidade: 'KG',
      'Saldo Físico Disponível': l.final + 1000,
      'Saldo Ped. Venda': l.pedVenda === undefined ? 0 : l.pedVenda,
      'Saldo Final': l.final,
      Empresa: l.empresa ?? 'SQ QUIMICA',
    };
    colunas.forEach((c, ci) => {
      const v = valores[c];
      if (v !== null) ws.getCell(headerRow + 1 + ri, ci + 1).value = v;
    });
  });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

const ignoradasTotal = (r: ResumoRelatorio) => Object.values(r.ignoradas).reduce((a, b) => a + b, 0);

// Uma linha de cada deposito da allowlist, na empresa da regra (sem aviso A2).
const todosOsDepositos = (final = 1): LinhaSaldo[] =>
  FORECAST_DBCORP_DEPOSITOS_PERMITIDOS.map((dep, i) => linha(`TST${i}`, dep, final));

const ERRO_SEM_SALDO_FINAL =
  'Relatorio SALDO: coluna "Saldo Final" nao encontrada nas 10 primeiras linhas. O estoque usa so a coluna "Saldo Final" (saldo do depósito); "Saldo Físico Disponível" não substitui porque desconta pedido de venda.';

describe('SALDO: estoque = "Saldo Final" dos depositos da allowlist', () => {
  it('constante: 4 depositos ja normalizados, SEPARACAO incluida e sem a lista antiga de excluidos', async () => {
    expect([...FORECAST_DBCORP_DEPOSITOS_PERMITIDOS]).toEqual(['DEPOSITO ITAJAI', 'VS SQ', 'EM TRANSITO', 'SEPARACAO']);
    for (const dep of FORECAST_DBCORP_DEPOSITOS_PERMITIDOS) expect(dep).toBe(normalizeDbcorpText(dep));
    expect(FORECAST_DBCORP_DEPOSITOS_PERMITIDOS).toContain('SEPARACAO');
    const constantes = await import('../src/constants/forecast');
    expect('FORECAST_DBCORP_DEPOSITOS_' + 'EXCLUIDOS' in constantes).toBe(false);
  });

  it('estoque e a coluna "Saldo Final" (Físico 1060 x Final 60 -> 60)', async () => {
    const r = await parseSaldo(await saldoXlsx([linha('TST0001', 'DEPOSITO ITAJAI', 60)]));
    expect(r.erros).toEqual([]);
    expect(r.linhas).toEqual([{ codigo: 'TST0001', qtd: 60 }]);
    expect(r.total).toBe(60);
    expect(r.porDeposito).toEqual([{ deposito: 'DEPOSITO ITAJAI', incluido: true, linhas: 1, saldo: 60 }]);
  });

  it('acento, caixa e espacos: todas as grafias da lista entram, um bucket por deposito normalizado', async () => {
    const r = await parseSaldo(
      await saldoXlsx([
        linha('TST0001', 'Depósito Itajaí', 4),
        linha('TST0002', '  vs   sq ', 3),
        linha('TST0003', 'Em Trânsito', 2),
        linha('TST0004', 'separação', 1),
      ]),
    );
    expect(r.linhas).toHaveLength(4);
    expect(r.porDeposito.every((d) => d.incluido)).toBe(true);
    expect(r.porDeposito.map((d) => [d.deposito, d.saldo])).toEqual([
      ['DEPOSITO ITAJAI', 4],
      ['VS SQ', 3],
      ['EM TRANSITO', 2],
      ['SEPARACAO', 1],
    ]);
  });

  it('deposito desconhecido ou vazio fica fora (igualdade exata, sem prefixo) e aparece no resumo', async () => {
    const r = await parseSaldo(
      await saldoXlsx([
        linha('TSTOK', 'DEPOSITO ITAJAI', 1),
        linha('TST0001', 'DEPOSITO ITAJAI 2', 10),
        linha('TST0002', 'DEP. ITAJAI', 20),
        linha('TST0003', 'EM-TRANSITO', 30),
        linha('TST0004', 'QUALIDADE', 40),
        linha('TST0005', '', 50),
        linha('TST0006', null, 60),
      ]),
    );
    expect(r.linhas).toEqual([{ codigo: 'TSTOK', qtd: 1 }]);
    expect(r.usadas).toBe(1);
    expect(r.ignoradas['deposito excluido']).toBe(6);
    expect(r.lidas).toBe(r.usadas + ignoradasTotal(r));
    const fora = r.porDeposito.filter((d) => !d.incluido);
    expect(fora.map((d) => [d.deposito, d.linhas, d.saldo]).sort()).toEqual(
      [
        ['DEPOSITO ITAJAI 2', 1, 10],
        ['DEP. ITAJAI', 1, 20],
        ['EM-TRANSITO', 1, 30],
        ['QUALIDADE', 1, 40],
        [FORECAST_DBCORP_SEM_DEPOSITO, 2, 110],
      ].sort(),
    );
  });

  it('SEPARACAO agora conta (regressao da regra antiga que a excluia)', async () => {
    const r = await parseSaldo(await saldoXlsx([linha('TST0001', 'SEPARAÇÃO', 13)]));
    expect(r.linhas).toEqual([{ codigo: 'TST0001', qtd: 13 }]);
    expect(r.ignoradas['deposito excluido']).toBeUndefined();
  });

  it('EM TRANSITO conta uma vez por linha: soma simples, um bucket', async () => {
    const r = await parseSaldo(
      await saldoXlsx([linha('TST0001', 'EM TRANSITO', 7), linha('TST0001', 'Em Trânsito', 5)]),
    );
    expect(r.linhas).toEqual([
      { codigo: 'TST0001', qtd: 7 },
      { codigo: 'TST0001', qtd: 5 },
    ]);
    expect(r.total).toBe(12);
    expect(r.porDeposito).toEqual([{ deposito: 'EM TRANSITO', incluido: true, linhas: 2, saldo: 12 }]);
  });

  it('deposito da lista sob outra empresa: fora do estoque, em outrasEmpresas e com aviso (sem valores)', async () => {
    const outra = (codigo: string, deposito: string) => linha(codigo, deposito, 4321.5, { empresa: 'OUTRA EMPRESA' });
    const r = await parseSaldo(
      await saldoXlsx([
        ...todosOsDepositos(1),
        outra('TST0101', 'DEPOSITO ITAJAI'),
        outra('TST0102', 'DEPOSITO ITAJAI'),
        outra('TST0103', 'VS SQ'),
      ]),
    );
    expect(r.usadas).toBe(4);
    expect(r.total).toBe(4);
    expect(r.porDeposito.map((d) => [d.deposito, d.linhas, d.saldo]).sort()).toEqual(
      [
        ['DEPOSITO ITAJAI', 1, 1],
        ['VS SQ', 1, 1],
        ['EM TRANSITO', 1, 1],
        ['SEPARACAO', 1, 1],
      ].sort(),
    );
    expect(r.outrasEmpresas).toEqual([{ empresa: 'OUTRA EMPRESA', linhas: 3, saldo: 12964.5 }]);
    expect(r.avisos).toEqual([
      'SALDO: depósito da lista do estoque sob outra empresa ficou FORA do estoque: DEPOSITO ITAJAI (OUTRA EMPRESA: 2 linhas); VS SQ (OUTRA EMPRESA: 1 linha). O estoque só soma a empresa SQ QUIMICA.',
    ]);
    expect(JSON.stringify(r.avisos)).not.toContain('4321.5');
  });

  it('allowlist inteira sob outra empresa: sem saldo valido + aviso com os 4 depositos, sem aviso de ausencia', async () => {
    const r = await parseSaldo(
      await saldoXlsx(
        FORECAST_DBCORP_DEPOSITOS_PERMITIDOS.map((dep, i) => linha(`TST${i}`, dep, 9, { empresa: 'OUTRA EMPRESA' })),
      ),
    );
    expect(r.usadas).toBe(0);
    expect(r.linhas).toEqual([]);
    expect(r.porDeposito).toEqual([]);
    expect(r.avisos).toEqual([
      'Relatorio SALDO sem saldo valido da empresa SQ QUIMICA.',
      'SALDO: depósito da lista do estoque sob outra empresa ficou FORA do estoque: DEPOSITO ITAJAI (OUTRA EMPRESA: 1 linha); VS SQ (OUTRA EMPRESA: 1 linha); EM TRANSITO (OUTRA EMPRESA: 1 linha); SEPARACAO (OUTRA EMPRESA: 1 linha). O estoque só soma a empresa SQ QUIMICA.',
    ]);
  });

  it('deposito da lista ausente na empresa da regra avisa; com os 4 presentes nao ha aviso', async () => {
    const parcial = await parseSaldo(await saldoXlsx([linha('TST0001', 'DEPOSITO ITAJAI', 5)]));
    expect(parcial.avisos).toEqual([
      'SALDO: nenhuma linha da empresa SQ QUIMICA nos depósitos VS SQ, EM TRANSITO, SEPARACAO (lista do estoque: DEPOSITO ITAJAI, VS SQ, EM TRANSITO, SEPARACAO).',
    ]);
    const completo = await parseSaldo(await saldoXlsx(todosOsDepositos()));
    expect(completo.avisos).toEqual([]);
  });

  it('sem "Saldo Final" (mesmo com "Saldo Físico Disponível"): 1 erro claro e nada de estoque', async () => {
    const r = await parseSaldo(await saldoXlsx([linha('TST0001', 'DEPOSITO ITAJAI', 5)], { omitir: ['Saldo Final'] }));
    expect(r.erros).toEqual([ERRO_SEM_SALDO_FINAL]);
    expect(r.linhas).toEqual([]);
    expect(r.porDeposito).toEqual([]);
    expect('saldoPedVenda' in r).toBe(false);
  });

  it('"Saldo Final" sem "Saldo Físico Disponível": le o estoque normalmente', async () => {
    const r = await parseSaldo(
      await saldoXlsx([linha('TST0001', 'DEPOSITO ITAJAI', 5)], { omitir: ['Saldo Físico Disponível'] }),
    );
    expect(r.erros).toEqual([]);
    expect(r.linhas).toEqual([{ codigo: 'TST0001', qtd: 5 }]);
  });

  it('cabecalho "SALDO FINAL" (caixa) na linha 5 e localizado', async () => {
    const r = await parseSaldo(
      await saldoXlsx([linha('TST0001', 'VS SQ', 8)], { renomear: { 'Saldo Final': 'SALDO FINAL' }, headerRow: 5 }),
    );
    expect(r.erros).toEqual([]);
    expect(r.linhas).toEqual([{ codigo: 'TST0001', qtd: 8 }]);
  });

  it('"Saldo Ped. Venda" segue a allowlist: so as linhas que entram no estoque', async () => {
    const r = await parseSaldo(
      await saldoXlsx([
        linha('TST0001', 'SEPARAÇÃO', 100, { pedVenda: 11 }),
        linha('TST0001', 'QUALIDADE', 100, { pedVenda: 22 }),
        linha('TST0001', null, 100, { pedVenda: 33 }),
        linha('TST0001', 'DEPOSITO ITAJAI', 100, { pedVenda: 44, empresa: 'OUTRA EMPRESA' }),
        linha('TST0002', 'DEPOSITO ITAJAI', 100, { pedVenda: 5 }),
      ]),
    );
    expect(r.saldoPedVenda).toEqual([
      { codigo: 'TST0001', qtd: 11 },
      { codigo: 'TST0002', qtd: 5 },
    ]);
  });
});
