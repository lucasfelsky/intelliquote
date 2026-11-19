import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ForecastLinha, ForecastMonths, ForecastStatus } from '@/services/forecast';
import { opaque, over, parseColor, parseRules, ratioOf, readSource, regioes, stripComments, temasDeTokens, tokensDosTemas, type Rgb } from '@/test/rfCss';
import ForecastGrid from './ForecastGrid';
import { colunasDoPainel, STATUS_ORDEM, STATUS_ROTULO } from './forecastPainel';

// Celula ITENS da grade do Painel tingida com a cor do status da compra: classe no <td> + regras CSS (jsdom nao calcula estilo; o CSS e lido do arquivo) + contraste AA.
// Dados 100% sinteticos.

vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() },
  ApiError: class ApiError extends Error {
    status: number;
    body: unknown;
    constructor(status: number, body: unknown, message?: string) {
      super(message ?? `HTTP ${status}`);
      this.status = status;
      this.body = body;
    }
  },
}));

const MONTHS: ForecastMonths = {
  consumo: ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7 (ATUAL)'],
  chegada: ['B1', 'B2', 'B3', 'B4', 'B5'],
  programacao: ['C1', 'C2', 'C3', 'C4'],
};

function linha(over: Partial<ForecastLinha> = {}): ForecastLinha {
  return {
    linha: 3,
    O: 100,
    P: 50,
    Q: 100,
    R: 90,
    S: 80,
    T: 10,
    U: 500,
    chegadas: [0, 0, 0, 0, 0],
    AA: 5,
    programacoes: [0, 0, 0, 0],
    AG: 100,
    projecao: [400, 300, 200, 100, 50, 20],
    AN: 200,
    AQ: 30,
    AP: '2026-11-20',
    AR: 0,
    AS: 0,
    item: 'PRODUTO SINTETICO A',
    codigos: ['TST0001', 'TST0002'],
    fonte: 'FONTE 1',
    status: 'nao',
    analiseForecast: null,
    productId: 42,
    n: 1,
    historico: [11, 22, 33, 44, 55],
    obs: '',
    precoFixo: false,
    sobDemanda: false,
    mesesForaDaMedia: [],
    ...over,
  } as ForecastLinha;
}

const NOME_DO_STATUS: Record<ForecastStatus, string> = {
  nao: 'ITEM SINTETICO NAO',
  cotando: 'ITEM SINTETICO COTANDO',
  confirmado: 'ITEM SINTETICO CONFIRMADO',
  po: 'ITEM SINTETICO PO',
  preco: 'ITEM SINTETICO PRECO',
};

