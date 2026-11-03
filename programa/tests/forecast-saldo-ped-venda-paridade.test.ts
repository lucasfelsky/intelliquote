import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import exceljs from 'exceljs';
import { describe, expect, it } from 'vitest';
import { calcular, conferir } from '../src/utils/forecastEngine';
import { gerarXlsxForecastMacro } from '../src/utils/forecastMacroXlsx';
import { codigosPendentes, type CadastroDeCodigos, type VendasRecentes } from '../src/utils/forecastPendentes';
import type { Quinzena } from '../src/utils/forecastTypes';

// Fixture ANONIMIZADA (repo publico). O campo saldoPedVenda e montado aqui com codigos anonimizados (C0001...) e
// quantidades sinteticas: SENTINELA + i. O motor, o MACRO e os pendentes NAO podem mudar com ele.
const fixture = JSON.parse(
  readFileSync(resolve(__dirname, 'fixtures', 'forecast', 'quinzena-10-2.anon.json'), 'utf8'),
) as Quinzena;

const SENTINELA = 7777.125;
const HOJE = '2026-10-20';

const fixtureCom: Quinzena = structuredClone(fixture);
fixtureCom.entradas.saldoPedVenda = fixtureCom.produtos
  .slice(0, 20)
  .map((p, i) => ({ codigo: p.codigos[0]!, qtd: SENTINELA + i }));

// Todas as celulas de todas as abas (valor, formula e resultado em cache), sem depender dos bytes do arquivo.
async function celulas(buffer: Buffer): Promise<Array<{ aba: string; linhas: unknown[][] }>> {
  const wb = new exceljs.Workbook();
  await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0]);
  return wb.worksheets.map((ws) => {
    const linhas: unknown[][] = [];
    ws.eachRow({ includeEmpty: true }, (row, n) => {
      const valores: unknown[] = [];
      row.eachCell({ includeEmpty: true }, (cell) => valores.push(cell.value));
      linhas[n] = valores;
    });
    return { aba: ws.name, linhas };
  });
}

describe('D7: saldoPedVenda nao muda o motor, o MACRO nem os pendentes', () => {
  it('a fixture original nao tem a chave e a com o campo tem', () => {
    expect('saldoPedVenda' in fixture.entradas).toBe(false);
    expect(fixtureCom.entradas.saldoPedVenda).toHaveLength(20);
  });

  it('paridade 9.464/9.464 com e sem o campo', () => {
    for (const q of [fixture, fixtureCom]) {
      const r = conferir(q, calcular(q, { hoje: HOJE, somarChegada5oMes: false }));
      expect(r.divergencias.slice(0, 5)).toEqual([]);
      expect(r.celulas).toBe(9464);
      expect(r.batem).toBe(9464);
    }
  });

  it('calcular devolve exatamente o mesmo com e sem o campo (varias opcoes)', () => {
    const marcado = new Map([[fixture.produtos[0]!.linha, new Set([0])]]);
    const opcoes = [
      { hoje: HOJE, somarChegada5oMes: false },
      { hoje: HOJE, quinzena: 1 as const },
      { hoje: HOJE, quinzena: 2 as const },
      { hoje: HOJE, quinzena: 2 as const, mesesForaDaMedia: marcado },
    ];
    for (const o of opcoes) {
      expect(calcular(fixtureCom, o)).toEqual(calcular(fixture, o));
    }
  });

  it('XLSX MACRO: mesmas abas e mesmo valor em toda celula; nenhuma celula tem o sentinela', async () => {
    const gerar = (quinzena: Quinzena) =>
      gerarXlsxForecastMacro({ quinzena, hoje: HOJE, half: 2, origin: 'planilha' });
    const sem = await celulas(await gerar(fixture));
    const com = await celulas(await gerar(fixtureCom));
    expect(com.map((a) => a.aba)).toEqual(sem.map((a) => a.aba));
    expect(com).toEqual(sem);
    expect(JSON.stringify(com)).not.toContain(String(SENTINELA));
  }, 120_000);

  it('codigosPendentes igual com e sem o campo', () => {
    // Cadastro sintetico: so os 100 primeiros codigos ficam ativos, o resto vira pendente.
    const ativos = new Set(fixture.produtos.slice(0, 100).map((p) => p.codigos[0]!));
    const cadastro: CadastroDeCodigos = { ativos, inativos: new Map() };
    const vendas: VendasRecentes = { meses: ['2026-07', '2026-08', '2026-09'], anteriores: new Map(), ausentes: [] };
    const sem = codigosPendentes(fixture.entradas, cadastro, vendas);
    const com = codigosPendentes(fixtureCom.entradas, cadastro, vendas);
    expect(com).toEqual(sem);
    expect(JSON.stringify(com)).not.toContain(String(SENTINELA));
  });
});
