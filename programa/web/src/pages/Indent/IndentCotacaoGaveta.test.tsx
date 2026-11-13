import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import IndentCotacaoGaveta from './IndentCotacaoGaveta';
import { todayKeyBr } from './indentCotacao';

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

// Gaveta da cotacao (PR 3): cabecalho, avisos, dl, acoes por `allowedActions`, registro da resposta, item livre, toasts, 409 e foco.
// O backend decide as acoes (`allowedActions`); a tela so desenha o que vier la.

type Obj = Record<string, unknown>;

function item(id: number, requestItemId: number, extra: Obj = {}) {
  return {
    id,
    requestItemId,
    name: requestItemId === 21 ? 'Dióxido de titânio rutilo' : 'Ureia técnica',
    cas: requestItemId === 21 ? '13463-67-7' : null,
    productOrigin: 'CADASTRADO',
    isFree: false,
    quantityKg: requestItemId === 21 ? '40000.000' : '2000.000',
    packaging: null,
    fobPricePerKg: null,
    cfrPricePerKg: null,
    ...extra,
  };
}

function cotacao(extra: Obj = {}) {
  return {
    id: 100,
    ref: '270/26',
    revision: 1,
    status: 'RASCUNHO',
    requestId: 11,
    processNumber: '270/26',
    requestStatus: 'COTACAO',
    client: { id: 3, name: 'Cliente Alfa Indústria Ltda', city: 'Itajaí', supplierRuleMode: 'LIVRE' },
    supplier: { id: 5, name: 'Shandong Haohua Chemical Co.', country: 'China', contactName: null, hasPartnership: true, type: 'FABRICANTE' },
    itemsSummary: { firstName: 'Dióxido de titânio rutilo', count: 2 },
    currency: 'USD',
    total: null,
    validUntil: null,
    exception: null,
    createdAt: '2026-11-10T12:00:00.000Z',
    destination: 'Paranaguá',
    incoterm: 'CFR',
    sentAt: null,
    respondedAt: null,
    decidedAt: null,
    productionLeadTimeDays: null,
    paymentTerms: null,
    manufacturer: null,
    notes: null,
    base: null,
    acceptedQuote: null,
    items: [item(201, 21), item(202, 22)],
    allowedActions: ['mark-sent', 'items'],
    ...extra,
  };
}

const ACEITA_DE_OUTRA = { id: 150, ref: '270/26', supplierName: 'Beta Corp' };

// O GET devolve sempre o corpo "atual": uma acao bem-sucedida (resolvePost) o troca, como o backend faria.
let corpoAtual: unknown;

function mockCotacao(corpo: unknown) {
  corpoAtual = corpo;
  vi.mocked(api.get).mockImplementation((async (url: string) => {
    if (url === '/api/v1/indent/quotes/100') {
      if (corpoAtual instanceof Error) throw corpoAtual;
      return corpoAtual;
    }
    return {};
  }) as typeof api.get);
}

function resolvePost(novo: unknown) {
  vi.mocked(api.post).mockImplementation((async () => {
    corpoAtual = novo;
    return novo;
  }) as typeof api.post);
}

/** O "Fechar" do rodape (o do cabecalho tem o mesmo nome acessivel). */
const fecharDoRodape = () => within(document.querySelector('.modal-actions') as HTMLElement).getByRole('button', { name: 'Fechar' });

function renderGaveta(quoteId: number | null = 100, onClose = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tela = render(
    <QueryClientProvider client={qc}>
      <IndentCotacaoGaveta quoteId={quoteId} onClose={onClose} />
    </QueryClientProvider>,
  );
  return { ...tela, onClose };
}

const botoes = () => Array.from(document.querySelectorAll('.modal-actions button')).map((b) => b.textContent);

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset();
});

