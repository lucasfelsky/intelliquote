import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { IndentRequestDetail } from '@/services/indentRequests';
import IndentNotaItensModal from './IndentNotaItensModal';

// IQ Indent (PR 5a.5): modal "Revisar itens da nota" / "Digitar itens": foco inicial por data-autofocus, restoreFocus, validacao, payload do PUT
// note-items (cobre TODOS os itens atuais por id; `remove: true` exclui; item novo sem id) e erros do servidor. Dados FICTICIOS.

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

type Obj = Record<string, unknown>;

function item(id: number, nome: string, extra: Obj = {}) {
  return {
    id,
    position: id - 21,
    description: nome,
    name: nome,
    quantityKg: 2000,
    confirmed: false,
    source: 'NOTE',
    noteLine: `${nome}  2.000`,
    productId: null,
    product: null,
    isFree: true,
    ...extra,
  };
}

function solicitacao(items: Obj[], extra: Obj = {}): IndentRequestDetail {
  return {
    id: 11,
    pipedriveDealId: 900111,
    rawNote: 'CFR Santos - Fabricante Exemplo\nRESINA EXEMPLO 223 (RXE)  2.000',
    processNumber: '277/26',
    items,
    ...extra,
  } as unknown as IndentRequestDetail;
}

const CATALOGO = [
  { id: 9, name: 'RESINA EXEMPLO 223 (RXE)', cas: null, isActive: true },
  { id: 10, name: 'Ácido Cítrico Anidro', cas: '77-92-9', isActive: true },
];

let catalogo: 'ok' | 'erro' | 'lento' = 'ok';
let liberarCatalogo: () => void = () => undefined;

function mockApi() {
  vi.mocked(api.get).mockImplementation((async (url: string) => {
    if (url === '/api/v1/indent/products/options') {
      if (catalogo === 'erro') throw new ApiError(500, { message: 'falhou' });
      if (catalogo === 'lento') await new Promise<void>((resolve) => (liberarCatalogo = resolve));
      return CATALOGO;
    }
    return [];
  }) as typeof api.get);
}

const onClose = vi.fn();
const onConfirmed = vi.fn();
const onStale = vi.fn();

function Host({ detalhe, aviso = null }: { detalhe: IndentRequestDetail; aviso?: string | null }) {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setAberto(true)}>
        Abrir
      </button>
      {aberto && (
        <IndentNotaItensModal
          solicitacao={detalhe}
          avisoInicial={aviso}
          onClose={() => {
            onClose();
            setAberto(false);
          }}
          onConfirmed={onConfirmed}
          onStale={onStale}
        />
      )}
    </>
  );
}

async function abrir(detalhe: IndentRequestDetail, aviso: string | null = null) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tela = render(
    <QueryClientProvider client={qc}>
      <div className="indent-page">
        <Host detalhe={detalhe} aviso={aviso} />
      </div>
    </QueryClientProvider>,
  );
  const gatilho = screen.getByRole('button', { name: 'Abrir' });
  gatilho.focus();
  fireEvent.click(gatilho);
  const dialogo = await screen.findByRole('dialog');
  return { ...tela, qc, gatilho, dialogo };
}

async function prontoParaConfirmar(dialogo: HTMLElement) {
  await waitFor(() => expect(within(dialogo).getByRole('button', { name: 'Confirmar itens' }).getAttribute('aria-disabled')).toBeNull());
}

const esperar = () => act(async () => new Promise<void>((resolve) => setTimeout(resolve, 60)));
const confirmar = (dialogo: HTMLElement) => fireEvent.click(within(dialogo).getByRole('button', { name: 'Confirmar itens' }));
const produtos = (dialogo: HTMLElement) => within(dialogo).getAllByLabelText('Produto') as HTMLInputElement[];
const quantidades = (dialogo: HTMLElement) => within(dialogo).getAllByLabelText('Quantidade (kg)') as HTMLInputElement[];

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(api.put).mockReset().mockResolvedValue({});
  onClose.mockReset();
  onConfirmed.mockReset();
  onStale.mockReset();
  catalogo = 'ok';
  mockApi();
});

