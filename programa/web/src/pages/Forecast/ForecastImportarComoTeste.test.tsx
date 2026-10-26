import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ForecastImportModal from './ForecastImportModal';
import {
  NOTA_DBCORP_SEM_TESTE,
  NOTA_RESUMO_MODO_TESTE,
  opcoesComModoTeste,
  textoAvisoModoTeste,
  textoBloqueioModoTeste,
} from './forecastModoTeste';

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

import { api } from '@/api/client';

const post = vi.mocked(api.post);

// ---------- dados 100% sinteticos ----------
function resumoPlanilha(historico: Record<string, unknown> = {}) {
  return {
    label: '12-2',
    baseDate: '2026-12-15',
    half: 2,
    produtos: { total: 3, novos: 1, alterados: 1, inativados: 0 },
    codigos: { total: 4, vinculadosCatalogo: 2, movidos: 0 },
    fontes: { total: 2, novas: 0, alteradas: 1, comFornecedor: 1 },
    historico: { yearMonth: '2026-11', linhas: 5, novas: 1, alteradas: 2, removidas: 0, ...historico },
    conferencia: { celulas: 84, batem: 84, porColuna: {}, totalDivergencias: 0, divergencias: [] },
    avisos: [],
    erros: [],
  };
}

const arquivo = (nome: string) => new File([new Uint8Array([1, 2, 3])], nome);

function renderModal(quinzenasExistentes: string[] = ['10-2', '11-1']) {
  const onFechar = vi.fn();
  const onImportada = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ForecastImportModal aberto onFechar={onFechar} quinzenasExistentes={quinzenasExistentes} onImportada={onImportada} />
    </QueryClientProvider>,
  );
  return { onFechar, onImportada };
}

function preencherComuns(data = '2026-12-15', quinzena = '2ª') {
  fireEvent.change(screen.getByLabelText('Data-base'), { target: { value: data } });
  fireEvent.click(screen.getByLabelText(quinzena));
}

const botao = (nome: string) => screen.getByRole('button', { name: nome }) as HTMLButtonElement;
const caixa = (nome: string | RegExp) => screen.getByLabelText(nome) as HTMLInputElement;

const ATUALIZAR = 'Atualizar cadastro (produtos, códigos e fontes)';
const HISTORICO = 'Gravar histórico de 11/2026';
const QUINZENA = 'Criar a quinzena 12-2';
const TESTE = /Importar como teste/;

function escolherPlanilha() {
  fireEvent.change(screen.getByLabelText('Arquivo da planilha'), { target: { files: [arquivo('planilha-teste.xlsx')] } });
}

async function previsualizarPlanilha(resumo: unknown = resumoPlanilha()) {
  post.mockResolvedValueOnce({ data: resumo });
  preencherComuns();
  escolherPlanilha();
  fireEvent.click(botao('Pré-visualizar'));
  await screen.findByRole('heading', { name: 'Pré-visualização da planilha' });
}

const regiaoStatus = () => document.querySelector('.fit-status') as HTMLElement;

beforeEach(() => {
  cleanup();
  vi.restoreAllMocks();
  post.mockReset();
});

