import { describe, expect, it } from 'vitest';
import type { OcasiaoLeadTime } from '../src/utils/forecastOcasioes';
import {
  montarRelatorioCompras,
  type LinhaParaRelatorio,
  type RelatorioCompras,
} from '../src/utils/forecastRelatorioCompras';
import {
  anexarOcasioesAoRelatorio,
  ocasioesDaPoHoje,
  ocasioesDoItem,
  type ContextoOcasioes,
  type FonteDoCadastro,
} from '../src/utils/forecastRelatorioComprasOcasioes';

// Eventos estrangeiros: alcance regional estrito, sem somar entre regioes (decisao do Lucas, 2026-10-27). Dados 100%
// sinteticos: FONTE 00N, OCASIAO 00N (o nome do evento) e paises XA..XC.
const BASE = '2026-10-15';
const HOJE = '2026-10-20';

const fonte = (id: number, countryCode: string | null): FonteDoCadastro => ({
  id,
  countryCode,
  ativa: true,
  readinessDays: 10,
  shippingDays: 5,
  transitDays: 10,
  clearanceDays: 5,
});

// Mesma janela para todos (cruzam qualquer fonte); o valor de cada evento e uma potencia de 2, para a soma dizer QUAIS entraram.
const evento = (over: Partial<OcasiaoLeadTime> & Pick<OcasiaoLeadTime, 'id' | 'valor'>): OcasiaoLeadTime => ({
  escopo: 'global',
  countryCode: null,
  sourceId: null,
  inicio: '2026-11-01',
  fim: '2026-11-05',
  recorrencia: 'nenhuma',
  etapa: 'total',
  efeito: 'dias',
  ativa: true,
  ...over,
});

const FONTES: Record<string, FonteDoCadastro> = {
  'FONTE 001': fonte(1, 'XA'),
  'FONTE 002': fonte(2, 'XB'),
  'FONTE 003': fonte(3, 'XC'),
  'FONTE 004': fonte(4, 'XA'),
  'FONTE 005': fonte(5, null),
};

const EVENTOS: OcasiaoLeadTime[] = [
  evento({ id: 1, valor: 1, escopo: 'pais', countryCode: 'XA' }),
  evento({ id: 2, valor: 2, escopo: 'pais', countryCode: 'XB' }),
  evento({ id: 3, valor: 4, escopo: 'fonte', sourceId: 3 }),
  evento({ id: 4, valor: 8 }),
  evento({ id: 5, valor: 16, escopo: 'fonte', sourceId: 1 }),
];

const ctx: ContextoOcasioes = {
  ocasioes: EVENTOS,
  nomes: new Map(EVENTOS.map((e) => [e.id, `OCASIAO ${String(e.id).padStart(3, '0')}`] as const)),
  fontes: new Map(Object.entries(FONTES)),
};

// Ids esperados por fonte: global + o pais da fonte + a propria fonte (nunca o pais de outra regiao nem a fonte de outra).
const ESPERADO: Record<string, { ids: number[]; extra: number }> = {
  'FONTE 001': { ids: [1, 4, 5], extra: 25 },
  'FONTE 002': { ids: [2, 4], extra: 10 },
  'FONTE 003': { ids: [3, 4], extra: 12 },
  'FONTE 004': { ids: [1, 4], extra: 9 },
  'FONTE 005': { ids: [4], extra: 8 },
};

const E = (nomeDaFonte: string) => ({
  fonte: nomeDaFonte,
  leadTimeDias: 30,
  ruptura: '2026-11-21',
  vencida: false,
  hoje: HOJE,
});

function linha(n: number, nomeDaFonte: string): LinhaParaRelatorio {
  return {
    linha: n,
    item: `PRODUTO ${String(n).padStart(3, '0')}`,
    fonte: nomeDaFonte,
    codigos: [`C${String(n).padStart(4, '0')}`],
    status: 'nao',
    Q: 60,
    AG: 60,
    U: 0,
    AN: -100,
    AQ: 30,
    projecao: [40, -20, -80, -140, -200, -260],
    chegadas: [0, 0, 0, 0, 0],
    programacoes: [0, 0, 0, 0],
  };
}