describe('IndentCotacaoGaveta - cabecalho, avisos e dados', () => {
  it('cabecalho: referencia no titulo, "Fornecedor · Cliente" e o badge do status ANTES do Fechar (headerAside)', async () => {
    mockCotacao(cotacao({ status: 'RESPONDIDA', allowedActions: ['accept', 'refuse', 'revision'] }));
    renderGaveta();

    await screen.findByText('Aceitar e abrir processo');
    const cabecalho = document.querySelector('header.modal-header') as HTMLElement;
    expect(cabecalho.querySelector('h2')?.textContent).toBe('270/26');
    expect(cabecalho.querySelector('.modal-subtitle')?.textContent).toBe('Shandong Haohua Chemical Co. · Cliente Alfa Indústria Ltda');
    const badge = cabecalho.querySelector('.badge') as HTMLElement;
    expect(badge.textContent).toBe('Respondida');
    expect(badge.className).toContain('badge--warning');
    expect(badge.nextElementSibling).toBe(cabecalho.querySelector('.btn-close'));
    expect(document.querySelector('dialog.indent-gaveta')).not.toBeNull();
  });

  it('faixa de excecao: texto por modo ATUAL do cliente, motivo e quem liberou', async () => {
    const excecao = { reason: 'Cliente autorizou', byName: 'Ana Souza', at: '2026-11-12T15:10:00.000Z' };
    mockCotacao(cotacao({ exception: excecao, client: { id: 3, name: 'Cliente Alfa Indústria Ltda Sul', city: null, supplierRuleMode: 'APROVADOS' } }));
    const { unmount } = renderGaveta();

    const faixa = (await screen.findByText('Exceção à restrição do cliente')).closest('.indent-excbanner') as HTMLElement;
    expect(faixa.getAttribute('role')).toBe('alert');
    expect(faixa.textContent).toContain('Cliente Alfa Indústria só aceita fornecedores aprovados.');
    expect(faixa.textContent).toContain('Motivo: Cliente autorizou · liberada por Ana Souza em 12/11 12:10');
    expect(faixa.querySelector('strong')?.textContent).toBe('Exceção à restrição do cliente');
    unmount();

    mockCotacao(cotacao({ exception: excecao, client: { id: 3, name: 'Cliente Alfa', city: null, supplierRuleMode: 'BLOQUEIO' } }));
    const bloqueio = renderGaveta();
    expect((await screen.findByText(/bloqueou este fornecedor\./)).textContent).toContain('Cliente Alfa bloqueou este fornecedor.');
    bloqueio.unmount();

    mockCotacao(cotacao({ exception: excecao }));
    renderGaveta();
    expect(await screen.findByText(/Cotação aberta fora da regra do cliente\./)).toBeTruthy();
  });

  it('sem excecao nao ha faixa; fornecedor sem parceria mostra o alerta informativo com cadeado', async () => {
    mockCotacao(cotacao());
    const { unmount } = renderGaveta();
    await screen.findByText('Referência de processo indent');
    expect(document.querySelector('.indent-excbanner')).toBeNull();
    expect(screen.queryByText(/sem parceria firmada/)).toBeNull();
    unmount();

    mockCotacao(cotacao({ supplier: { id: 5, name: 'Acme', country: null, contactName: null, hasPartnership: false, type: 'TRADING' } }));
    renderGaveta();
    const alerta = (await screen.findByText(/sem parceria firmada/)).closest('.alert') as HTMLElement;
    expect(alerta.className).toContain('alert--info');
    expect(alerta.firstElementChild?.tagName.toLowerCase()).toBe('svg');
    expect(alerta.textContent).toContain('o e-mail e o portal não dizem que a SQ é a compradora e não mostram o cliente.');
  });

  it('aviso de aceite unico nas 3 variacoes e ausente na propria ACEITA', async () => {
    const base = 'A solicitação 270/26 já tem uma cotação aceita: 270/26 · Beta Corp. Esta cotação não pode mais ser aceita nem revisada.';

    for (const [status, acoes, sufixo] of [
      ['RESPONDIDA', ['refuse'], ' Você ainda pode recusá-la.'],
      ['ENVIADA', ['response'], ' Você ainda pode registrar a resposta do fornecedor, para histórico.'],
      ['RASCUNHO', [], ' Ela não será enviada.'],
    ] as Array<[string, string[], string]>) {
      mockCotacao(cotacao({ status, acceptedQuote: ACEITA_DE_OUTRA, allowedActions: acoes, requestStatus: 'CONVERTIDA' }));
      const { unmount } = renderGaveta();
      const aviso = (await screen.findByText(`${base}${sufixo}`)).closest('.alert') as HTMLElement;
      expect(aviso.className).toContain('alert--info');
      unmount();
    }

    mockCotacao(cotacao({ status: 'ACEITA', allowedActions: [], acceptedQuote: null, requestStatus: 'CONVERTIDA' }));
    renderGaveta();
    await screen.findByText('Processo aberto');
    expect(screen.queryByText(/já tem uma cotação aceita/)).toBeNull();
  });

  it('caixa do processo e dl: "a definir" sem dados, "Revisao de" so em R2+, observacao e incoterm com destino', async () => {
    mockCotacao(cotacao());
    const { unmount } = renderGaveta();
    await screen.findByText('Mesmo número da solicitação');
    const dl = document.querySelector('dl.indent-dl') as HTMLElement;
    const pares = Array.from(dl.querySelectorAll('dt')).map((dt) => [dt.textContent, dt.nextElementSibling?.textContent]);
    expect(pares).toEqual([
      ['Solicitação', '270/26'],
      ['Fornecedor', 'Shandong Haohua Chemical Co. · China'],
      ['Incoterm', 'FOB origem e CFR Paranaguá'],
      ['Moeda', 'USD'],
      ['Validade', 'a definir'],
      ['Prazo de produção', 'a definir'],
      ['Pagamento', 'a definir'],
    ]);
    unmount();

    mockCotacao(
      cotacao({
        status: 'RESPONDIDA',
        ref: 'R2 - 270/26',
        revision: 2,
        base: { id: 90, ref: '270/26' },
        validUntil: '2026-11-26',
        productionLeadTimeDays: 20,
        paymentTerms: 'T/T 60 dias após B/L',
        manufacturer: 'Fab X',
        notes: 'Embarque rápido',
        destination: null,
        allowedActions: [],
      }),
    );
    renderGaveta();
    await screen.findByText('R2 - 270/26', { selector: '.indent-processo .indent-ref' });
    const dl2 = document.querySelector('dl.indent-dl') as HTMLElement;
    const pares2 = Object.fromEntries(Array.from(dl2.querySelectorAll('dt')).map((dt) => [dt.textContent, dt.nextElementSibling?.textContent]));
    expect(pares2).toMatchObject({
      Incoterm: 'FOB origem e CFR (destino a definir)',
      Validade: '26/11/2026',
      'Prazo de produção': '20 dias',
      Pagamento: 'T/T 60 dias após B/L',
      Observação: 'Fabricante: Fab X · Embarque rápido',
      'Revisão de': '270/26',
    });
  });

  it('tabela de itens: nome, CAS ou "Item livre", embalagem, quantidade, FOB e CFR (3 casas), cabecalho CFR com o destino e total do backend', async () => {
    mockCotacao(
      cotacao({
        status: 'RESPONDIDA',
        allowedActions: [],
        total: '19875.00',
        items: [
          item(201, 21, { packaging: 'Saco 25 kg', fobPricePerKg: '0.7000', cfrPricePerKg: '0.7950' }),
          item(202, 22, { isFree: true, cas: null, name: 'Produto livre', cfrPricePerKg: '1.1234' }),
        ],
      }),
    );
    renderGaveta();
    await screen.findByText('Saco 25 kg');

    expect(Array.from(document.querySelectorAll('thead th')).map((th) => th.textContent)).toEqual(['Item', 'Embalagem', 'Qtd.', 'FOB', 'CFR Paranaguá']);
    const linhas = Array.from(document.querySelectorAll('tbody tr')) as HTMLElement[];
    expect(linhas[0]?.textContent).toContain('CAS 13463-67-7');
    expect(Array.from(linhas[0]!.querySelectorAll('td')).slice(1).map((td) => td.textContent)).toEqual(['Saco 25 kg', '40.000 kg', '0,700', '0,795']);
    expect(within(linhas[1] as HTMLElement).getByText('Item livre').className).toContain('indent-tag--manual');
    expect(Array.from(linhas[1]!.querySelectorAll('td')).slice(1).map((td) => td.textContent)).toEqual(['—', '2.000 kg', '—', '1,1234']);
    expect(screen.getByText('Itens e preços (por kg)')).toBeTruthy();
    expect(screen.getByTestId('cot-total').textContent).toBe('US$ 19.875,00');
    expect(document.querySelector('input.indent-preco')).toBeNull();
  });
});