describe('estrutura, foco e acessibilidade', () => {
  it('eyebrow "Pipedrive · negócio #id", titulo, campos preenchidos, linha original em field-hint e a nota original como texto', async () => {
    const { dialogo } = await abrir(
      solicitacao([item(21, 'RESINA EXEMPLO 223 (RXE)'), item(22, 'SOLVENTE TESTE 99%', { quantityKg: 0, noteLine: 'SOLVENTE TESTE 99%' })]),
    );
    expect(within(dialogo).getByRole('heading', { name: 'Revisar itens da nota' })).toBeTruthy();
    expect(within(dialogo).getByText('Pipedrive · negócio #900111').className).toContain('modal-eyebrow');
    expect(produtos(dialogo).map((el) => el.value)).toEqual(['RESINA EXEMPLO 223 (RXE)', 'SOLVENTE TESTE 99%']);
    // quantidade lida vem em pt-BR; sem quantidade o campo abre vazio
    expect(quantidades(dialogo).map((el) => el.value)).toEqual(['2.000', '']);
    expect(Array.from(dialogo.querySelectorAll('.field-hint')).map((el) => el.textContent)).toEqual([
      'Linha da nota: RESINA EXEMPLO 223 (RXE)  2.000',
      'Linha da nota: SOLVENTE TESTE 99%',
    ]);
    const nota = dialogo.querySelector('pre.indent-nota') as HTMLElement;
    expect(nota.textContent).toBe('CFR Santos - Fabricante Exemplo\nRESINA EXEMPLO 223 (RXE)  2.000');
    expect(within(dialogo).getByText('Nota do negócio (texto original)')).toBeTruthy();
    expect(within(dialogo).getByText(/Se o produto não estiver no catálogo, ele entra como/)).toBeTruthy();
    expect(dialogo.querySelector('form.indent-form > .modal-actions:last-child')).not.toBeNull();
    expect(dialogo.querySelector('[style]')).toBeNull();
  });

  it('a nota com marcacao HTML e mostrada como texto (nada vira elemento)', async () => {
    const { dialogo } = await abrir(solicitacao([item(21, 'X')], { rawNote: '<img src="x" onerror="alert(1)"><b>negrito</b>' }));
    const nota = dialogo.querySelector('pre.indent-nota') as HTMLElement;
    expect(nota.textContent).toBe('<img src="x" onerror="alert(1)"><b>negrito</b>');
    expect(nota.children).toHaveLength(0);
    expect(dialogo.querySelector('img')).toBeNull();
  });

  it('sem itens ("Itens a digitar"): titulo "Digitar itens", uma linha em branco e sem a nota quando ela nao existe', async () => {
    const { dialogo } = await abrir(solicitacao([], { rawNote: null }));
    expect(within(dialogo).getByRole('heading', { name: 'Digitar itens' })).toBeTruthy();
    expect(produtos(dialogo)).toHaveLength(1);
    expect(produtos(dialogo)[0]?.value).toBe('');
    expect(quantidades(dialogo)[0]?.value).toBe('');
    expect(dialogo.querySelector('pre.indent-nota')).toBeNull();
    expect(within(dialogo).queryByRole('button', { name: /Remover item/ })).toBeNull();
  });

  it('foco inicial no 1º "Produto" (data-autofocus, um so) e Cancelar / Esc devolvem o foco ao botao que abriu', async () => {
    const { dialogo, gatilho } = await abrir(solicitacao([item(21, 'RESINA EXEMPLO 223 (RXE)'), item(22, 'SOLVENTE TESTE 99%')]));
    expect(dialogo.querySelectorAll('[data-autofocus]')).toHaveLength(1);
    expect(document.activeElement).toBe(produtos(dialogo)[0]);

    fireEvent.click(within(dialogo).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(gatilho);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(api.put).not.toHaveBeenCalled();

    fireEvent.click(gatilho);
    const outro = await screen.findByRole('dialog');
    fireEvent(outro, new Event('cancel', { cancelable: true }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(gatilho);
  });

  it('o foco inicial passa para o item seguinte quando o 1º e removido', async () => {
    const { dialogo } = await abrir(solicitacao([item(21, 'RESINA EXEMPLO 223 (RXE)'), item(22, 'SOLVENTE TESTE 99%')]));
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Remover item 1' }));
    expect(dialogo.querySelectorAll('[data-autofocus]')).toHaveLength(1);
    expect(produtos(dialogo)).toHaveLength(1);
    expect(produtos(dialogo)[0]?.hasAttribute('data-autofocus')).toBe(true);
  });

  it('aviso inicial (itens mudaram) aparece como alerta e nao some ao abrir', async () => {
    const { dialogo } = await abrir(solicitacao([item(21, 'X')]), 'Os itens da solicitação mudaram. Recarregue e revise de novo.');
    expect(within(dialogo).getByRole('alert').textContent).toBe('Os itens da solicitação mudaram. Recarregue e revise de novo.');
  });

  it('catalogo: datalist com os produtos; falha do catalogo vira aviso e ainda deixa confirmar (item livre)', async () => {
    const ok = await abrir(solicitacao([item(21, 'X')]));
    await waitFor(() => expect(ok.dialogo.querySelectorAll('datalist#nota-catalogo > option')).toHaveLength(2));
    expect(produtos(ok.dialogo)[0]?.getAttribute('list')).toBe('nota-catalogo');
    ok.unmount();

    catalogo = 'erro';
    const falha = await abrir(solicitacao([item(21, 'RESINA EXEMPLO 223 (RXE)')]));
    expect((await within(falha.dialogo).findByRole('alert')).textContent).toContain('Não foi possível carregar o catálogo: falhou');
    await prontoParaConfirmar(falha.dialogo);
    confirmar(falha.dialogo);
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.put).mock.calls[0]?.[1]).toEqual({ items: [{ id: 21, description: 'RESINA EXEMPLO 223 (RXE)', quantityKg: 2000 }] });
  });

  it('enquanto o catalogo carrega "Confirmar itens" fica aria-disabled e nao envia', async () => {
    catalogo = 'lento';
    const { dialogo } = await abrir(solicitacao([item(21, 'RESINA EXEMPLO 223 (RXE)')]));
    const botao = within(dialogo).getByRole('button', { name: 'Confirmar itens' });
    expect(botao.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(botao);
    // o mutate do TanStack so chama o mutationFn depois de microtarefas: espera antes de afirmar que nada saiu
    await esperar();
    expect(api.put).not.toHaveBeenCalled();
    liberarCatalogo();
    await prontoParaConfirmar(dialogo);
    confirmar(dialogo);
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
  });
});

describe('validacao antes de enviar', () => {
  it.each([
    ['', 'Informe a quantidade em kg.'],
    ['0', 'Informe a quantidade em kg.'],
    ['-5', 'Informe a quantidade em kg.'],
    ['abc', 'Informe a quantidade em kg.'],
    ['1,2345', 'Informe a quantidade em kg.'],
    ['1.000.000.001', 'Informe a quantidade em kg.'],
  ])('quantidade "%s" e recusada sem chamar o backend', async (digitado, mensagem) => {
    const { dialogo } = await abrir(solicitacao([item(21, 'RESINA EXEMPLO 223 (RXE)')]));
    await prontoParaConfirmar(dialogo);
    fireEvent.change(quantidades(dialogo)[0] as HTMLElement, { target: { value: digitado } });
    confirmar(dialogo);
    const alerta = await within(dialogo).findByRole('alert');
    expect(alerta.textContent).toBe(mensagem);
    expect(quantidades(dialogo)[0]?.getAttribute('aria-invalid')).toBe('true');
    expect(api.put).not.toHaveBeenCalled();
  });

  it('produto vazio ou acima de 300 caracteres e recusado; os dois erros aparecem juntos', async () => {
    const { dialogo } = await abrir(solicitacao([item(21, 'A'), item(22, 'B')]));
    await prontoParaConfirmar(dialogo);
    fireEvent.change(produtos(dialogo)[0] as HTMLElement, { target: { value: '   ' } });
    fireEvent.change(produtos(dialogo)[1] as HTMLElement, { target: { value: 'x'.repeat(301) } });
    fireEvent.change(quantidades(dialogo)[1] as HTMLElement, { target: { value: '' } });
    confirmar(dialogo);
    const alertas = await within(dialogo).findAllByRole('alert');
    expect(alertas.map((el) => el.textContent)).toEqual([
      'Informe o produto.',
      'O produto deve ter no máximo 300 caracteres.',
      'Informe a quantidade em kg.',
    ]);
    expect(api.put).not.toHaveBeenCalled();
  });

  it('numeros pt-BR: "1.500,5" = 1500,5 e "2,5" = 2,5', async () => {
    const { dialogo } = await abrir(solicitacao([item(21, 'A'), item(22, 'B')]));
    await prontoParaConfirmar(dialogo);
    fireEvent.change(quantidades(dialogo)[0] as HTMLElement, { target: { value: '1.500,5' } });
    fireEvent.change(quantidades(dialogo)[1] as HTMLElement, { target: { value: '2,5' } });
    confirmar(dialogo);
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    const itens = (vi.mocked(api.put).mock.calls[0]?.[1] as { items: Array<{ quantityKg: number }> }).items;
    expect(itens.map((i) => i.quantityKg)).toEqual([1500.5, 2.5]);
  });
});

describe('payload do PUT note-items', () => {
  it('cobre todos os itens atuais por id: editado (com productId do catalogo), livre (sem productId) e removido (remove:true); novo item sem id', async () => {
    const { dialogo } = await abrir(
      solicitacao([item(21, 'RESINA EXEMPLO 223 (RXE)'), item(22, 'SOLVENTE TESTE 99%'), item(23, 'ITEM QUE SAI', { quantityKg: 10 })]),
    );
    await prontoParaConfirmar(dialogo);
    fireEvent.change(quantidades(dialogo)[0] as HTMLElement, { target: { value: '2.500' } });
    // acento, caixa e espacos nao atrapalham o casamento com o catalogo
    fireEvent.change(produtos(dialogo)[1] as HTMLElement, { target: { value: '  acido citrico   anidro ' } });
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Remover item 3' }));
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Adicionar outro item' }));
    fireEvent.change(produtos(dialogo)[2] as HTMLElement, { target: { value: 'Produto Novo Exemplo' } });
    fireEvent.change(quantidades(dialogo)[2] as HTMLElement, { target: { value: '300' } });
    confirmar(dialogo);

    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    expect(api.put).toHaveBeenCalledWith('/api/v1/indent/requests/11/note-items', {
      items: [
        { id: 21, productId: 9, description: 'RESINA EXEMPLO 223 (RXE)', quantityKg: 2500 },
        { id: 22, productId: 10, description: 'acido citrico   anidro', quantityKg: 2000 },
        { id: 23, remove: true },
        { description: 'Produto Novo Exemplo', quantityKg: 300 },
      ],
    });
    await waitFor(() => expect(onConfirmed).toHaveBeenCalledTimes(1));
  });

  it('item novo adicionado e removido de novo nao vai na lista; o ultimo item visivel nao tem botao de remover', async () => {
    const { dialogo } = await abrir(solicitacao([item(21, 'A'), item(22, 'B')]));
    await prontoParaConfirmar(dialogo);
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Adicionar outro item' }));
    expect(produtos(dialogo)).toHaveLength(3);
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Remover item 3' }));
    expect(produtos(dialogo)).toHaveLength(2);
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Remover item 1' }));
    // sobrou 1 visivel: nao da para remover o ultimo (a lista precisa de ao menos 1 item)
    expect(within(dialogo).queryByRole('button', { name: /Remover item/ })).toBeNull();
    confirmar(dialogo);
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.put).mock.calls[0]?.[1]).toEqual({
      items: [
        { id: 21, remove: true },
        { id: 22, description: 'B', quantityKg: 2000 },
      ],
    });
  });

  it('limite de 50 itens: o botao "Adicionar outro item" desabilita', async () => {
    const itens = Array.from({ length: 49 }, (_, i) => item(100 + i, `ITEM ${i}`));
    const { dialogo } = await abrir(solicitacao(itens));
    const adicionar = within(dialogo).getByRole('button', { name: 'Adicionar outro item' }) as HTMLButtonElement;
    expect(adicionar.disabled).toBe(false);
    fireEvent.click(adicionar);
    expect(produtos(dialogo)).toHaveLength(50);
    expect(adicionar.disabled).toBe(true);
  });

  it('o limite de 50 conta tambem os itens removidos (remove:true entra na lista enviada): remover um nao libera outro', async () => {
    const itens = Array.from({ length: 50 }, (_, i) => item(100 + i, `ITEM ${i}`));
    const { dialogo } = await abrir(solicitacao(itens));
    const adicionar = within(dialogo).getByRole('button', { name: 'Adicionar outro item' }) as HTMLButtonElement;
    expect(adicionar.disabled).toBe(true);
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Remover item 1' }));
    expect(produtos(dialogo)).toHaveLength(49);
    expect(adicionar.disabled).toBe(true);
    await prontoParaConfirmar(dialogo);
    confirmar(dialogo);
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    expect((vi.mocked(api.put).mock.calls[0]?.[1] as { items: unknown[] }).items).toHaveLength(50);
  });

  it('clique duplo em "Confirmar itens" durante a chamada envia uma vez', async () => {
    vi.mocked(api.put).mockImplementation((() => new Promise(() => undefined)) as typeof api.put);
    const { dialogo } = await abrir(solicitacao([item(21, 'A')]));
    await prontoParaConfirmar(dialogo);
    const botao = within(dialogo).getByRole('button', { name: 'Confirmar itens' });
    botao.focus();
    fireEvent.click(botao);
    await waitFor(() => expect(botao.getAttribute('aria-disabled')).toBe('true'));
    fireEvent.click(botao);
    await esperar();
    expect(api.put).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(botao);
  });
});

