import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import IndentFornecedorModal, { contadorProdutos } from './IndentFornecedorModal';
import type { IndentSupplier } from '@/services/indent';

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

const OPCOES = [
  { id: 1, name: 'Ácido cítrico anidro', cas: '77-92-9', isActive: true },
  { id: 2, name: 'Tripolifosfato de sódio', cas: '7758-29-4', isActive: true },
  { id: 3, name: 'Ureia técnica', cas: null, isActive: true },
];

const EXISTENTE: IndentSupplier = {
  id: 7,
  name: 'Shandong Haohua Chemical Co.',
  country: 'China',
  contactName: 'Wei Zhang',
  type: 'FABRICANTE',
  defaultCurrency: 'USD',
  defaultIncoterm: 'CFR',
  hasPartnership: false,
  importedFromIq: false,
  isActive: true,
  createdAt: '2026-11-12T12:00:00.000Z',
  updatedAt: '2026-11-12T12:00:00.000Z',
  approvedBy: 0,
  blockedBy: 0,
  products: [
    { id: 1, name: 'Ácido cítrico anidro', isActive: true },
    { id: 9, name: 'Solvente descontinuado', isActive: false },
  ],
};

function renderModal(supplier: IndentSupplier | null, onSaved = vi.fn(), onClose = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={qc}>
      <IndentFornecedorModal supplier={supplier} onClose={onClose} onSaved={onSaved} />
    </QueryClientProvider>,
  );
  return { ...view, onSaved, onClose };
}

async function dialogo(nome: string) {
  const dialog = await screen.findByRole('dialog', { name: nome });
  await within(dialog).findByText('Tripolifosfato de sódio');
  return dialog;
}