describe('IndentCotacaoGaveta - botoes por allowedActions', () => {
  it('RASCUNHO: "Enviada em" + "Marcar como enviada" e "Adicionar item livre"; sem Fechar', async () => {
    mockCotacao(cotacao());
    renderGaveta();
    await screen.findByRole('button', { name: 'Marcar como enviada' });

    expect(botoes()).toEqual(['Marcar como enviada']);
    const data = screen.getByLabelText('Enviada em') as HTMLInputElement;
    expect(data.type).toBe('date');
    expect(data.value).toBe(todayKeyBr());
    expect(data.max).toBe(todayKeyBr());
    expect(screen.getByRole('button', { name: 'Adicionar item livre' })).toBeTruthy();
    expect(screen.queryByText('Resposta do fornecedor')).toBeNull();
  });

  it('RESPONDIDA: Recusar, Pedir revisao e Aceitar e abrir processo', async () => {
    mockCotacao(cotacao({ status: 'RESPONDIDA', allowedActions: ['accept', 'refuse', 'revision'] }));
    renderGaveta();
    await screen.findByRole('button', { name: 'Aceitar e abrir processo' });
    expect(botoes()).toEqual(['Recusar', 'Pedir revisão', 'Aceitar e abrir processo']);
    expect(screen.queryByRole('button', { name: 'Adicionar item livre' })).toBeNull();
  });

  it('RESPONDIDA com ACEITA na solicitacao: so "Recusar"', async () => {
    mockCotacao(cotacao({ status: 'RESPONDIDA', allowedActions: ['refuse'], acceptedQuote: ACEITA_DE_OUTRA }));
    renderGaveta();
    await screen.findByRole('button', { name: 'Recusar' });
    expect(botoes()).toEqual(['Recusar']);
  });

  it('viewer (allowedActions vazio): sem inputs, sem acoes, so "Fechar"', async () => {
    mockCotacao(cotacao({ status: 'ENVIADA', allowedActions: [] }));
    renderGaveta();
    await screen.findByText('Referência de processo indent');

    expect(botoes()).toEqual(['Fechar']);
    expect(document.querySelectorAll('.indent-gaveta form input, .indent-gaveta form select')).toHaveLength(0);
    expect(screen.queryByText('Resposta do fornecedor')).toBeNull();
  });
});