describe('erros do servidor', () => {
  it('409 "já foram cotados" aparece no modal e o detalhe e relido', async () => {
    vi.mocked(api.put).mockRejectedValue(new ApiError(409, { message: 'Os itens desta solicitação já foram cotados.' }));
    const { dialogo, qc } = await abrir(solicitacao([item(21, 'A')]));
    const invalidar = vi.spyOn(qc, 'invalidateQueries');
    await prontoParaConfirmar(dialogo);
    confirmar(dialogo);
    expect((await within(dialogo).findByRole('alert')).textContent).toBe('Os itens desta solicitação já foram cotados.');
    expect(invalidar).toHaveBeenCalledWith({ queryKey: ['indent', 'requests'] });
    expect(onConfirmed).not.toHaveBeenCalled();
    expect(onStale).not.toHaveBeenCalled();
  });

  it('400 "mudaram": nao mostra erro no modal; relê o detalhe e chama onStale com a mensagem (a tela reabre com a lista nova)', async () => {
    vi.mocked(api.put).mockRejectedValue(new ApiError(400, { message: 'Os itens da solicitação mudaram. Recarregue e revise de novo.' }));
    const { dialogo, qc } = await abrir(solicitacao([item(21, 'A')]));
    const recarregar = vi.spyOn(qc, 'refetchQueries');
    await prontoParaConfirmar(dialogo);
    confirmar(dialogo);
    await waitFor(() => expect(onStale).toHaveBeenCalledWith('Os itens da solicitação mudaram. Recarregue e revise de novo.', { 21: { produto: 'A', quantidade: '2.000' } }));
    expect(recarregar).toHaveBeenCalledWith({ queryKey: ['indent', 'requests', 11] });
    expect(within(dialogo).queryByRole('alert')).toBeNull();
  });

  it('outro 400 (ex.: produto inativo) fica no modal e nao dispara onStale', async () => {
    vi.mocked(api.put).mockRejectedValue(new ApiError(400, { message: 'Produto inativo no catálogo do Indent.' }));
    const { dialogo } = await abrir(solicitacao([item(21, 'A')]));
    await prontoParaConfirmar(dialogo);
    confirmar(dialogo);
    expect((await within(dialogo).findByRole('alert')).textContent).toBe('Produto inativo no catálogo do Indent.');
    expect(onStale).not.toHaveBeenCalled();
  });
});
