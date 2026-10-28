import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type {
  ForecastGrupoRelatorio,
  ForecastItemRelatorio,
  ForecastOcasioesDoItem,
  ForecastOcasioesHoje,
  ForecastRelatorioCompras,
} from '@/services/forecast';
import ForecastOcasiaoSelo, {
  OcasioesDoGrupoSelo,
  OcasioesDoItemDetalhe,
  OcasioesNaMemoria,
  OcasioesNoResumo,
} from './ForecastOcasiaoSelo';
import {
  AVISO_ANTES_DE_HOJE,
  AVISO_COMPONENTES_AUSENTES,
  NOTA_OSCILOU,
  TEXTO_OCASIOES_INDISPONIVEIS,
} from './forecastOcasioesRelatorio';

// Dados 100% sinteticos.
const BLOCO: ForecastOcasioesDoItem = {
  extraDias: 5,
  leadTimeAjustado: 35,
  dataLimiteAjustada: '2026-10-17',
  antesDeHoje: false,
  emissaoAvaliada: '2026-10-20',
  chegadaEstimada: '2026-11-24',
  ocasioes: [
    { id: 1, nome: 'OCASIAO 001', etapa: 'total', dias: 3 },
    { id: 2, nome: 'OCASIAO 002', etapa: 'prontidao', dias: 2 },
  ],
};

const item = (ocasioes?: ForecastOcasioesDoItem) =>
  ({ leadTimeDias: 30, item: 'PRODUTO 001', ocasioes }) as ForecastItemRelatorio;

