import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConfirmProvider } from '@/components/useConfirm';
import Forwarders from './Forwarders';

let mockRole = 'comprador';
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, name: 'U', email: 'u@b.c', role: mockRole } }),
}));

vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() },
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

import { api, ApiError } from '@/api/client';

function forwarder(id: number, companyName: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    companyName,
    address: `Rua ${companyName}, 1`,
    website: null,
    notes: null,
    isActive: true,
    isDefault: false,
    createdAt: '2026-10-08T12:00:00.000Z',
    updatedAt: '2026-10-08T12:00:00.000Z',
    contacts: [
      {
        id: id * 10,
        name: `Contato ${companyName}`,
        email: `contato@${companyName.toLowerCase().replace(/\s+/g, '')}.com`,
        phone: null,
      },
    ],
    ...extra,
  };
}

function mockList(rows: ReturnType<typeof forwarder>[]) {
  vi.mocked(api.get).mockImplementation((async () => rows) as typeof api.get);
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ConfirmProvider>
        <Forwarders />
      </ConfirmProvider>
    </QueryClientProvider>,
  );
}

describe('Forwarders (pagina)', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
    vi.mocked(api.put).mockReset();
    vi.mocked(api.del).mockReset();
    mockRole = 'comprador';
  });

  it('lista com badge Padrao, contatos (1o + N) e Definir como padrao so nos ativos nao padrao', async () => {
    mockList([
      forwarder(1, 'Global Cargo', {
        isDefault: true,
        contacts: [
          { id: 10, name: 'Maria', email: 'maria@g.com', phone: null },
          { id: 11, name: 'Beto', email: null, phone: null },
          { id: 12, name: 'Caio', email: null, phone: null },
        ],
      }),
      forwarder(2, 'Sea Link'),
      forwarder(3, 'Velho Cargo', { isActive: false }),
    ]);
    renderPage();

    const globalRow = (await screen.findByText('Global Cargo')).closest('tr') as HTMLElement;
    expect(within(globalRow).getByText('Padrão')).toBeTruthy();
    expect(within(globalRow).getByText('Maria +2')).toBeTruthy();
    expect(within(globalRow).queryByRole('button', { name: 'Definir como padrão' })).toBeNull();

    const seaRow = screen.getByText('Sea Link').closest('tr') as HTMLElement;
    expect(within(seaRow).queryByText('Padrão')).toBeNull();
    expect(within(seaRow).getByRole('button', { name: 'Definir como padrão' })).toBeTruthy();

    const oldRow = screen.getByText('Velho Cargo').closest('tr') as HTMLElement;
    expect(within(oldRow).getByText('Inativo')).toBeTruthy();
    expect(within(oldRow).queryByRole('button', { name: 'Definir como padrão' })).toBeNull();
    expect(api.get).toHaveBeenCalledWith('/v1/forwarders', undefined);
  });

  it('comprador cria um forwarder (payload com contacts)', async () => {
    mockList([]);
    vi.mocked(api.post).mockResolvedValue(forwarder(9, 'Nova Cargo'));
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: '+ Novo forwarder' }));
    fireEvent.change(screen.getByLabelText('Empresa *'), { target: { value: ' Nova Cargo ' } });
    fireEvent.change(screen.getByLabelText('Endereço'), { target: { value: 'Rua Nova, 5' } });
    fireEvent.change(screen.getByLabelText('Nome *'), { target: { value: 'Ana' } });
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'ana@nova.com' } });
    fireEvent.change(screen.getByLabelText('Telefone'), { target: { value: '+55 11 1' } });
    fireEvent.click(screen.getByLabelText('Padrão no envio da PO'));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar forwarder' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(api.post).toHaveBeenCalledWith('/v1/forwarders', {
      companyName: 'Nova Cargo',
      address: 'Rua Nova, 5',
      website: null,
      notes: null,
      isActive: true,
      isDefault: true,
      contacts: [{ name: 'Ana', email: 'ana@nova.com', phone: '+55 11 1' }],
    });
  });

  it('contato sem e-mail e aceito (e-mail e opcional)', async () => {
    mockList([]);
    vi.mocked(api.post).mockResolvedValue(forwarder(9, 'Nova Cargo'));
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: '+ Novo forwarder' }));
    fireEvent.change(screen.getByLabelText('Empresa *'), { target: { value: 'Nova Cargo' } });
    fireEvent.change(screen.getByLabelText('Nome *'), { target: { value: 'Ana' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar forwarder' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    const body = vi.mocked(api.post).mock.calls[0]?.[1] as { contacts: unknown[] };
    expect(body.contacts).toEqual([{ name: 'Ana', email: null, phone: null }]);
  });

  it('Definir como padrao chama PUT { isDefault: true }', async () => {
    mockList([forwarder(1, 'Global Cargo', { isDefault: true }), forwarder(2, 'Sea Link')]);
    vi.mocked(api.put).mockResolvedValue(forwarder(2, 'Sea Link', { isDefault: true }));
    renderPage();

    const seaRow = (await screen.findByText('Sea Link')).closest('tr') as HTMLElement;
    fireEvent.click(within(seaRow).getByRole('button', { name: 'Definir como padrão' }));

    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    expect(api.put).toHaveBeenCalledWith('/v1/forwarders/2', { isDefault: true });
  });

  it('excluir pede confirmacao e chama DELETE', async () => {
    mockList([forwarder(2, 'Sea Link')]);
    vi.mocked(api.del).mockResolvedValue({ id: 2 });
    renderPage();

    const row = (await screen.findByText('Sea Link')).closest('tr') as HTMLElement;
    const rowButton = within(row).getByRole('button', { name: 'Excluir' });
    fireEvent.click(rowButton);

    // O botao de confirmacao do dialog tambem se chama "Excluir".
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: 'Excluir', hidden: true })).toHaveLength(2),
    );
    expect(api.del).not.toHaveBeenCalled();
    const confirmButton = screen
      .getAllByRole('button', { name: 'Excluir', hidden: true })
      .find((button) => button !== rowButton);
    if (!confirmButton) throw new Error('botao de confirmacao nao encontrado');
    fireEvent.click(confirmButton);

    await waitFor(() => expect(api.del).toHaveBeenCalledWith('/v1/forwarders/2'));
  });

  it('viewer nao ve "+ Novo forwarder", Editar nem Excluir; so Ver (somente leitura)', async () => {
    mockRole = 'viewer';
    mockList([forwarder(1, 'Global Cargo')]);
    renderPage();

    expect(await screen.findByText('Global Cargo')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '+ Novo forwarder' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Editar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Excluir' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Definir como padrão' })).toBeNull();
    expect(screen.getByText(/Apenas consulta/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Ver' }));
    // O fieldset desabilitado cobre todos os campos (a propriedade .disabled do input nao reflete isso).
    expect(screen.getByLabelText('Empresa *').matches(':disabled')).toBe(true);
    expect(screen.queryByRole('button', { name: 'Salvar forwarder' })).toBeNull();
  });

  it('erro 409 do backend aparece na tela', async () => {
    mockList([]);
    vi.mocked(api.post).mockRejectedValue(new ApiError(409, { message: 'Ja existe um forwarder com esse nome.' }));
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: '+ Novo forwarder' }));
    fireEvent.change(screen.getByLabelText('Empresa *'), { target: { value: 'Global Cargo' } });
    fireEvent.change(screen.getByLabelText('Nome *'), { target: { value: 'Ana' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar forwarder' }));

    expect(await screen.findByText('Ja existe um forwarder com esse nome.')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Ja existe um forwarder');
  });
});
