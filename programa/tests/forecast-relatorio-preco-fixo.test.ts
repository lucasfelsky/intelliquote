import { describe, expect, it } from 'vitest';
import {
  montarRelatorioCompras,
  type LinhaParaRelatorio,
  type QuinzenaParaRelatorio,
} from '../src/utils/forecastRelatorioCompras';

// Tudo SINTETICO (repo publico). O item do relatorio de compras leva so o SELO de preco fechado congelado na quinzena.
const linha = (parcial: Partial<LinhaParaRelatorio> & Pick<LinhaParaRelatorio, 'linha' | 'item'>): LinhaParaRelatorio => ({
  productId: parcial.linha,
  fonte: 'FONTE A',
  codigos: [`C${String(parcial.linha).padStart(4, '0')}`],
  status: 'nao',
  Q: 60,
  AG: 60,
  U: 0,
  AN: -100,
  AQ: 30,
  projecao: [40, -20, -80, -140, -200, -260],
  chegadas: [0, 0, 0, 0, 0],
  programacoes: [0, 0, 0, 0],
  ...parcial,
});

const quinzena = (linhas: LinhaParaRelatorio[]): QuinzenaParaRelatorio => ({
  id: 1,
  label: '10-2',
  baseDate: '2026-10-15',
  half: 2,
  origin: 'planilha',
  hoje: '2026-10-20',
  linhas,
});

describe('relatorio de compras - selo de preco fechado', () => {
  const relatorio = montarRelatorioCompras(
    quinzena([
      linha({ linha: 3, item: 'COM SELO', precoFixo: true }),
      linha({ linha: 4, item: 'SEM SELO', precoFixo: false }),
      linha({ linha: 5, item: 'QUINZENA ANTIGA' }),
    ]),
    [],
  );
  const itens = relatorio.grupos.flatMap((g) => g.itens);
  const porNome = (nome: string) => itens.find((i) => i.item === nome)!;

  it('item marcado leva precoFixo: true', () => {
    expect(porNome('COM SELO').precoFixo).toBe(true);
  });

  it('item sem selo ou de quinzena antiga NAO ganha a chave (a saida de antes nao muda)', () => {
    expect('precoFixo' in porNome('SEM SELO')).toBe(false);
    expect('precoFixo' in porNome('QUINZENA ANTIGA')).toBe(false);
  });

  it('o item nunca carrega valor de preco', () => {
    expect(JSON.stringify(porNome('COM SELO'))).not.toMatch(/fixedPrice|unitPrice|precoFechado|valorPreco/);
  });
});