describe('eventos estrangeiros: cada fonte so recebe os eventos do proprio alcance', () => {
  it.each(Object.entries(ESPERADO))('%s: global + o seu pais + a sua fonte, e a soma inclui apenas esses', (nome, esperado) => {
    const r = ocasioesDoItem(E(nome), ctx);
    expect(r?.ocasioes.map((o) => o.id)).toStrictEqual(esperado.ids);
    expect(r?.extraDias).toBe(esperado.extra);
    expect(r?.leadTimeAjustado).toBe(30 + esperado.extra);
    // Memoria de calculo: o mesmo alcance e a mesma soma.
    const hoje = ocasioesDaPoHoje({ fonte: nome, AQ: 30 }, HOJE, ctx);
    expect(hoje?.ocasioes.map((o) => o.id)).toStrictEqual(esperado.ids);
    expect(hoje?.extraDias).toBe(esperado.extra);
  });

  it('o evento de XA nunca aparece na fonte de XB e vice-versa', () => {
    const emXB = ocasioesDoItem(E('FONTE 002'), ctx)?.ocasioes.map((o) => o.id) ?? [];
    const emXA = ocasioesDoItem(E('FONTE 001'), ctx)?.ocasioes.map((o) => o.id) ?? [];
    expect(emXB).not.toContain(1);
    expect(emXA).not.toContain(2);
    // Nem a fonte especifica de outra regiao: o evento da fonte 003 (XC) nao chega a XA nem a XB.
    expect(emXA).not.toContain(3);
    expect(emXB).not.toContain(3);
    // O evento da fonte 001 nao vale para outra fonte do MESMO pais (004, tambem XA).
    expect(ocasioesDoItem(E('FONTE 004'), ctx)?.ocasioes.map((o) => o.id)).not.toContain(5);
  });

  it('fonte sem pais so recebe o global (e os da propria fonte)', () => {
    expect(ocasioesDoItem(E('FONTE 005'), ctx)?.ocasioes.map((o) => o.id)).toStrictEqual([4]);
  });

  it('no relatorio: o bloco do item e o do grupo seguem o mesmo alcance, sem misturar regioes', () => {
    const nomes = Object.keys(FONTES);
    const base: RelatorioCompras = montarRelatorioCompras(
      {
        id: 1,
        label: '10-2',
        baseDate: BASE,
        half: 2,
        origin: 'planilha',
        hoje: HOJE,
        linhas: nomes.map((nome, i) => linha(i + 1, nome)),
      },
      [],
    );
    const r = anexarOcasioesAoRelatorio(base, ctx);
    expect(r.grupos).toHaveLength(nomes.length);
    for (const g of r.grupos) {
      const esperado = ESPERADO[g.fonte];
      expect(g.itens[0].ocasioes?.ocasioes.map((o) => o.id)).toStrictEqual(esperado.ids);
      expect(g.itens[0].ocasioes?.extraDias).toBe(esperado.extra);
      expect(g.ocasioes?.ocasioes.map((o) => o.id)).toStrictEqual(esperado.ids);
      expect(g.ocasioes?.itensAfetados).toBe(1);
    }
    // 5 eventos ativos, todos cruzam alguma fonte.
    expect(r.ocasioes).toMatchObject({ estado: 'ok', ativas: 5, ocasioesQueCruzam: 5, itensAfetados: 5 });
  });

  it('evento inativo de outra regiao nao entra na soma', () => {
    const comInativo: ContextoOcasioes = {
      ...ctx,
      ocasioes: [...EVENTOS, evento({ id: 6, valor: 32, escopo: 'pais', countryCode: 'XB', ativa: false })],
    };
    expect(ocasioesDoItem(E('FONTE 002'), comInativo)?.extraDias).toBe(10);
    expect(ocasioesDoItem(E('FONTE 001'), comInativo)?.extraDias).toBe(25);
  });
});
