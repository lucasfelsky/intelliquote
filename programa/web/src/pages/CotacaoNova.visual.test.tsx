import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, within, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CotacaoNova from './CotacaoNova';

const ctx = vi.hoisted(() => ({ search: '', role: 'admin', navigate: vi.fn() }));
vi.mock('react-router-dom', () => ({
  useNavigate: () => ctx.navigate,
  useSearchParams: () => [new URLSearchParams(ctx.search)],
}));
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, name: 'Admin', email: 'a@b.c', role: ctx.role } }),
}));
vi.mock('@/components/useConfirm', () => ({ useConfirm: () => async () => true }));
vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn() },
  ApiError: class ApiError extends Error {},
}));

import { api } from '@/api/client';

// Solicitacao sintetica (sem dado real): 1 item com preco-alvo.
const SOLICITACAO = {
  id: 9,
  status: 'pending',
  customerName: null,
  notes: null,
  rejectionReason: null,
  fulfillmentNote: null,
  createdAt: '2026-10-19T12:00:00.000Z',
  statusChangedAt: null,
  isDevelopment: false,
  requestedBy: { id: 3, name: 'Ana', email: 'ana@x.com' },
  statusChangedBy: null,
  quoteRequest: null,
  items: [
    {
      id: 91,
      catalogItemId: 10,
      commercialName: 'Resina X',
      isNewItem: false,
      notes: null,
      proposedName: null,
      marketName: 'RX-100',
      dbcorpCode: null,
      quantity: 5,
      unit: 'KG',
      targetPrice: '10.50',
      targetCurrency: 'USD',
      quoteRequestItemId: null,
    },
  ],
};

function mockApi(solicitacao: unknown | Error = SOLICITACAO) {
  vi.mocked(api.get).mockImplementation(((url: string) => {
    if (url === '/api/v1/commercial-requests/9') {
      return solicitacao instanceof Error ? Promise.reject(solicitacao) : Promise.resolve(solicitacao);
    }
    if (url === '/api/v1/commercial-requests/999') return Promise.reject(new Error('nao encontrada'));
    return Promise.resolve({ data: [] });
  }) as typeof api.get);
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CotacaoNova />
    </QueryClientProvider>,
  );
}

