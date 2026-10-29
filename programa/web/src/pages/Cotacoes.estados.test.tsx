import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import Cotacoes from './Cotacoes';

const auth = vi.hoisted(() => ({ role: 'comprador' }));
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, name: 'U', email: 'u@b.c', role: auth.role } }),
}));
vi.mock('@/components/useConfirm', () => ({ useConfirm: () => async () => true }));
vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() },
  ApiError: class ApiError extends Error {},
}));

import { api } from '@/api/client';

// Cotacoes sinteticas (sem dado real).
function quote(id: number, requestCode: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    requestCode,
    description: null,
    desiredIncoterm: ['FOB', 'CIF'],
    currency: 'USD',
    deadlineAt: null,
    status: 'open',
    createdAt: '2026-10-01T12:00:00.000Z',
    updatedAt: '2026-10-01T12:00:00.000Z',
    closedAt: null,
    reopenedAt: null,
    purchaseOrderSentAt: null,
    createdById: 1,
    isDevelopment: false,
    _count: { items: 2, quoteResponses: 3 },
    ...extra,
  };
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <Cotacoes />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Cotacoes: estados (carregando, vazio, erro) e estrutura da tela', () => {
  beforeEach(() => {
    auth.role = 'comprador';
    vi.mocked(api.get).mockReset();
    vi.mocked(api.del).mockReset();
    vi.mocked(api.post).mockReset();
  });

  it('carregando: section aria-busy, linha role=status "Carregando cotações…" e skeleton aria-hidden com a forma da tabela', () => {
    vi.mocked(api.get).mockImplementation((() => new Promise(() => {})) as typeof api.get);
    const { container } = renderPage();
    const secao = container.querySelector('section[aria-busy="true"]') as HTMLElement;
    expect(secao).not.toBeNull();
    const status = within(secao).getByRole('status');
    expect(status.textContent).toBe('Carregando cotações…');
    expect(status.querySelector('.btn-spinner')?.getAttribute('aria-hidden')).toBe('true');
    // cabecalho (1) + 7 linhas de skeleton, todos fora da arvore de acessibilidade
    const cab = secao.querySelector('.cotacoes-skeleton__cab');
    expect(cab?.getAttribute('aria-hidden')).toBe('true');
    const linhas = secao.querySelectorAll('.cotacoes-skeleton__linha');
    expect(linhas).toHaveLength(7);
    expect(linhas[0]?.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(secao.querySelectorAll('.skeleton').length).toBeGreaterThan(7 * 4);
    expect(screen.queryByRole('table')).toBeNull();
    // um unico role=status no carregamento
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });

  it('erro: role=alert com icone, titulo e texto; "Tentar novamente" (secundario com icone) consulta a API de novo', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('falha de rede'));
    const { container } = renderPage();
    const alerta = await screen.findByRole('alert');
    expect(alerta.classList.contains('empty-state--erro')).toBe(true);
    expect(within(alerta).getByText('Não foi possível carregar as cotações.')).toBeTruthy();
    expect(within(alerta).getByText('Verifique sua conexão e tente novamente.')).toBeTruthy();
    expect(alerta.querySelector('.empty-state__icon svg')?.getAttribute('aria-hidden')).toBe('true');
    const tentar = within(alerta).getByRole('button', { name: 'Tentar novamente' });
    expect(tentar.classList.contains('ghost-button')).toBe(true);
    expect(tentar.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelector('section[aria-busy="true"]')).toBeNull();
    const antes = vi.mocked(api.get).mock.calls.length;
    vi.mocked(api.get).mockResolvedValue([quote(1, 'QR-001')]);
    fireEvent.click(tentar);
    await waitFor(() => expect(vi.mocked(api.get).mock.calls.length).toBeGreaterThan(antes));
    expect(await screen.findByText('QR-001')).toBeTruthy();
    expect(screen.queryByText('Não foi possível carregar as cotações.')).toBeNull();
  });

  it('vazio sem filtros (pode criar), com filtros e sem permissao: os textos de sempre, com icone filter', async () => {
    vi.mocked(api.get).mockResolvedValue([]);
    const { container, unmount } = renderPage();
    expect(await screen.findByText('Nenhuma cotação encontrada')).toBeTruthy();
    expect(screen.getByText('Use o botão “Nova cotação” para começar.')).toBeTruthy();
    const vazio = container.querySelector('.empty-state') as HTMLElement;
    expect(vazio.querySelector('.empty-state__icon svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(vazio.querySelector('.empty-state__icon path')?.getAttribute('d')).toBe('M3 5h18l-7 8v6l-4 2v-8z');
    expect(vazio.querySelector('strong.empty-state__title')).not.toBeNull();
    expect(vazio.querySelector('p.empty-state__text')).not.toBeNull();

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'fechadas' } });
    expect(await screen.findByText('Ajuste ou limpe os filtros para ver outras cotações.')).toBeTruthy();
    unmount();

    auth.role = 'viewer';
    renderPage();
    expect(await screen.findByText('Aguarde o cadastro de novas cotações.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Nova cotação' })).toBeNull();
  });

  it('erro de acao (apagar) aparece em .alert--error com role=alert', async () => {
    vi.mocked(api.get).mockResolvedValue([quote(1, 'QR-001')]);
    vi.mocked(api.del).mockRejectedValue(new Error('Cotação já tem pedido de compra.'));
    renderPage();
    await screen.findByText('QR-001');
    fireEvent.click(screen.getByRole('button', { name: 'Apagar' }));
    const alerta = await screen.findByRole('alert');
    expect(alerta.classList.contains('alert')).toBe(true);
    expect(alerta.classList.contains('alert--error')).toBe(true);
    expect(alerta.textContent).toBe('Cotação já tem pedido de compra.');
  });

  it('rotulos visiveis "Buscar" e "Status" (e "Incoterm") associados; PO e Mês mantem o aria-label de sempre', async () => {
    vi.mocked(api.get).mockResolvedValue([quote(1, 'QR-001')]);
    const { container } = renderPage();
    await screen.findByText('QR-001');
    const filtros = screen.getByRole('region', { name: 'Filtros' });
    const busca = within(filtros).getByLabelText('Buscar') as HTMLInputElement;
    expect(busca.placeholder).toBe('Buscar por código ou produto');
    expect((within(filtros).getByLabelText('Status') as HTMLSelectElement).tagName).toBe('SELECT');
    expect((within(filtros).getByLabelText('Incoterm') as HTMLSelectElement).tagName).toBe('SELECT');
    // rotulo visivel contido no nome acessivel (WCAG 2.5.3)
    const po = within(filtros).getByLabelText('Filtro de PO enviada') as HTMLSelectElement;
    const mes = within(filtros).getByLabelText('Filtro de mês') as HTMLSelectElement;
    expect(container.querySelector(`label[for="${po.id}"]`)?.textContent).toBe('PO');
    expect(container.querySelector(`label[for="${mes.id}"]`)?.textContent).toBe('Mês');
    expect('Filtro de PO enviada'.toLowerCase()).toContain('po');
    expect('Filtro de mês').toContain('mês');
    // a busca tem icone decorativo
    expect(filtros.querySelector('.cotacoes-busca svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('"Nova cotação" tem icone svg aria-hidden e o nome acessivel sem o "+"', async () => {
    vi.mocked(api.get).mockResolvedValue([quote(1, 'QR-001')]);
    renderPage();
    await screen.findByText('QR-001');
    const botao = screen.getByRole('button', { name: 'Nova cotação' });
    expect(botao.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(botao.textContent).toBe('Nova cotação');
  });

  it('selos com ponto (badge--dot): status, PO enviada e Reaberta; faixa "Desenvolvimento" ao lado do codigo', async () => {
    vi.mocked(api.get).mockResolvedValue([
      quote(1, 'QR-001', { purchaseOrderSentAt: '2026-10-05T15:30:00.000Z' }),
      quote(2, 'QR-002', { status: 'closed' }),
      quote(3, 'QR-003', { reopenedAt: '2026-10-14T15:00:00.000Z' }),
      quote(4, 'QR-004', { isDevelopment: true }),
    ]);
    renderPage();
    const linha = async (codigo: string) => (await screen.findByText(codigo)).closest('tr') as HTMLElement;
    const l1 = await linha('QR-001');
    expect(within(l1).getByText('Aberta').classList.contains('badge--dot')).toBe(true);
    expect(within(l1).getByText('PO enviada').classList.contains('badge--dot')).toBe(true);
    const l2 = await linha('QR-002');
    const fechada = within(l2).getByText('Fechada');
    expect(fechada.classList.contains('badge--muted')).toBe(true);
    expect(fechada.classList.contains('badge--dot')).toBe(true);
    const l3 = await linha('QR-003');
    const reaberta = within(l3).getByText('Reaberta', { exact: false });
    expect(reaberta.classList.contains('badge--warning')).toBe(true);
    expect(reaberta.classList.contains('badge--dot')).toBe(true);
    const l4 = await linha('QR-004');
    expect(within(l4).getByText('Desenvolvimento').classList.contains('badge--info')).toBe(true);
    // o codigo e texto em mono, nao link
    expect(within(l1).getByText('QR-001').closest('a')).toBeNull();
    expect(within(l1).getByText('QR-001').classList.contains('cotacoes-codigo')).toBe(true);
  });

  it('colunas numericas a direita e acoes na linha: Ver, Editar e Apagar (danger-button)', async () => {
    vi.mocked(api.get).mockResolvedValue([quote(1, 'QR-001')]);
    renderPage();
    const linha = (await screen.findByText('QR-001')).closest('tr') as HTMLElement;
    expect(within(linha).getByRole('button', { name: 'Ver' })).toBeTruthy();
    expect(within(linha).getByRole('button', { name: 'Editar' })).toBeTruthy();
    expect(within(linha).getByRole('button', { name: 'Apagar' }).classList.contains('danger-button')).toBe(true);
    expect(linha.querySelectorAll('td.cotacoes-num')).toHaveLength(2);
    expect(screen.getByRole('columnheader', { name: 'Itens' }).classList.contains('cotacoes-dir')).toBe(true);
  });

  it('nenhum [style] na pagina (carregando, lista, vazio e erro)', async () => {
    vi.mocked(api.get).mockImplementation((() => new Promise(() => {})) as typeof api.get);
    const carregando = renderPage();
    expect(carregando.container.querySelectorAll('[style]')).toHaveLength(0);
    carregando.unmount();

    vi.mocked(api.get).mockResolvedValue([quote(1, 'QR-001')]);
    const lista = renderPage();
    await screen.findByText('QR-001');
    expect(lista.container.querySelectorAll('[style]')).toHaveLength(0);
    lista.unmount();

    vi.mocked(api.get).mockResolvedValue([]);
    const vazio = renderPage();
    await screen.findByText('Nenhuma cotação encontrada');
    expect(vazio.container.querySelectorAll('[style]')).toHaveLength(0);
    vazio.unmount();

    vi.mocked(api.get).mockRejectedValue(new Error('x'));
    const erro = renderPage();
    await screen.findByText('Não foi possível carregar as cotações.');
    expect(erro.container.querySelectorAll('[style]')).toHaveLength(0);
  });
});