describe('ForecastOcasiaoSelo', () => {
  it('sem bloco nao renderiza nada', () => {
    const { container } = render(<ForecastOcasiaoSelo />);
    expect(container.innerHTML).toBe('');
  });

  it('com bloco: texto + icone, aria-label com os dias e icone escondido do leitor de tela', () => {
    render(<ForecastOcasiaoSelo ocasioes={BLOCO} />);
    const selo = screen.getByRole('img', { name: /Evento estrangeiro no lead time: 5 dias a mais/ });
    expect(selo.textContent).toContain('Evento estrangeiro: +5 d');
    expect(selo.className).toContain('badge--info');
    expect(selo.querySelector('.fcoc-selo__icone')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('1 dia usa o singular no aria-label', () => {
    render(<ForecastOcasiaoSelo ocasioes={{ ...BLOCO, extraDias: 1 }} />);
    expect(
      screen.getByRole('img', { name: 'Evento estrangeiro no lead time: 1 dia a mais (estimativa, só informa)' }),
    ).toBeTruthy();
  });
});

describe('OcasioesDoItemDetalhe', () => {
  it('sem bloco nao renderiza nada', () => {
    const { container } = render(<OcasioesDoItemDetalhe item={item()} />);
    expect(container.innerHTML).toBe('');
  });

  it('mostra lead time e data-limite ajustados, chegada estimada, a lista e a etiqueta "estimativa"', () => {
    const { container } = render(<OcasioesDoItemDetalhe item={item(BLOCO)} />);
    expect(screen.getByText('Eventos estrangeiros no lead time')).toBeTruthy();
    expect(container.querySelector('.fcoc-estimativa')?.textContent).toBe('estimativa');
    expect(screen.getByText('30 + 5 = 35 dias')).toBeTruthy();
    expect(screen.getByText('17/10/2026')).toBeTruthy();
    expect(screen.getByText('24/11/2026 (pedido em 20/10/2026)')).toBeTruthy();
    expect([...container.querySelectorAll('.fcoc-detalhe__ocasioes li')].map((li) => li.textContent)).toEqual([
      'OCASIAO 001 · +3 d (Lead time inteiro)',
      'OCASIAO 002 · +2 d (Prontidão)',
    ]);
    expect(screen.queryByText(AVISO_ANTES_DE_HOJE)).toBeNull();
    expect(screen.queryByText(AVISO_COMPONENTES_AUSENTES)).toBeNull();
    expect(screen.queryByText(NOTA_OSCILOU)).toBeNull();
  });

  it('avisos: antes de hoje (com icone escondido), componentes ausentes e oscilacao', () => {
    const { container } = render(
      <OcasioesDoItemDetalhe item={item({ ...BLOCO, antesDeHoje: true, componentesAusentes: true, oscilou: true })} />,
    );
    const avisos = [...container.querySelectorAll('.fcoc-aviso')].map((p) => p.textContent?.trim());
    expect(avisos).toEqual([`⚠ ${AVISO_ANTES_DE_HOJE}`, AVISO_COMPONENTES_AUSENTES]);
    expect(container.querySelector('.fcoc-aviso span')?.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelector('.fcoc-nota')?.textContent).toBe(NOTA_OSCILOU);
  });
});

describe('OcasioesDoGrupoSelo', () => {
  const grupo = (ocasioes?: ForecastGrupoRelatorio['ocasioes']) =>
    ({ fonte: 'FONTE 001', ocasioes }) as ForecastGrupoRelatorio;

  it('sem bloco nao renderiza nada', () => {
    const { container } = render(<OcasioesDoGrupoSelo grupo={grupo()} />);
    expect(container.innerHTML).toBe('');
  });

  it('com bloco: nomes das ocasioes e quantos itens, com icone escondido', () => {
    const { container } = render(
      <OcasioesDoGrupoSelo
        grupo={grupo({
          itensAfetados: 2,
          ocasioes: [
            { id: 1, nome: 'OCASIAO 001', etapa: 'total' },
            { id: 2, nome: 'OCASIAO 002', etapa: 'prontidao' },
          ],
        })}
      />,
    );
    expect(screen.getByText('Eventos estrangeiros: OCASIAO 001, OCASIAO 002 · 2 itens')).toBeTruthy();
    expect(container.querySelector('.fcoc-selo__icone')?.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('OcasioesNoResumo', () => {
  const dados = (ocasioes?: ForecastRelatorioCompras['ocasioes']) => ({ ocasioes }) as ForecastRelatorioCompras;
  const emLista = (ui: React.ReactElement) => render(<ul>{ui}</ul>);
  const textos = (container: HTMLElement) => [...container.querySelectorAll('li')].map((li) => li.textContent);

  it('sem bloco nao renderiza nada', () => {
    const { container } = emLista(<OcasioesNoResumo dados={dados()} />);
    expect(container.querySelectorAll('li')).toHaveLength(0);
  });

  it('indisponivel: uma linha com role status', () => {
    emLista(<OcasioesNoResumo dados={dados({ estado: 'indisponivel' })} />);
    expect(screen.getByRole('status').textContent).toBe(TEXTO_OCASIOES_INDISPONIVEIS);
  });

  it('ok: contagem sempre; as demais linhas so quando maiores que zero', () => {
    const base = {
      estado: 'ok' as const,
      ativas: 2,
      itensAfetados: 0,
      ocasioesQueCruzam: 0,
      antesDeHoje: 0,
      itensSemFonteCadastrada: 0,
      fontesSemPais: 0,
    };
    const vazio = emLista(<OcasioesNoResumo dados={dados(base)} />);
    expect(textos(vazio.container)).toEqual(['Nenhum item cruza os eventos estrangeiros cadastrados']);
    vazio.unmount();

    const cheio = emLista(
      <OcasioesNoResumo
        dados={dados({ ...base, itensAfetados: 3, antesDeHoje: 1, itensSemFonteCadastrada: 2, fontesSemPais: 1 })}
      />,
    );
    expect(textos(cheio.container)).toEqual([
      '3 itens com evento estrangeiro no lead time (estimativa)',
      '1 item com a data-limite ajustada já vencida',
      '2 itens com fonte fora do cadastro de lead time: eventos não avaliados',
      '1 fonte sem país: eventos por país não as alcançam',
    ]);
  });
});

describe('OcasioesNaMemoria', () => {
  const HOJE: ForecastOcasioesHoje = {
    extraDias: 5,
    leadTimeAjustado: 35,
    chegadaEstimada: '2026-11-24',
    ocasioes: [{ id: 1, nome: 'OCASIAO 001', etapa: 'total', dias: 5 }],
  };

  it('sem bloco nao renderiza nada', () => {
    const { container } = render(<OcasioesNaMemoria />);
    expect(container.innerHTML).toBe('');
  });

  it('com bloco: a frase e a etiqueta "estimativa"', () => {
    const { container } = render(<OcasioesNaMemoria ocasioes={HOJE} />);
    expect(container.querySelector('.fcoc-memoria')?.textContent).toBe(
      'Com evento estrangeiro: chega em 24/11/2026 (+5 dias: OCASIAO 001) estimativa',
    );
    expect(container.querySelector('.fcoc-estimativa')?.textContent).toBe('estimativa');
    expect(screen.queryByText(AVISO_COMPONENTES_AUSENTES)).toBeNull();
  });

  it('componentes ausentes: mostra o aviso', () => {
    render(<OcasioesNaMemoria ocasioes={{ ...HOJE, componentesAusentes: true }} />);
    expect(screen.getByText(AVISO_COMPONENTES_AUSENTES)).toBeTruthy();
  });
});