describe('IndentCotacaoGaveta - foco inicial', () => {
  it('ENVIADA: o foco vai para o 1o campo (data-autofocus), nao para o Fechar', async () => {
    mockCotacao(cotacao({ status: 'ENVIADA', sentAt: '2026-11-11T15:00:00.000Z', allowedActions: ['response'] }));
    renderGaveta();
    const campo = await screen.findByLabelText('Data da resposta');
    await waitFor(() => expect(document.activeElement).toBe(campo));
  });

  it('apos "Marcar como enviada" (o formulario remonta) o foco vai para a Data da resposta, nao para o body', async () => {
    mockCotacao(cotacao());
    resolvePost(cotacao({ status: 'ENVIADA', sentAt: '2026-11-13T15:00:00.000Z', allowedActions: ['response'] }));
    renderGaveta();
    fireEvent.click(await screen.findByRole('button', { name: 'Marcar como enviada' }));

    const campo = await screen.findByLabelText('Data da resposta');
    await waitFor(() => expect(document.activeElement).toBe(campo));
  });

  it('apos "Incluir item" (remonta, sem data-autofocus) o foco nao se perde no body', async () => {
    mockCotacao(cotacao());
    resolvePost(cotacao({ items: [item(201, 21), item(202, 22), item(203, 23, { name: 'Livre Z', isFree: true, cas: null })] }));
    renderGaveta();
    fireEvent.click(await screen.findByRole('button', { name: 'Adicionar item livre' }));
    fireEvent.change(screen.getByLabelText('Descrição do item'), { target: { value: 'Livre Z' } });
    fireEvent.change(screen.getByLabelText('Quantidade (kg)'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Incluir item' }));

    await screen.findByText('Livre Z');
    await waitFor(() => expect(document.activeElement).not.toBe(document.body));
    expect(document.querySelector('dialog')?.contains(document.activeElement)).toBe(true);
  });
});

describe('IndentCotacaoGaveta - marcar como enviada', () => {
  it('envia a data, mostra o toast e a gaveta continua aberta com o novo status', async () => {
    mockCotacao(cotacao());
    resolvePost(cotacao({ status: 'ENVIADA', sentAt: '2026-11-13T15:00:00.000Z', allowedActions: ['response'] }));
    const { onClose } = renderGaveta();
    await screen.findByRole('button', { name: 'Marcar como enviada' });

    fireEvent.change(screen.getByLabelText('Enviada em'), { target: { value: '2026-11-11' } });
    fireEvent.click(screen.getByRole('button', { name: 'Marcar como enviada' }));

    await screen.findByText('Cotação 270/26 marcada como enviada para Shandong Haohua Chemical Co.');
    expect(api.post).toHaveBeenCalledWith('/api/v1/indent/quotes/100/mark-sent', { sentOn: '2026-11-11' });
    expect(onClose).not.toHaveBeenCalled();
    await screen.findByRole('button', { name: 'Registrar resposta' });
    expect(document.querySelector('header .badge')?.textContent).toBe('Enviada');
  });
});

describe('IndentCotacaoGaveta - registrar resposta (bloco da divergencia aceita)', () => {
  const enviada = () => cotacao({ status: 'ENVIADA', sentAt: '2026-11-11T15:00:00.000Z', allowedActions: ['response'] });

  function preencher() {
    fireEvent.change(screen.getByLabelText('Validade'), { target: { value: '2026-11-30' } });
    fireEvent.change(screen.getByLabelText('Prazo de produção (dias)'), { target: { value: '20' } });
    fireEvent.change(screen.getByLabelText('Pagamento'), { target: { value: 'T/T 60 dias após B/L' } });
    const emb = screen.getAllByLabelText('Embalagem');
    fireEvent.change(emb[0] as HTMLElement, { target: { value: 'Saco 25 kg' } });
    fireEvent.change(emb[1] as HTMLElement, { target: { value: 'Tambor 200 kg' } });
  }

  it('mostra o fieldset "Resposta do fornecedor" com os campos do mock, o 1o com data-autofocus, e os inputs de preco', async () => {
    mockCotacao(enviada());
    renderGaveta();
    await screen.findByText('Resposta do fornecedor');

    const campos = ['Data da resposta', 'Moeda', 'Validade', 'Prazo de produção (dias)', 'Pagamento', 'Porto de destino (CFR)', 'Fabricante', 'Observação'];
    for (const rotulo of campos) expect(screen.getByLabelText(rotulo), rotulo).toBeTruthy();
    expect(screen.getByLabelText('Data da resposta').hasAttribute('data-autofocus')).toBe(true);
    expect((screen.getByLabelText('Data da resposta') as HTMLInputElement).value).toBe(todayKeyBr());
    expect((screen.getByLabelText('Porto de destino (CFR)') as HTMLInputElement).value).toBe('Paranaguá');
    expect(screen.getByText('Validade igual ou posterior à data da resposta.')).toBeTruthy();
    expect(screen.getAllByLabelText('Preço FOB por kg')).toHaveLength(2);
    expect(screen.getAllByLabelText('Preço CFR por kg')).toHaveLength(2);
    expect((screen.getAllByLabelText('Preço CFR por kg')[0] as HTMLInputElement).placeholder).toBe('0,000');
    expect(botoes()).toEqual(['Registrar resposta']);
  });

  it('converte "0,795" em "0.795", envia todos os itens, recalcula o total na tela e mostra o toast', async () => {
    mockCotacao(enviada());
    resolvePost(cotacao({ status: 'RESPONDIDA', allowedActions: ['accept', 'refuse', 'revision'] }));
    renderGaveta();
    await screen.findByText('Resposta do fornecedor');

    preencher();
    fireEvent.change(screen.getAllByLabelText('Preço FOB por kg')[0] as HTMLElement, { target: { value: '0,7' } });
    fireEvent.change(screen.getAllByLabelText('Preço CFR por kg')[0] as HTMLElement, { target: { value: '0,795' } });
    fireEvent.change(screen.getAllByLabelText('Preço FOB por kg')[1] as HTMLElement, { target: { value: '2,9' } });
    fireEvent.change(screen.getAllByLabelText('Preço CFR por kg')[1] as HTMLElement, { target: { value: '3,18' } });
    expect(screen.getByTestId('cot-total').textContent).toBe('US$ 38.160,00');
    fireEvent.click(screen.getByRole('button', { name: 'Registrar resposta' }));

    await screen.findByText('Resposta de Shandong Haohua Chemical Co. registrada em 270/26');
    expect(api.post).toHaveBeenCalledWith('/api/v1/indent/quotes/100/response', {
      respondedOn: todayKeyBr(),
      currency: 'USD',
      validUntil: '2026-11-30',
      productionLeadTimeDays: 20,
      paymentTerms: 'T/T 60 dias após B/L',
      manufacturer: undefined,
      notes: undefined,
      destination: 'Paranaguá',
      items: [
        { quoteItemId: 201, packaging: 'Saco 25 kg', fobPricePerKg: '0.7', cfrPricePerKg: '0.795' },
        { quoteItemId: 202, packaging: 'Tambor 200 kg', fobPricePerKg: '2.9', cfrPricePerKg: '3.18' },
      ],
    });
    await screen.findByRole('button', { name: 'Aceitar e abrir processo' });
  });

  it('CFR menor que FOB: erro inline (aria-invalid + aria-describedby), nada e enviado e o foco vai para o campo', async () => {
    mockCotacao(enviada());
    renderGaveta();
    await screen.findByText('Resposta do fornecedor');

    preencher();
    fireEvent.change(screen.getAllByLabelText('Preço FOB por kg')[0] as HTMLElement, { target: { value: '0,9' } });
    fireEvent.change(screen.getAllByLabelText('Preço CFR por kg')[0] as HTMLElement, { target: { value: '0,8' } });
    fireEvent.change(screen.getAllByLabelText('Preço FOB por kg')[1] as HTMLElement, { target: { value: '1' } });
    fireEvent.change(screen.getAllByLabelText('Preço CFR por kg')[1] as HTMLElement, { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Registrar resposta' }));

    const erro = await screen.findByText('CFR não pode ser menor que FOB.');
    expect(erro.getAttribute('role')).toBe('alert');
    const campo = screen.getAllByLabelText('Preço CFR por kg')[0] as HTMLInputElement;
    expect(campo.getAttribute('aria-invalid')).toBe('true');
    expect(campo.getAttribute('aria-describedby')).toBe(erro.id);
    expect(screen.getAllByLabelText('Preço CFR por kg')[1]?.getAttribute('aria-invalid')).toBeNull();
    expect(api.post).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(campo));
  });

  it('preco com 5 casas ou vazio: erro inline por item e nada enviado', async () => {
    mockCotacao(enviada());
    renderGaveta();
    await screen.findByText('Resposta do fornecedor');

    preencher();
    fireEvent.change(screen.getAllByLabelText('Preço FOB por kg')[0] as HTMLElement, { target: { value: '0,79555' } });
    fireEvent.click(screen.getByRole('button', { name: 'Registrar resposta' }));

    expect(await screen.findByText('Preço inválido: use até 4 casas decimais.')).toBeTruthy();
    expect(screen.getAllByText('Informe FOB e CFR de todos os itens.').length).toBeGreaterThan(0);
    expect(api.post).not.toHaveBeenCalled();
  });

  it('erro 400 do backend com path vira erro inline no campo (data da resposta)', async () => {
    mockCotacao(enviada());
    vi.mocked(api.post).mockRejectedValue(new ApiError(400, { message: 'A data da resposta não pode ser anterior ao envio.', path: 'respondedOn' }));
    renderGaveta();
    await screen.findByText('Resposta do fornecedor');

    preencher();
    for (const campo of screen.getAllByLabelText('Preço FOB por kg')) fireEvent.change(campo, { target: { value: '1' } });
    for (const campo of screen.getAllByLabelText('Preço CFR por kg')) fireEvent.change(campo, { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Registrar resposta' }));

    const erro = await screen.findByText('A data da resposta não pode ser anterior ao envio.');
    expect(screen.getByLabelText('Data da resposta').getAttribute('aria-describedby')).toBe(erro.id);
    expect(screen.getByLabelText('Data da resposta').getAttribute('aria-invalid')).toBe('true');
  });
});

describe('IndentCotacaoGaveta - item livre', () => {
  it('Enter com descricao e quantidade preenchidas inclui o item (e nunca marca como enviada)', async () => {
    mockCotacao(cotacao());
    resolvePost(cotacao({ items: [item(201, 21), item(202, 22), item(203, 23, { name: 'Livre Z', isFree: true, cas: null })] }));
    renderGaveta();
    fireEvent.click(await screen.findByRole('button', { name: 'Adicionar item livre' }));
    fireEvent.change(screen.getByLabelText('Descrição do item'), { target: { value: 'Livre Z' } });
    fireEvent.change(screen.getByLabelText('Quantidade (kg)'), { target: { value: '10' } });

    const campo = screen.getByLabelText('Quantidade (kg)');
    const evento = createEvent.keyDown(campo, { key: 'Enter' });
    fireEvent(campo, evento);

    expect(evento.defaultPrevented).toBe(true);
    await screen.findByText('Item livre incluído em 270/26');
    expect(vi.mocked(api.post).mock.calls.map((c) => c[0])).toEqual(['/api/v1/indent/quotes/100/items']);
  });

  it('erro de quantidade marca so o campo da quantidade (aria-invalid + aria-describedby), nao a descricao', async () => {
    mockCotacao(cotacao());
    renderGaveta();
    fireEvent.click(await screen.findByRole('button', { name: 'Adicionar item livre' }));
    fireEvent.change(screen.getByLabelText('Descrição do item'), { target: { value: 'Livre Z' } });
    fireEvent.click(screen.getByRole('button', { name: 'Incluir item' }));

    const erro = await screen.findByText('Informe a quantidade em kg.');
    const qtd = screen.getByLabelText('Quantidade (kg)');
    expect(qtd.getAttribute('aria-invalid')).toBe('true');
    expect(qtd.getAttribute('aria-describedby')).toBe(erro.id);
    expect(screen.getByLabelText('Descrição do item').getAttribute('aria-invalid')).toBeNull();
    expect(screen.getByLabelText('Descrição do item').getAttribute('aria-describedby')).toBeNull();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('abre a linha (descricao com foco + quantidade + "Incluir item"), envia pt-BR como numero e mostra o toast', async () => {
    mockCotacao(cotacao());
    resolvePost(
      cotacao({ items: [item(201, 21), item(202, 22), item(203, 23, { name: 'Produto livre Y', isFree: true, cas: null, quantityKg: '1000.500' })] }),
    );
    renderGaveta();
    fireEvent.click(await screen.findByRole('button', { name: 'Adicionar item livre' }));

    const descricao = screen.getByLabelText('Descrição do item');
    await waitFor(() => expect(document.activeElement).toBe(descricao));
    expect(screen.queryByRole('button', { name: 'Adicionar item livre' })).toBeNull();
    fireEvent.change(descricao, { target: { value: 'Produto livre Y' } });
    fireEvent.change(screen.getByLabelText('Quantidade (kg)'), { target: { value: '1.000,5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Incluir item' }));

    await screen.findByText('Item livre incluído em 270/26');
    expect(api.post).toHaveBeenCalledWith('/api/v1/indent/quotes/100/items', { description: 'Produto livre Y', quantityKg: 1000.5 });
    await screen.findByText('Produto livre Y');
  });

  it('Enter na linha do item livre inclui o item e NAO envia o formulario (preventDefault); descricao vazia mostra o erro', async () => {
    mockCotacao(cotacao());
    renderGaveta();
    fireEvent.click(await screen.findByRole('button', { name: 'Adicionar item livre' }));

    // O jsdom nao simula a submissao implicita: a prova e o preventDefault do keydown (sem ele o navegador marcaria como enviada).
    const campo = screen.getByLabelText('Descrição do item');
    const evento = createEvent.keyDown(campo, { key: 'Enter' });
    fireEvent(campo, evento);
    expect(evento.defaultPrevented).toBe(true);
    expect(await screen.findByText('Informe o produto.')).toBeTruthy();
    expect(api.post).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByLabelText('Descrição do item')).toBeNull();
  });
});

describe('IndentCotacaoGaveta - aceitar, recusar e pedir revisao fecham a gaveta com o aviso', () => {
  const respondida = () => cotacao({ status: 'RESPONDIDA', allowedActions: ['accept', 'refuse', 'revision'] });

  it('aceitar: "Processo 270/26 aberto com F. Outras cotações da mesma solicitação seguem em análise"', async () => {
    mockCotacao(respondida());
    vi.mocked(api.post).mockResolvedValue(cotacao({ status: 'ACEITA', allowedActions: [] }));
    const { onClose } = renderGaveta();
    fireEvent.click(await screen.findByRole('button', { name: 'Aceitar e abrir processo' }));

    await waitFor(() =>
      expect(onClose).toHaveBeenCalledWith('Processo 270/26 aberto com Shandong Haohua Chemical Co.. Outras cotações da mesma solicitação seguem em análise'),
    );
    expect(api.post).toHaveBeenCalledWith('/api/v1/indent/quotes/100/accept', {});
  });

  it('recusar: "Cotação 270/26 de F marcada como recusada"', async () => {
    mockCotacao(respondida());
    vi.mocked(api.post).mockResolvedValue(cotacao({ status: 'RECUSADA', allowedActions: [] }));
    const { onClose } = renderGaveta();
    fireEvent.click(await screen.findByRole('button', { name: 'Recusar' }));

    await waitFor(() => expect(onClose).toHaveBeenCalledWith('Cotação 270/26 de Shandong Haohua Chemical Co. marcada como recusada'));
    expect(api.post).toHaveBeenCalledWith('/api/v1/indent/quotes/100/refuse', {});
  });

  it('pedir revisao: aviso com a referencia da NOVA cotacao', async () => {
    mockCotacao(respondida());
    vi.mocked(api.post).mockResolvedValue(cotacao({ id: 150, ref: 'R2 - 270/26', revision: 2, allowedActions: ['mark-sent', 'items'] }));
    const { onClose } = renderGaveta();
    fireEvent.click(await screen.findByRole('button', { name: 'Pedir revisão' }));

    await waitFor(() => expect(onClose).toHaveBeenCalledWith('Revisão R2 - 270/26 criada em rascunho; a versão anterior ficou como Revisada'));
    expect(api.post).toHaveBeenCalledWith('/api/v1/indent/quotes/100/revision', {});
  });

  it('409 (aceite unico perdido na corrida): alerta no topo, consulta refeita e a gaveta nao fecha', async () => {
    mockCotacao(respondida());
    vi.mocked(api.post).mockRejectedValue(new ApiError(409, { message: 'Esta solicitação já tem uma cotação aceita (270/26 · Beta Corp).' }));
    const { onClose } = renderGaveta();
    await screen.findByRole('button', { name: 'Aceitar e abrir processo' });
    const antes = vi.mocked(api.get).mock.calls.length;

    fireEvent.click(screen.getByRole('button', { name: 'Aceitar e abrir processo' }));

    const alerta = (await screen.findByText('Esta solicitação já tem uma cotação aceita (270/26 · Beta Corp).')).closest('.alert') as HTMLElement;
    expect(alerta.className).toContain('alert--warning');
    expect(alerta.getAttribute('role')).toBe('alert');
    await waitFor(() => expect(vi.mocked(api.get).mock.calls.length).toBeGreaterThan(antes));
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('IndentCotacaoGaveta - nao encontrada e foco', () => {
  it('id invalido (null) ou 404: "Cotação não encontrada." e Fechar', async () => {
    const { onClose, unmount } = renderGaveta(null);
    expect(await screen.findByText('Cotação não encontrada.')).toBeTruthy();
    fireEvent.click(fecharDoRodape());
    expect(onClose).toHaveBeenCalledWith();
    unmount();

    mockCotacao(new ApiError(404, { message: 'Cotação não encontrada.' }));
    renderGaveta(100);
    expect(await screen.findByText('Cotação não encontrada.', { selector: '.indent-vazio' })).toBeTruthy();
  });

  it('erro de carga diferente de 404: alerta e Fechar', async () => {
    mockCotacao(new ApiError(500, { message: 'Falha' }));
    renderGaveta();
    expect(await screen.findByText(/Não foi possível carregar a cotação: Falha/)).toBeTruthy();
  });

  it('restoreFocus: ao fechar, o foco volta ao botao que abriu', async () => {
    mockCotacao(cotacao({ allowedActions: [] }));
    function Hospedeiro() {
      const [aberta, setAberta] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setAberta(true)}>
            Abrir cotação
          </button>
          {aberta && <IndentCotacaoGaveta quoteId={100} onClose={() => setAberta(false)} />}
        </>
      );
    }
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <Hospedeiro />
      </QueryClientProvider>,
    );
    const abrir = screen.getByRole('button', { name: 'Abrir cotação' });
    abrir.focus();
    fireEvent.click(abrir);
    await screen.findByText('Referência de processo indent');

    fireEvent.click(fecharDoRodape());

    await waitFor(() => expect(document.activeElement).toBe(abrir));
  });
});