describe('Forecast Painel: celula ITENS carrega a classe do status (render)', () => {
  it('cada status vira fc-status--<status> no <td> fc-fixa--item e o status continua escrito em texto', () => {
    const linhas = STATUS_ORDEM.map((status, i) => linha({ linha: 10 + i, n: i + 1, item: NOME_DO_STATUS[status], status }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ForecastGrid
            colunas={colunasDoPainel(MONTHS, { ocultas: false })}
            linhas={linhas}
            divergencias={new Map()}
            buscaDoItem=""
            legenda="Grade"
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    for (const status of STATUS_ORDEM) {
      const td = screen.getByText(NOME_DO_STATUS[status]).closest('td');
      expect(td, status).not.toBeNull();
      expect(td?.classList.contains('fc-fixa--item'), status).toBe(true);
      expect(td?.classList.contains(`fc-status--${status}`), status).toBe(true);
      // So uma classe de status por celula.
      expect(Array.from(td?.classList ?? []).filter((c) => c.startsWith('fc-status--')), status).toEqual([`fc-status--${status}`]);
      expect(td?.textContent, status).toContain(STATUS_ROTULO[status]);
    }
  });
});

describe('Forecast Painel: regras CSS da celula ITENS (F13-C)', () => {
  const cssLf = readSource('../styles/globals.css').replace(/\r\n/g, '\n');
  const regiao = regioes(cssLf).find((r) => r.nome === 'tela F13');
  if (!regiao) throw new Error('regiao `tela F13` nao encontrada');
  const inicio = regiao.bruto.indexOf('/* -- F13-C >>> -- */');
  const fim = regiao.bruto.indexOf('/* -- <<< F13-C -- */');
  const parF13C = stripComments(regiao.bruto.slice(inicio, fim));
  const midias = parseRules(parF13C).filter((r) => r.prelude === '@media screen');
  const regras = midias.flatMap((m) => parseRules(m.body));

  const TOKEN_DO_STATUS: Record<ForecastStatus, string> = {
    nao: '--rf-fc-status-pendente',
    cotando: '--rf-fc-status-cotando',
    confirmado: '--rf-fc-status-confirmado',
    po: '--rf-fc-status-po',
    preco: '--rf-fc-status-preco',
  };
  const { claro, escuro } = tokensDosTemas(cssLf);
  const temas = temasDeTokens(claro, escuro);
  const PORCENTAGEM = { claro: 20, escuro: 16 } as const;
  const seletor = (tema: 'claro' | 'escuro', status: ForecastStatus) =>
    `${tema === 'escuro' ? ':root[data-theme="dark"] ' : ''}.fc-pagina .fc-grid td.fc-status--${status}`;
  const declaracao = (corpo: string, propriedade: string) =>
    corpo
      .split(';')
      .map((d) => d.trim())
      .find((d) => d.startsWith(`${propriedade}:`))
      ?.slice(propriedade.length + 1)
      .trim();
  const doSeletor = (s: string) => regras.filter((r) => r.prelude === s);
  const MISTURA = /^color-mix\(in srgb, var\((--rf-fc-status-[a-z]+)\) (\d+)%, var\(--rf-surface\)\)$/;

  it('o par F13-C tem 1 bloco @media screen com as regras', () => {
    expect(midias).toHaveLength(1);
    expect(regras.length).toBeGreaterThan(10);
  });

  it.each(['claro', 'escuro'] as const)('tema %s: 1 regra por status com color-mix do proprio token sobre --rf-surface, e a barrinha + sombra sticky continuam', (tema) => {
    for (const status of STATUS_ORDEM) {
      const s = seletor(tema, status);
      const backgrounds = doSeletor(s).filter((r) => declaracao(r.body, 'background') !== undefined);
      expect(backgrounds, `${s} background`).toHaveLength(1);
      expect(declaracao(backgrounds[0]?.body ?? '', 'background'), s).toBe(
        `color-mix(in srgb, var(${TOKEN_DO_STATUS[status]}) ${PORCENTAGEM[tema]}%, var(--rf-surface))`,
      );
    }
    // A barrinha de 4 px + sombra sticky (regra do tema claro; vale para os dois) segue presente.
    for (const status of STATUS_ORDEM) {
      const s = seletor('claro', status);
      const sombras = doSeletor(s).filter((r) => declaracao(r.body, 'box-shadow') !== undefined);
      expect(sombras, `${s} box-shadow`).toHaveLength(1);
      expect(declaracao(sombras[0]?.body ?? '', 'box-shadow'), s).toBe(`inset 4px 0 0 var(${TOKEN_DO_STATUS[status]}), var(--rf-shadow-sticky)`);
    }
  });

  it.each(['claro', 'escuro'] as const)('tema %s: --rf-surface e os 5 --rf-fc-status-* sao opacos (a coluna sticky nao deixa a rolagem vazar)', (tema) => {
    const tokens = temas[tema];
    for (const nome of ['--rf-surface', ...Object.values(TOKEN_DO_STATUS)]) {
      const valor = tokens[nome];
      expect(valor, `${tema} ${nome}`).toBeDefined();
      expect(parseColor(valor ?? '')[3], `${tema} ${nome}`).toBe(1);
    }
  });

  it.each(['claro', 'escuro'] as const)('tema %s: contraste AA (>= 4,5) do nome, da fonte e dos selos sobre o tom resultante', (tema) => {
    const tokens = temas[tema];
    const surface = opaque(tokens, '--rf-surface');
    const ink = opaque(tokens, '--rf-ink');
    const inkSoft = opaque(tokens, '--rf-ink-soft');
    for (const status of STATUS_ORDEM) {
      const s = seletor(tema, status);
      const regra = doSeletor(s).find((r) => declaracao(r.body, 'background') !== undefined);
      const m = MISTURA.exec(declaracao(regra?.body ?? '', 'background') ?? '');
      expect(m, s).not.toBeNull();
      const token = m?.[1] ?? '';
      const p = Number(m?.[2]);
      expect(token, s).toBe(TOKEN_DO_STATUS[status]);
      const [r, g, b] = parseColor(tokens[token] ?? '');
      const fundo: Rgb = over([r, g, b, p / 100], surface);
      expect(ratioOf(ink, fundo), `${tema} ${status} nome`).toBeGreaterThanOrEqual(4.5);
      expect(ratioOf(inkSoft, fundo), `${tema} ${status} fonte`).toBeGreaterThanOrEqual(4.5);
      for (const [fg, bg] of [
        ['--rf-tone-warning-fg', '--rf-tone-warning-bg'],
        ['--rf-tone-neutral-fg', '--rf-tone-neutral-bg'],
      ] as const) {
        const seloFundo = over(parseColor(tokens[bg] ?? ''), fundo);
        expect(ratioOf(opaque(tokens, fg), seloFundo), `${tema} ${status} ${fg} sobre ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('marca 4x14 da legenda: 1 regra `.fc-pagina i.fc-status--*` por status com o proprio token (sem regra escura propria) e contraste sobre --rf-surface', () => {
    for (const status of STATUS_ORDEM) {
      const s = `.fc-pagina i.fc-status--${status}`;
      const regrasDoStatus = doSeletor(s);
      expect(regrasDoStatus, s).toHaveLength(1);
      expect(declaracao(regrasDoStatus[0]?.body ?? '', 'background'), s).toBe(`var(${TOKEN_DO_STATUS[status]})`);
    }
    // O escuro vem do proprio token (mesma fonte da barrinha e da celula): nao existe regra escura para a marca.
    expect(regras.filter((r) => /:root\[data-theme="dark"\] \.fc-pagina i\.fc-status--/.test(r.prelude))).toHaveLength(0);
    // Marca 4x14 sobre o fundo do balao (--rf-surface): so as 2 excecoes ja aceitas em KNOWN_EXCEPTIONS (suiteComexTokens) ficam abaixo de 3:1.
    const abaixoDe3: string[] = [];
    for (const tema of ['claro', 'escuro'] as const) {
      const tokens = temas[tema];
      const surface = opaque(tokens, '--rf-surface');
      for (const status of STATUS_ORDEM) {
        if (ratioOf(opaque(tokens, TOKEN_DO_STATUS[status]), surface) < 3) abaixoDe3.push(`${tema} ${status}`);
      }
    }
    expect(abaixoDe3.sort()).toEqual(['claro confirmado', 'claro nao']);
  });

  it('as vizinhas seguem como antes (seguranca e acima da media) e as regras novas nao as citam', () => {
    const seg = doSeletor('.fc-pagina .fc-grid .fc-cell--seg');
    expect(seg.map((r) => declaracao(r.body, 'background'))).toEqual(['var(--rf-fc-current-tint)']);
    const acima = doSeletor('.fc-pagina .fc-grid .fc-cell--acima-media');
    expect(acima.map((r) => declaracao(r.body, 'background'))).toEqual(['var(--rf-tone-warning-bg)']);
    const novas = regras.filter((r) => declaracao(r.body, 'background')?.startsWith('color-mix(') && /td\.fc-status--/.test(r.prelude));
    expect(novas).toHaveLength(10);
    for (const r of novas) expect(r.prelude).not.toMatch(/fc-cell--seg|acima-media/);
  });
});
