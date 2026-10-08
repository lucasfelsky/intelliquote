import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConfirmProvider } from '@/components/useConfirm';
import { CreditPartnersSection } from './CreditPartnersSection';

let mockRole = 'comprador';
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, name: 'U', email: 'u@b.c', role: mockRole } }),
}));

vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() },
  ApiError: class ApiError extends Error {},
}));

import { api } from '@/api/client';

function partner(id: number, name: string, isActive: boolean) {
  return {
    id,
    name,
    taxId: null,
    website: null,
    country: 'BR',
    notes: null,
    isActive,
    createdAt: '2026-10-07T12:00:00.000Z',
    updatedAt: '2026-10-07T12:00:00.000Z',
    contacts: [
      {
        id: id * 10,
        name: `Contato ${name}`,
        email: `contato@${name.toLowerCase().replace(/\s+/g, '')}.com`,
        phone: null,
        position: null,
        isPrimary: true,
      },
    ],
  };
}

function mockList(rows: ReturnType<typeof partner>[]) {
  vi.mocked(api.get).mockImplementation((async () => rows) as typeof api.get);
}

function renderSection() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ConfirmProvider>
        <CreditPartnersSection />
      </ConfirmProvider>
    </QueryClientProvider>,
  );
}

describe('CreditPartnersSection', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
    vi.mocked(api.put).mockReset();
    vi.mocked(api.del).mockReset();
    mockRole = 'comprador';
  });

  it('viewer nao ve "Novo parceiro" nem acoes e recebe aviso de somente leitura', async () => {
    mockRole = 'viewer';
    mockList([partner(1, 'Banco Alfa', true)]);
    renderSection();

    expect(await screen.findByText('Banco Alfa')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Novo parceiro' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Editar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Excluir' })).toBeNull();
    expect(screen.getByText(/Apenas consulta/)).toBeTruthy();
  });

  it('admin e gestor veem "Novo parceiro" e as acoes Editar/Excluir', async () => {
    mockRole = 'gestor';
    mockList([partner(1, 'Banco Alfa', true)]);
    renderSection();

    expect(await screen.findByRole('button', { name: 'Novo parceiro' })).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Editar' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Excluir' })).toBeTruthy();
    expect(screen.queryByText(/Apenas consulta/)).toBeNull();
  });

  it('comprador e somente consulta: sem Novo/Editar/Excluir e com aviso', async () => {
    mockRole = 'comprador';
    mockList([partner(1, 'Banco Alfa', true)]);
    renderSection();

    expect(await screen.findByText('Banco Alfa')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Novo parceiro' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Editar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Excluir' })).toBeNull();
    expect(screen.getByText(/Apenas consulta/)).toBeTruthy();
  });

  it('coluna de acoes tem nome acessivel para quem pode editar', async () => {
    mockRole = 'admin';
    mockList([partner(1, 'Banco Alfa', true)]);
    renderSection();

    expect(await screen.findByRole('columnheader', { name: 'Ações' })).toBeTruthy();
  });

  it('com 1 ativo + 1 inativo, "Padrao" aparece so no ativo', async () => {
    mockList([partner(1, 'Banco Alfa', true), partner(2, 'Banco Beta', false)]);
    renderSection();

    const alfaRow = (await screen.findByText('Banco Alfa')).closest('tr') as HTMLElement;
    const betaRow = screen.getByText('Banco Beta').closest('tr') as HTMLElement;
    expect(within(alfaRow).getByText('Padrão')).toBeTruthy();
    expect(within(betaRow).queryByText('Padrão')).toBeNull();
    expect(within(betaRow).getByText('Inativo')).toBeTruthy();
  });

  it('com 2 ativos nao mostra "Padrao"', async () => {
    mockList([partner(1, 'Banco Alfa', true), partner(2, 'Banco Beta', true)]);
    renderSection();

    await screen.findByText('Banco Alfa');
    expect(screen.queryByText('Padrão')).toBeNull();
  });

  it('falha no GET mostra erro local sem lancar excecao', async () => {
    mockRole = 'admin';
    vi.mocked(api.get).mockRejectedValue(new Error('404 Not Found'));
    renderSection();

    expect(await screen.findByText(/Não foi possível carregar os parceiros de crédito/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Novo parceiro' })).toBeTruthy();
  });

  it('submit do modal chama api.post com o contato principal', async () => {
    mockRole = 'admin';
    mockList([]);
    vi.mocked(api.post).mockResolvedValue(partner(9, 'Banco Novo', true));
    renderSection();

    fireEvent.click(await screen.findByRole('button', { name: 'Novo parceiro' }));
    fireEvent.change(screen.getByLabelText('Nome *', { selector: '#cp-name' }), {
      target: { value: '  Banco Novo ' },
    });
    fireEvent.change(screen.getByLabelText('Nome *', { selector: '[id$="-name"]:not(#cp-name)' }), {
      target: { value: 'Maria' },
    });
    fireEvent.change(screen.getByLabelText('E-mail *'), {
      target: { value: 'maria@banconovo.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar parceiro' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    const [path, body] = vi.mocked(api.post).mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe('/v1/credit-partners');
    expect(body).toMatchObject({
      name: 'Banco Novo',
      isActive: true,
      contacts: [{ name: 'Maria', email: 'maria@banconovo.com', isPrimary: true }],
    });
  });

  it('email invalido bloqueia o submit sem chamar a API', async () => {
    mockRole = 'admin';
    mockList([]);
    renderSection();

    fireEvent.click(await screen.findByRole('button', { name: 'Novo parceiro' }));
    fireEvent.change(screen.getByLabelText('Nome *', { selector: '#cp-name' }), {
      target: { value: 'Banco Novo' },
    });
    fireEvent.change(screen.getByLabelText('Nome *', { selector: '[id$="-name"]:not(#cp-name)' }), {
      target: { value: 'Maria' },
    });
    fireEvent.change(screen.getByLabelText('E-mail *'), { target: { value: 'maria@semdominio' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar parceiro' }));

    expect(await screen.findByText(/E-mail inválido/)).toBeTruthy();
    expect(api.post).not.toHaveBeenCalled();
  });
});