describe('Importar como teste - modal da planilha', () => {
  it('padrao: desmarcado, 3 opcoes marcadas e habilitadas, botao normal e regiao de status vazia', async () => {
    renderModal();
    await previsualizarPlanilha();
    expect(caixa(TESTE).checked).toBe(false);
    for (const nome of [ATUALIZAR, HISTORICO, QUINZENA]) {
      expect(caixa(nome).checked).toBe(true);
      expect(caixa(nome).disabled).toBe(false);
    }
    expect(botao('Confirmar importação')).toBeTruthy();
    expect(regiaoStatus().getAttribute('role')).toBe('status');
    expect(regiaoStatus().textContent).toBe('');
  });

  it('ligar: trava as opcoes, mostra aviso e nota, e envia so a criacao da quinzena', async () => {
    const { onImportada } = renderModal();
    await previsualizarPlanilha();
    fireEvent.click(caixa(TESTE));

    expect(caixa(ATUALIZAR).checked).toBe(false);
    expect(caixa(ATUALIZAR).disabled).toBe(true);
    expect(caixa(HISTORICO).checked).toBe(false);
    expect(caixa(HISTORICO).disabled).toBe(true);
    expect(caixa(QUINZENA).checked).toBe(true);
    expect(caixa(QUINZENA).disabled).toBe(true);

    const aviso = within(regiaoStatus());
    expect(aviso.getByText(/12-2/)).toBeTruthy();
    expect(aviso.getByText(/Excluir quinzena/)).toBeTruthy();
    const regiaoResumo = screen.getByRole('region', { name: 'Pré-visualização da planilha' });
    expect(within(regiaoResumo).getByText(NOTA_RESUMO_MODO_TESTE)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Confirmar importação' })).toBeNull();

    post.mockResolvedValueOnce({ data: { snapshotId: 9 } });
    fireEvent.click(botao('Importar como teste'));
    await vi.waitFor(() => expect(onImportada).toHaveBeenCalledWith(9, '12-2'));
    const [rota, corpo] = post.mock.calls[1] as [string, { options: unknown }];
    expect(rota).toBe('/v1/forecast/import/workbook/confirm');
    expect(corpo.options).toEqual({ atualizarCadastro: false, gravarHistorico: false, criarQuinzena: true });
  });

  it('desligar restaura exatamente as escolhas anteriores', async () => {
    const { onImportada } = renderModal();
    await previsualizarPlanilha();
    fireEvent.click(caixa(ATUALIZAR));
    expect(caixa(ATUALIZAR).checked).toBe(false);
    fireEvent.click(caixa(TESTE));
    fireEvent.click(caixa(TESTE));

    expect(caixa(ATUALIZAR).checked).toBe(false);
    expect(caixa(HISTORICO).checked).toBe(true);
    expect(caixa(QUINZENA).checked).toBe(true);
    for (const nome of [ATUALIZAR, HISTORICO, QUINZENA]) expect(caixa(nome).disabled).toBe(false);
    expect(regiaoStatus().textContent).toBe('');

    post.mockResolvedValueOnce({ data: { snapshotId: 9 } });
    fireEvent.click(botao('Confirmar importação'));
    await vi.waitFor(() => expect(onImportada).toHaveBeenCalled());
    const [, corpo] = post.mock.calls[1] as [string, { options: unknown }];
    expect(corpo.options).toEqual({ atualizarCadastro: false, gravarHistorico: true, criarQuinzena: true });
  });

  it('a preferencia de "Criar a quinzena" e preservada', async () => {
    renderModal();
    await previsualizarPlanilha();
    fireEvent.click(caixa(QUINZENA));
    expect(caixa(QUINZENA).checked).toBe(false);
    fireEvent.click(caixa(TESTE));
    expect(caixa(QUINZENA).checked).toBe(true);
    fireEvent.click(caixa(TESTE));
    expect(caixa(QUINZENA).checked).toBe(false);
  });

  it('rotulo ja existente: botao desabilitado e mensagem propria do modo teste', async () => {
    renderModal(['12-2']);
    await previsualizarPlanilha();
    fireEvent.click(caixa(TESTE));
    expect(botao('Importar como teste').disabled).toBe(true);
    expect(screen.getByText(textoBloqueioModoTeste('12-2'))).toBeTruthy();
    expect(screen.queryByText('Marque ao menos uma opção.')).toBeNull();
  });

  it('historico sem linhas: a trava do historico prevalece depois de ligar e desligar', async () => {
    renderModal();
    await previsualizarPlanilha(resumoPlanilha({ linhas: 0, novas: 0, alteradas: 0, removidas: 0 }));
    expect(caixa(HISTORICO).disabled).toBe(true);
    expect(caixa(HISTORICO).checked).toBe(false);
    fireEvent.click(caixa(TESTE));
    fireEvent.click(caixa(TESTE));
    expect(caixa(HISTORICO).disabled).toBe(true);
    expect(caixa(HISTORICO).checked).toBe(false);
  });

  it('o modo teste sobrevive a uma nova pre-visualizacao', async () => {
    const { onImportada } = renderModal();
    await previsualizarPlanilha();
    fireEvent.click(caixa(TESTE));

    fireEvent.click(screen.getByRole('button', { name: 'Remover planilha-teste.xlsx' }));
    escolherPlanilha();
    post.mockResolvedValueOnce({ data: resumoPlanilha() });
    fireEvent.click(botao('Pré-visualizar'));
    await screen.findByRole('heading', { name: 'Pré-visualização da planilha' });
    expect(caixa(TESTE).checked).toBe(true);

    post.mockResolvedValueOnce({ data: { snapshotId: 9 } });
    fireEvent.click(botao('Importar como teste'));
    await vi.waitFor(() => expect(onImportada).toHaveBeenCalled());
    const [, corpo] = post.mock.calls[2] as [string, { options: unknown }];
    expect(corpo.options).toEqual({ atualizarCadastro: false, gravarHistorico: false, criarQuinzena: true });
  });

  it('acessibilidade: dica e aviso ligados por aria-describedby, sem tabindex negativo', async () => {
    renderModal();
    await previsualizarPlanilha();
    const alternar = caixa(TESTE);
    expect(alternar.getAttribute('aria-describedby')).toBe('fit-dica');
    expect(document.getElementById('fit-dica')?.textContent).toBeTruthy();
    expect(alternar.getAttribute('tabindex')).not.toBe('-1');
    for (const nome of [ATUALIZAR, HISTORICO, QUINZENA]) expect(caixa(nome).getAttribute('aria-describedby')).toBeNull();

    fireEvent.click(alternar);
    expect(document.getElementById('fit-aviso')).toBeTruthy();
    for (const nome of [ATUALIZAR, HISTORICO, QUINZENA]) expect(caixa(nome).getAttribute('aria-describedby')).toBe('fit-aviso');
  });

  it('aba DBCorp: so a nota explicativa, sem o atalho', () => {
    renderModal();
    fireEvent.click(screen.getByRole('tab', { name: 'Relatórios DBCorp' }));
    expect(screen.getByText(NOTA_DBCORP_SEM_TESTE)).toBeTruthy();
    expect(screen.queryByLabelText(TESTE)).toBeNull();
  });
});

describe('forecastModoTeste - funcoes puras', () => {
  const opcoes = { atualizarCadastro: false, gravarHistorico: true, criarQuinzena: false };

  it('opcoesComModoTeste: ligado so cria a quinzena; desligado devolve a mesma referencia', () => {
    expect(opcoesComModoTeste(opcoes, true)).toEqual({ atualizarCadastro: false, gravarHistorico: false, criarQuinzena: true });
    expect(opcoesComModoTeste(opcoes, false)).toBe(opcoes);
    expect(opcoes).toEqual({ atualizarCadastro: false, gravarHistorico: true, criarQuinzena: false });
  });

  it('textoAvisoModoTeste: com mes cita MM/AAAA; sem mes nunca usa travessao', () => {
    expect(textoAvisoModoTeste('12-2', '2026-11')).toContain('histórico de 11/2026');
    const semMes = textoAvisoModoTeste('12-2', null);
    expect(semMes).toContain('o histórico de vendas');
    expect(semMes).not.toContain('—');
  });
});