describe('CotacaoNova: estrutura visual (F5)', () => {
  beforeEach(() => {
    ctx.search = '';
    ctx.role = 'admin';
    ctx.navigate.mockReset();
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
    mockApi();
  });

  it('stepper no passo 1 (Cotação atual) e no passo 2 (Cotação feito, Itens atual)', () => {
    const { container } = renderPage();
    const etapas = screen.getByRole('region', { name: 'Etapas da nova cotação' });
    expect(etapas.querySelector('[aria-current="step"]')?.textContent).toBe('1Cotação');
    expect(etapas.querySelectorAll('.stepper__passo--feito')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: /Próximo/ }));
    const apos = container.querySelector('.stepper') as HTMLElement;
    expect(apos.querySelector('[aria-current="step"]')?.textContent).toBe('2Itens do catálogo');
    expect(apos.querySelector('.stepper__passo--feito svg[aria-hidden="true"]')).not.toBeNull();
    expect(apos.querySelectorAll('[aria-current]')).toHaveLength(1);
  });

  it('passo 1: fieldset com legend "Incoterms aceitáveis *" e chips com aria-pressed que alternam', () => {
    const { container } = renderPage();
    const grupo = screen.getByRole('group', { name: 'Incoterms aceitáveis *' });
    expect(grupo.tagName).toBe('FIELDSET');
    expect(grupo.querySelector('legend')?.textContent).toBe('Incoterms aceitáveis *');
    expect(within(grupo).getAllByRole('button')).toHaveLength(11);
    const fob = within(grupo).getByRole('button', { name: 'FOB' });
    const exw = within(grupo).getByRole('button', { name: 'EXW' });
    expect(fob.getAttribute('aria-pressed')).toBe('true');
    expect(exw.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(exw);
    expect(exw.getAttribute('aria-pressed')).toBe('true');
    expect(exw.classList.contains('chip--active')).toBe(true);
    fireEvent.click(fob);
    expect(fob.getAttribute('aria-pressed')).toBe('false');
    expect(fob.classList.contains('chip--active')).toBe(false);
    expect(container.querySelectorAll('.chip[aria-pressed]')).toHaveLength(11);
  });

  it('passo 1: dica do codigo ligada por aria-describedby; codigo e moeda em mono (classes)', () => {
    renderPage();
    const codigo = screen.getByLabelText('Código') as HTMLInputElement;
    const dica = document.getElementById(codigo.getAttribute('aria-describedby') ?? '');
    expect(dica?.textContent).toBe('Será gerado automaticamente se ficar em branco.');
    expect(dica?.classList.contains('field-hint')).toBe(true);
    expect(codigo.classList.contains('cotacao-nova__codigo')).toBe(true);
    expect((screen.getByLabelText('Moeda *') as HTMLElement).classList.contains('cotacao-nova__moeda')).toBe(true);
  });

  it('erro de passo em .alert--error com role=alert; "Próximo" tem icone aria-hidden', () => {
    renderPage();
    expect(screen.getByRole('button', { name: 'Próximo' }).querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'FOB' }));
    fireEvent.click(screen.getByRole('button', { name: 'Próximo' }));
    const alerta = screen.getByRole('alert');
    expect(alerta.classList.contains('alert--error')).toBe(true);
    expect(alerta.textContent).toBe('Selecione ao menos um incoterm aceitável.');
  });

  it('erro de envio (passo 2) em .alert--error com role=alert; "Voltar" tem icone e "Remover" e danger-button', async () => {
    ctx.search = 'fromCommercialRequest=9';
    vi.mocked(api.post).mockRejectedValue(new Error('Falha ao criar a cotação.'));
    renderPage();
    await screen.findByRole('status');
    fireEvent.click(screen.getByRole('button', { name: 'Próximo' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Adicionar item' })).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Remover' }).classList.contains('danger-button')).toBe(true);
    expect(screen.getByRole('button', { name: 'Voltar' }).querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByRole('button', { name: 'Adicionar item' }).querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Criar cotação' }));
    const alerta = await screen.findByRole('alert');
    expect(alerta.classList.contains('alert--error')).toBe(true);
    expect(alerta.textContent).toBe('Falha ao criar a cotação.');
  });

  it('tabela de itens: contorno proprio (.table-wrapper.cotacao-nova__tabela) e colunas numericas', async () => {
    ctx.search = 'fromCommercialRequest=9';
    const { container } = renderPage();
    await screen.findByRole('status');
    fireEvent.click(screen.getByRole('button', { name: 'Próximo' }));
    await screen.findByText('Resina X');
    expect(container.querySelector('.table-wrapper.cotacao-nova__tabela table.table')).not.toBeNull();
    expect(screen.getByRole('columnheader', { name: 'Qtd' }).classList.contains('cotacao-nova__dir')).toBe(true);
    expect(screen.getByText('10,50 USD').classList.contains('cotacao-nova__num')).toBe(true);
    expect(container.querySelector('.row-actions.row-actions--nowrap')).not.toBeNull();
  });

  it('vinculo: .alert--success com role=status, icone aria-hidden e o texto de sempre num no so', async () => {
    ctx.search = 'fromCommercialRequest=9';
    renderPage();
    const vinculo = await screen.findByText('Vinculada à solicitação #9 do comercial');
    expect(vinculo.tagName).toBe('P');
    expect(vinculo.getAttribute('role')).toBe('status');
    expect(vinculo.classList.contains('alert')).toBe(true);
    expect(vinculo.classList.contains('alert--success')).toBe(true);
    expect(vinculo.classList.contains('cotacao-nova__vinculo')).toBe(true);
    expect(vinculo.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(vinculo.querySelector('path')?.getAttribute('d')).toContain('M10 14a4 4 0 0 0 5.7 0');
    expect(vinculo.textContent).toBe('Vinculada à solicitação #9 do comercial');
  });

  it('aviso de vinculo: .alert--warning com role=alert e o texto de sempre', async () => {
    ctx.search = 'fromCommercialRequest=999';
    renderPage();
    const aviso = await screen.findByRole('alert');
    expect(aviso.classList.contains('alert--warning')).toBe(true);
    expect(aviso.textContent).toBe('Solicitação #999 não pode mais ser vinculada (não encontrada).');
  });

  it('sem permissao (viewer): icone lock, texto de sempre e "Voltar" com icone', () => {
    ctx.role = 'viewer';
    const { container } = renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Nova cotação' })).toBeTruthy();
    const vazio = container.querySelector('.empty-state') as HTMLElement;
    expect(vazio.querySelector('.empty-state__icon svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(vazio.querySelector('.empty-state__icon path')?.getAttribute('d')).toBe('M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4M12 15v2');
    expect(vazio.querySelector('.empty-state__title')?.textContent).toBe('Seu perfil não tem permissão para criar cotações.');
    const voltar = screen.getByRole('button', { name: 'Voltar' });
    expect(voltar.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    fireEvent.click(voltar);
    expect(ctx.navigate).toHaveBeenCalledWith('/cotacoes');
    expect(container.querySelector('.stepper')).toBeNull();
  });

  it('sem vinculo e sem Forecast: nenhum role=status nem role=alert no carregamento (o teste do Forecast exige um unico status)', () => {
    renderPage();
    expect(screen.queryAllByRole('status')).toHaveLength(0);
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('nenhum [style] na pagina (passo 1, passo 2 e modal do item)', async () => {
    ctx.search = 'fromCommercialRequest=9';
    const { container } = renderPage();
    await screen.findByRole('status');
    expect(container.querySelectorAll('[style]')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Próximo' }));
    await screen.findByText('Resina X');
    expect(container.querySelectorAll('[style]')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar item' }));
    await waitFor(() => expect(container.querySelector('.item-picker')).not.toBeNull());
    expect(container.querySelectorAll('[style]')).toHaveLength(0);
  });
});