describe('IndentFornecedorModal', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset().mockImplementation((async (url: string) => (url === '/api/v1/indent/products/options' ? OPCOES : [])) as typeof api.get);
    vi.mocked(api.post).mockReset().mockResolvedValue({});
    vi.mocked(api.put).mockReset().mockResolvedValue({});
  });

  it('contador de ajuda: 0, 1 e N (no plural)', () => {
    expect(contadorProdutos(0)).toBe('Nenhum produto selecionado.');
    expect(contadorProdutos(1)).toBe('1 produto selecionado.');
    expect(contadorProdutos(2)).toBe('2 produtos selecionados.');
    expect(contadorProdutos(12)).toBe('12 produtos selecionados.');
  });

  it('novo: eyebrow "Novo fornecedor", titulo "Cadastro", campos do mock, padroes Trading/USD/CFR e a secao "Produtos que fornece"', async () => {
    const { container } = renderModal(null);
    const dialog = await dialogo('Cadastro');

    const eyebrow = container.querySelector('.modal-eyebrow');
    expect(eyebrow?.textContent).toBe('Novo fornecedor');
    expect(eyebrow?.nextElementSibling?.tagName).toBe('H2');

    for (const rotulo of ['Razão social', 'País', 'Contato', 'Tipo', 'Moeda padrão', 'Incoterm padrão']) {
      expect(within(dialog).getByLabelText(rotulo), rotulo).toBeTruthy();
    }
    expect((within(dialog).getByLabelText('Tipo') as HTMLSelectElement).value).toBe('TRADING');
    expect((within(dialog).getByLabelText('Moeda padrão') as HTMLSelectElement).value).toBe('USD');
    expect((within(dialog).getByLabelText('Incoterm padrão') as HTMLSelectElement).value).toBe('CFR');
    const tipos = Array.from((within(dialog).getByLabelText('Tipo') as HTMLSelectElement).options).map((o) => o.textContent);
    expect(tipos).toEqual(['Fabricante', 'Trading', 'Importado']);
    expect(Array.from((within(dialog).getByLabelText('Moeda padrão') as HTMLSelectElement).options).map((o) => o.textContent)).toEqual(['USD', 'EUR']);
    expect(Array.from((within(dialog).getByLabelText('Incoterm padrão') as HTMLSelectElement).options).map((o) => o.textContent)).toEqual(['CFR', 'CIF', 'FOB']);

    // secao "Produtos que fornece": rotulo + busca (aria-labelledby) + caixa + contador
    expect(within(dialog).getByText('Produtos que fornece')).toBeTruthy();
    const busca = within(dialog).getByPlaceholderText('Buscar produto por nome ou CAS');
    expect(busca.getAttribute('aria-labelledby')).toBe(within(dialog).getByText('Produtos que fornece').id);
    expect(within(dialog).getByRole('textbox', { name: 'Produtos que fornece' })).toBe(busca);
    expect(container.querySelector('.indent-produtos-caixa')).not.toBeNull();
    expect(within(dialog).getByText('Nenhum produto selecionado.')).toBeTruthy();
    expect(within(dialog).getByText('CAS 77-92-9')).toBeTruthy();
    expect(within(dialog).getByText('sem CAS')).toBeTruthy();

    // bloco de parceria
    expect(within(dialog).getByText('Parceria firmada', { selector: 'strong' })).toBeTruthy();
    expect(
      within(dialog).getByText(
        'Com parceria, o nome do cliente final pode ser mostrado ao fornecedor. Sem parceria, a SQ aparece, mas nunca como compradora, e nenhum dado do cliente final é exibido.',
      ),
    ).toBeTruthy();
    expect((within(dialog).getByRole('switch', { name: 'Parceria firmada' }) as HTMLInputElement).checked).toBe(false);
    expect(within(dialog).getByRole('button', { name: 'Cancelar' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Salvar' })).toBeTruthy();
  });

  it('editar: eyebrow "Editar fornecedor", titulo com o nome, campos preenchidos e a secao de produtos tambem aparece', async () => {
    const { container } = renderModal(EXISTENTE);
    const dialog = await dialogo('Shandong Haohua Chemical Co.');
    expect(container.querySelector('.modal-eyebrow')?.textContent).toBe('Editar fornecedor');
    expect((within(dialog).getByLabelText('Razão social') as HTMLInputElement).value).toBe('Shandong Haohua Chemical Co.');
    expect((within(dialog).getByLabelText('País') as HTMLInputElement).value).toBe('China');
    expect((within(dialog).getByLabelText('Contato') as HTMLInputElement).value).toBe('Wei Zhang');
    expect((within(dialog).getByLabelText('Tipo') as HTMLSelectElement).value).toBe('FABRICANTE');
    expect(within(dialog).getByText('Produtos que fornece')).toBeTruthy();
  });

  it('busca por nome e por CAS, sem acento e sem diferenciar caixa; "Nenhum produto encontrado."', async () => {
    renderModal(null);
    const dialog = await dialogo('Cadastro');
    const busca = within(dialog).getByPlaceholderText('Buscar produto por nome ou CAS');

    fireEvent.change(busca, { target: { value: 'ACIDO CITRICO' } });
    expect(within(dialog).getByText('Ácido cítrico anidro')).toBeTruthy();
    expect(within(dialog).queryByText('Ureia técnica')).toBeNull();

    fireEvent.change(busca, { target: { value: '7758' } });
    expect(within(dialog).getByText('Tripolifosfato de sódio')).toBeTruthy();
    expect(within(dialog).queryByText('Ácido cítrico anidro')).toBeNull();

    fireEvent.change(busca, { target: { value: 'inexistente' } });
    expect(within(dialog).getByText('Nenhum produto encontrado.')).toBeTruthy();

    fireEvent.change(busca, { target: { value: '' } });
    expect(within(dialog).getByText('Ácido cítrico anidro')).toBeTruthy();
  });

  it('contador nas 3 formas e contando os marcados FORA do filtro atual', async () => {
    renderModal(null);
    const dialog = await dialogo('Cadastro');
    const busca = within(dialog).getByPlaceholderText('Buscar produto por nome ou CAS');

    expect(within(dialog).getByText('Nenhum produto selecionado.')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Ácido cítrico anidro/ }));
    expect(within(dialog).getByText('1 produto selecionado.')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Tripolifosfato de sódio/ }));
    expect(within(dialog).getByText('2 produtos selecionados.')).toBeTruthy();

    // filtra para mostrar so a Ureia: os 2 marcados fora do filtro continuam contando
    fireEvent.change(busca, { target: { value: 'ureia' } });
    expect(within(dialog).queryByText('Ácido cítrico anidro')).toBeNull();
    expect(within(dialog).getByText('2 produtos selecionados.')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Ureia técnica/ }));
    expect(within(dialog).getByText('3 produtos selecionados.')).toBeTruthy();
  });

  it('produto INATIVO ja vinculado aparece marcado com a tag "Inativo" e continua vinculado ao salvar', async () => {
    const { onSaved } = renderModal(EXISTENTE);
    const dialog = await dialogo('Shandong Haohua Chemical Co.');

    const inativo = within(dialog).getByRole('checkbox', { name: /Solvente descontinuado/ }) as HTMLInputElement;
    expect(inativo.checked).toBe(true);
    expect(within(dialog).getByText('Inativo')).toBeTruthy();
    expect(within(dialog).getByText('2 produtos selecionados.')).toBeTruthy();
    expect((within(dialog).getByRole('checkbox', { name: /Ácido cítrico anidro/ }) as HTMLInputElement).checked).toBe(true);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.put).mock.calls[0]?.[1]).toMatchObject({ productIds: [1, 9] });
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('Cadastro de Shandong Haohua Chemical Co. atualizado'));
  });

  it('Salvar (novo) envia productIds no POST e confirma com "Fornecedor X cadastrado"', async () => {
    const { onSaved } = renderModal(null);
    const dialog = await dialogo('Cadastro');

    fireEvent.change(within(dialog).getByLabelText('Razão social'), { target: { value: '  Rotterdam Specialty Trading B.V. ' } });
    fireEvent.change(within(dialog).getByLabelText('País'), { target: { value: 'Países Baixos' } });
    fireEvent.change(within(dialog).getByLabelText('Moeda padrão'), { target: { value: 'EUR' } });
    fireEvent.change(within(dialog).getByLabelText('Incoterm padrão'), { target: { value: 'CIF' } });
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Tripolifosfato de sódio/ }));
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Ureia técnica/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(api.post).toHaveBeenCalledWith('/api/v1/indent/suppliers', {
      name: 'Rotterdam Specialty Trading B.V.',
      country: 'Países Baixos',
      contactName: null,
      type: 'TRADING',
      defaultCurrency: 'EUR',
      defaultIncoterm: 'CIF',
      hasPartnership: false,
      productIds: [2, 3],
    });
    expect(api.put).not.toHaveBeenCalled();
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('Fornecedor Rotterdam Specialty Trading B.V. cadastrado'));
  });

  it('Salvar (novo) sem nenhum produto envia productIds vazio', async () => {
    renderModal(null);
    const dialog = await dialogo('Cadastro');
    fireEvent.change(within(dialog).getByLabelText('Razão social'), { target: { value: 'Acme' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.post).mock.calls[0]?.[1]).toMatchObject({ productIds: [] });
  });

  it('razao social vazia: erro "Informe a razão social." e nada e enviado', async () => {
    renderModal(null);
    const dialog = await dialogo('Cadastro');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }));

    const alerta = within(dialog).getByRole('alert');
    expect(alerta.textContent).toBe('Informe a razão social.');
    expect(within(dialog).getByLabelText('Razão social').getAttribute('aria-invalid')).toBe('true');
    expect(api.post).not.toHaveBeenCalled();
  });

  it('alerta de parceria so no fornecedor EXISTENTE e so quando o switch muda; toasts "Parceria firmada|removida"', async () => {
    const novo = renderModal(null);
    let dialog = await dialogo('Cadastro');
    fireEvent.click(within(dialog).getByRole('switch', { name: 'Parceria firmada' }));
    expect(within(dialog).queryByText(/Ao salvar, os próximos envios/)).toBeNull();
    expect(within(dialog).queryByText(/Ao salvar, os links já enviados/)).toBeNull();
    novo.unmount();

    const ligar = renderModal(EXISTENTE);
    dialog = await dialogo('Shandong Haohua Chemical Co.');
    expect(within(dialog).queryByRole('status')).toBeNull();
    fireEvent.click(within(dialog).getByRole('switch', { name: 'Parceria firmada' }));
    expect(
      within(dialog).getByText(
        'Ao salvar, os próximos envios e os links já enviados passam a poder mostrar o nome do cliente (na opção "Mostrar o nome do cliente" de cada envio).',
      ),
    ).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(ligar.onSaved).toHaveBeenCalledWith('Parceria firmada para Shandong Haohua Chemical Co.'));
    expect(vi.mocked(api.put).mock.calls[0]?.[1]).toMatchObject({ hasPartnership: true });
    ligar.unmount();

    const remover = renderModal({ ...EXISTENTE, hasPartnership: true });
    dialog = await dialogo('Shandong Haohua Chemical Co.');
    fireEvent.click(within(dialog).getByRole('switch', { name: 'Parceria firmada' }));
    expect(
      within(dialog).getByText(
        'Ao salvar, os links já enviados deixam de mostrar o nome do cliente no próximo acesso, e os próximos envios saem sem esse dado.',
      ),
    ).toBeTruthy();
    // voltar ao valor original some com o alerta
    fireEvent.click(within(dialog).getByRole('switch', { name: 'Parceria firmada' }));
    expect(within(dialog).queryByRole('status')).toBeNull();
    fireEvent.click(within(dialog).getByRole('switch', { name: 'Parceria firmada' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(remover.onSaved).toHaveBeenCalledWith('Parceria removida para Shandong Haohua Chemical Co.'));
  });

  it('erro do servidor (nome repetido, 409) aparece no modal e nao fecha', async () => {
    vi.mocked(api.post).mockRejectedValue(new ApiError(409, { message: 'Já existe um fornecedor com este nome no Indent.' }));
    const { onSaved } = renderModal(null);
    const dialog = await dialogo('Cadastro');
    fireEvent.change(within(dialog).getByLabelText('Razão social'), { target: { value: 'Acme' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }));

    expect((await within(dialog).findByRole('alert')).textContent).toBe('Já existe um fornecedor com este nome no Indent.');
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('Cancelar chama onClose sem gravar', async () => {
    const { onClose } = renderModal(EXISTENTE);
    const dialog = await dialogo('Shandong Haohua Chemical Co.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(api.put).not.toHaveBeenCalled();
  });
});
