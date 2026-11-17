import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { classesDoSeletor, parseRules, readSource, regioes, stripComments } from '@/test/rfCss';
import IndentCotacaoGaveta from './IndentCotacaoGaveta';
import fonteEnviar from './IndentEnviarModal.tsx?raw';
import fontePortal from './IndentPortalSecao.tsx?raw';
import fonteHelpers from './indentPortal.ts?raw';
import fonteServico from '../../services/indentEnvio.ts?raw';

vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn(), blob: vi.fn() },
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

// Integracao gaveta x janela "Enviar cotacao" x secao "Portal do fornecedor" (PR 4b): rodape do RASCUNHO, posicao da secao, janela IRMA do dialog da
// gaveta, foco, resultado do envio (toast e remontagem em ENVIADA) e o contrato de CSS da regiao `tela F14` (classes novas todas usadas).

type Obj = Record<string, unknown>;

const URL_COTACAO = '/api/v1/indent/quotes/100';
const URL_PORTAL = `${URL_COTACAO}/portal`;
const URL_CONTEXTO = `${URL_COTACAO}/send-context`;

function cotacao(extra: Obj = {}, fornecedor: Obj = {}) {
  return {
    id: 100,
    ref: '275/26',
    revision: 1,
    status: 'RASCUNHO',
    requestId: 11,
    processNumber: '275/26',
    requestStatus: 'COTACAO',
    client: { id: 3, name: 'Indústria Química Vale do Itajaí Ltda', city: 'Itajaí', supplierRuleMode: 'LIVRE' },
    supplier: { id: 5, name: 'Wei Zhang Trading', country: 'China', contactName: null, hasPartnership: true, type: 'TRADING', ...fornecedor },
    itemsSummary: { firstName: 'Citric acid anhydrous', count: 1 },
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
    items: [
      { id: 201, requestItemId: 21, name: 'Citric acid anhydrous', cas: '77-92-9', productOrigin: 'CADASTRADO', isFree: false, quantityKg: '25000.000', packaging: null, fobPricePerKg: null, cfrPricePerKg: null },
    ],
    allowedActions: ['mark-sent', 'items', 'send'],
    portal: { hasTokens: false },
    ...extra,
  };
}

function contexto(fornecedor: Obj = {}) {
  return {
    processRef: '275/26',
    kind: 'REQUEST',
    subject: '275/26 · Indent quotation request · Citric acid anhydrous',
    fromDisplay: 'SQ Quimica | Indent <indent-envio@sqquimica.test>',
    replyTo: 'indent@sqquimica.com',
    supplier: { id: 5, name: 'Wei Zhang Trading', hasPartnership: true, contactEmails: ['wei@supplier.example'], ...fornecedor },
    clientName: 'Indústria Química Vale do Itajaí Ltda',
    destinationPort: 'Paranaguá',
    firstItemName: 'Citric acid anhydrous',
  };
}

const PORTAL_NAO_ENVIADO = { state: 'NAO_ENVIADO', lastSentAt: null, recipients: [], lastAccessAt: null, expiresAt: null, canResend: false, mails: [], response: null, attachments: [] };
const PORTAL_AGUARDANDO = {
  state: 'AGUARDANDO',
  lastSentAt: '2026-11-12T18:40:00.000Z',
  recipients: ['wei@supplier.example'],
  lastAccessAt: null,
  expiresAt: '2099-11-26T18:40:00.000Z',
  canResend: true,
  mails: [{ id: 1, kind: 'REQUEST', toEmail: 'x@supplier.example', status: 'failed', errorMessage: 'caixa cheia', createdAt: '2026-11-12T18:40:00.000Z', sentAt: null, attachmentNames: [] }],
  response: null,
  attachments: [{ id: 3, fileName: 'TDS final.pdf', fileSize: 870400, createdAt: '2026-11-13T12:19:00.000Z' }],
};

// O GET devolve sempre o corpo "atual": um envio bem-sucedido (resolvePost) o troca, como o backend faria.
let corpoAtual: unknown;
let corpoPortal: unknown;
let corpoContexto: unknown;

function mockApi(cot: unknown, portal: unknown = PORTAL_NAO_ENVIADO, ctx: unknown = contexto()) {
  corpoAtual = cot;
  corpoPortal = portal;
  corpoContexto = ctx;
  vi.mocked(api.get).mockImplementation((async (url: string) => {
    if (url === URL_COTACAO) return corpoAtual;
    if (url === URL_PORTAL) return corpoPortal;
    if (url === URL_CONTEXTO) return corpoContexto;
    return {};
  }) as typeof api.get);
}

function renderGaveta(onClose = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tela = render(
    <QueryClientProvider client={qc}>
      <IndentCotacaoGaveta quoteId={100} onClose={onClose} />
    </QueryClientProvider>,
  );
  return { ...tela, qc, onClose };
}

const botoesDoRodape = () => Array.from(document.querySelectorAll('.indent-gaveta .modal-actions > button')) as HTMLButtonElement[];
const dialogoGaveta = () => document.querySelector('dialog.indent-gaveta') as HTMLElement;
const dialogoEnvio = () => document.querySelector('dialog.indent-envio') as HTMLElement | null;
const limparFoco = () => (document.activeElement as HTMLElement | null)?.blur();
const botaoEnviarAoFornecedor = () => screen.getByRole('button', { name: 'Enviar ao fornecedor' });

async function abrirJanela() {
  const botao = await screen.findByRole('button', { name: 'Enviar ao fornecedor' });
  fireEvent.click(botao);
  await screen.findByRole('button', { name: 'Enviar' });
  return botao;
}

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset();
  vi.mocked(api.blob).mockReset();
});

describe('IndentCotacaoGaveta - rodape do RASCUNHO e secao Portal', () => {
  it('["mark-sent","items","send"]: "Marcar como enviada (sem e-mail)" (secundario, submit) e "Enviar ao fornecedor" (principal, com icone send), nessa ordem apos "Enviada em"', async () => {
    mockApi(cotacao());
    renderGaveta();
    await screen.findByRole('button', { name: 'Enviar ao fornecedor' });

    expect(botoesDoRodape().map((b) => b.textContent)).toEqual(['Marcar como enviada (sem e-mail)', 'Enviar ao fornecedor']);
    const [marcar, enviar] = botoesDoRodape();
    expect(marcar?.className).toBe('ghost-button');
    expect(marcar?.getAttribute('type')).toBe('submit');
    expect(enviar?.className).toBe('primary-button');
    expect(enviar?.getAttribute('type')).toBe('button');
    expect(enviar?.querySelector('svg')).not.toBeNull();
    const rodape = document.querySelector('.indent-gaveta .modal-actions') as HTMLElement;
    expect(rodape.firstElementChild?.className).toBe('indent-enviada');
    expect(within(rodape).getByLabelText('Enviada em')).toBeTruthy();
  });

  it('sem "send" (ex.: aceite em outra cotacao): so o que o backend permite; sem "mark-sent" nem "send": nenhum dos dois botoes', async () => {
    mockApi(cotacao({ allowedActions: ['mark-sent', 'items'] }));
    const sem = renderGaveta();
    await screen.findByRole('button', { name: 'Marcar como enviada (sem e-mail)' });
    expect(screen.queryByRole('button', { name: 'Enviar ao fornecedor' })).toBeNull();
    sem.unmount();

    mockApi(cotacao({ allowedActions: ['refuse'], acceptedQuote: { id: 150, ref: '275/26', supplierName: 'Beta Corp' } }), PORTAL_NAO_ENVIADO);
    renderGaveta();
    await screen.findByRole('button', { name: 'Recusar' });
    expect(screen.queryByRole('button', { name: 'Enviar ao fornecedor' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Marcar como enviada/ })).toBeNull();
  });

  it('a secao "Portal do fornecedor" vem logo DEPOIS do 1o dl.indent-dl e ANTES do painel de itens; a consulta vai a /portal', async () => {
    mockApi(cotacao());
    renderGaveta();
    const secao = await screen.findByRole('region', { name: 'Portal do fornecedor' });

    const dl = document.querySelector('.indent-gaveta dl.indent-dl') as HTMLElement;
    expect(dl.nextElementSibling).toBe(secao);
    expect(secao.nextElementSibling?.className).toBe('indent-itens-precos');
    expect(api.get).toHaveBeenCalledWith(URL_PORTAL);
    await screen.findByText('O link do portal é gerado no envio.');
  });

  it('Enter no "Enviada em" continua marcando como enviada (o 1o botao submit e o "Marcar como enviada"; "Enviar ao fornecedor" nao e submit)', async () => {
    mockApi(cotacao());
    vi.mocked(api.post).mockResolvedValue(cotacao({ status: 'ENVIADA', allowedActions: ['response'] }));
    renderGaveta();
    await screen.findByRole('button', { name: 'Enviar ao fornecedor' });

    const form = document.querySelector('.indent-gaveta form') as HTMLFormElement;
    expect((form.querySelector('button[type="submit"]') as HTMLElement).textContent).toBe('Marcar como enviada (sem e-mail)');
    expect(form.querySelectorAll('button[type="submit"]')).toHaveLength(1);
    fireEvent.change(screen.getByLabelText('Enviada em'), { target: { value: '2026-11-11' } });
    fireEvent.submit(form);

    await waitFor(() => expect(api.post).toHaveBeenCalledWith(`${URL_COTACAO}/mark-sent`, { sentOn: '2026-11-11' }));
    expect(api.post).toHaveBeenCalledTimes(1);
  });
});

describe('IndentCotacaoGaveta - janela "Enviar cotacao"', () => {
  it('abre um dialog.indent-envio IRMAO do dialog.indent-gaveta (nunca descendente), fora do <form> da gaveta', async () => {
    mockApi(cotacao());
    renderGaveta();
    await abrirJanela();

    expect(document.querySelectorAll('dialog')).toHaveLength(2);
    const envio = dialogoEnvio() as HTMLElement;
    expect(dialogoGaveta().contains(envio)).toBe(false);
    expect(envio.contains(dialogoGaveta())).toBe(false);
    expect(envio.parentElement).toBe(dialogoGaveta().parentElement);
    expect(envio.closest('form')).toBeNull();
    expect(envio.querySelectorAll('form')).toHaveLength(1);
    expect(dialogoGaveta().querySelectorAll('form')).toHaveLength(1);
    expect(api.get).toHaveBeenCalledWith(URL_CONTEXTO);
  });

  it('Cancelar fecha so a janela e o foco VOLTA ao "Enviar ao fornecedor" (com o foco tirado antes)', async () => {
    mockApi(cotacao());
    renderGaveta();
    const botao = await abrirJanela();
    await waitFor(() => expect(dialogoEnvio()?.contains(document.activeElement)).toBe(true));
    limparFoco();
    expect(document.activeElement).toBe(document.body);

    fireEvent.click(within(dialogoEnvio() as HTMLElement).getByRole('button', { name: 'Cancelar' }));

    await waitFor(() => expect(dialogoEnvio()).toBeNull());
    expect(dialogoGaveta()).toBeTruthy();
    expect(document.activeElement).toBe(botao);
  });

  it('Esc (cancel) na janela fecha SO a janela: a gaveta continua aberta e onClose da gaveta nao e chamado', async () => {
    mockApi(cotacao());
    const { onClose } = renderGaveta();
    const botao = await abrirJanela();
    limparFoco();

    fireEvent(dialogoEnvio() as HTMLElement, new Event('cancel', { cancelable: true }));

    await waitFor(() => expect(dialogoEnvio()).toBeNull());
    expect(dialogoGaveta()).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(botao);
  });

  it('"Enviar ao fornecedor" com o envio de outra acao em andamento nao abre a janela (aria-disabled, sem perder o foco)', async () => {
    mockApi(cotacao());
    vi.mocked(api.post).mockImplementation((() => new Promise(() => undefined)) as typeof api.post);
    renderGaveta();
    await screen.findByRole('button', { name: 'Enviar ao fornecedor' });
    fireEvent.click(screen.getByRole('button', { name: 'Marcar como enviada (sem e-mail)' }));
    await waitFor(() => expect(botaoEnviarAoFornecedor().getAttribute('aria-disabled')).toBe('true'));

    fireEvent.click(botaoEnviarAoFornecedor());
    expect(dialogoEnvio()).toBeNull();
    expect((botaoEnviarAoFornecedor() as HTMLButtonElement).disabled).toBe(false);
  });

  it('envio OK (parceiro): fecha a janela, mostra o toast literal e a gaveta REMONTA em ENVIADA', async () => {
    mockApi(cotacao(), PORTAL_NAO_ENVIADO);
    const enviada = cotacao({ status: 'ENVIADA', sentAt: '2026-11-13T15:00:00.000Z', allowedActions: ['response', 'resend'], portal: { hasTokens: true } });
    vi.mocked(api.post).mockImplementation((async () => {
      corpoAtual = enviada;
      corpoPortal = PORTAL_AGUARDANDO;
      return { results: [{ email: 'wei@supplier.example', status: 'sent' }], quote: enviada };
    }) as typeof api.post);
    renderGaveta();
    await abrirJanela();

    fireEvent.click(within(dialogoEnvio() as HTMLElement).getByRole('button', { name: 'Enviar' }));

    expect(await screen.findByText('Cotação 275/26 enviada para Wei Zhang Trading (1 destinatário)')).toBeTruthy();
    expect(api.post).toHaveBeenCalledWith(`${URL_COTACAO}/send`, {
      recipients: ['wei@supplier.example'],
      saveToSupplier: false,
      message: null,
      showClientName: true,
      destinationPort: 'Paranaguá',
    });
    await waitFor(() => expect(dialogoEnvio()).toBeNull());
    await screen.findByRole('button', { name: 'Registrar resposta' });
    expect(document.querySelector('header .badge')?.textContent).toBe('Enviada');
    expect(screen.queryByRole('button', { name: 'Enviar ao fornecedor' })).toBeNull();
    // a secao passa a mostrar o link recem-enviado
    await screen.findByText('Aguardando resposta');
  });

  it('envio OK sem parceria: o toast leva " (sem parceria)"; entrega parcial lista quem nao recebeu; "Salvar no cadastro" recarrega os fornecedores', async () => {
    mockApi(cotacao({}, { hasPartnership: false }), PORTAL_NAO_ENVIADO, contexto({ hasPartnership: false, contactEmails: ['wei@supplier.example', 'sales@supplier.example'] }));
    const enviada = cotacao({ status: 'ENVIADA', allowedActions: ['response'] }, { hasPartnership: false });
    vi.mocked(api.post).mockImplementation((async () => {
      corpoAtual = enviada;
      return {
        results: [{ email: 'wei@supplier.example', status: 'sent' }, { email: 'sales@supplier.example', status: 'failed', error: 'caixa cheia' }, { email: 'novo@supplier.example', status: 'queued' }],
        quote: enviada,
      };
    }) as typeof api.post);
    const { qc } = renderGaveta();
    const invalidar = vi.spyOn(qc, 'invalidateQueries');
    await abrirJanela();

    fireEvent.change(screen.getByLabelText('Adicionar outro e-mail'), { target: { value: 'novo@supplier.example' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /Salvar no cadastro do fornecedor/ }));
    fireEvent.click(within(dialogoEnvio() as HTMLElement).getByRole('button', { name: 'Enviar' }));

    expect(await screen.findByText('Cotação 275/26 enviada para Wei Zhang Trading (2 destinatários) (sem parceria)')).toBeTruthy();
    expect(screen.getByText('Não entregue para: sales@supplier.example.')).toBeTruthy();
    expect(invalidar).toHaveBeenCalledWith({ queryKey: ['indent', 'suppliers'] });
    expect(invalidar).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ['indent', 'quotes'] }));
    expect(invalidar).toHaveBeenCalledWith({ queryKey: ['indent', 'requests'] });
  });

  it('apos o envio OK o send-context NAO e pedido de novo (um unico GET, mesmo depois de a invalidacao rodar)', async () => {
    mockApi(cotacao(), PORTAL_NAO_ENVIADO);
    const enviada = cotacao({ status: 'ENVIADA', allowedActions: ['response', 'resend'], portal: { hasTokens: true } });
    vi.mocked(api.post).mockImplementation((async () => {
      corpoAtual = enviada;
      return { results: [{ email: 'wei@supplier.example', status: 'sent' }], quote: enviada };
    }) as typeof api.post);
    renderGaveta();
    await abrirJanela();
    fireEvent.click(within(dialogoEnvio() as HTMLElement).getByRole('button', { name: 'Enviar' }));
    await screen.findByText('Cotação 275/26 enviada para Wei Zhang Trading (1 destinatário)');
    await new Promise((resolver) => setTimeout(resolver, 100));

    expect(vi.mocked(api.get).mock.calls.filter((chamada) => chamada[0] === URL_CONTEXTO)).toHaveLength(1);
  });

  it('apos o envio OK o foco vai para a secao Portal do fornecedor (tabIndex -1), nao para o body (com o foco tirado antes)', async () => {
    mockApi(cotacao(), PORTAL_NAO_ENVIADO);
    const enviada = cotacao({ status: 'ENVIADA', allowedActions: ['response', 'resend'], portal: { hasTokens: true } });
    vi.mocked(api.post).mockImplementation((async () => {
      corpoAtual = enviada;
      corpoPortal = PORTAL_AGUARDANDO;
      return { results: [{ email: 'wei@supplier.example', status: 'sent' }], quote: enviada };
    }) as typeof api.post);
    renderGaveta();
    await abrirJanela();
    limparFoco();
    fireEvent.click(within(dialogoEnvio() as HTMLElement).getByRole('button', { name: 'Enviar' }));

    await screen.findByRole('button', { name: 'Registrar resposta' });
    const secao = screen.getByRole('region', { name: 'Portal do fornecedor' });
    expect(secao.getAttribute('tabindex')).toBe('-1');
    await waitFor(() => expect(document.activeElement).toBe(secao));
  });

  it('502: a janela continua aberta (a gaveta nao remonta nem mostra toast)', async () => {
    mockApi(cotacao());
    vi.mocked(api.post).mockRejectedValue(
      new ApiError(502, { message: 'Nenhum e-mail foi enviado; a cotação voltou para rascunho.', results: [{ email: 'wei@supplier.example', status: 'failed', error: 'timeout' }] }),
    );
    renderGaveta();
    await abrirJanela();
    fireEvent.click(within(dialogoEnvio() as HTMLElement).getByRole('button', { name: 'Enviar' }));

    expect(await screen.findByText(/Nenhum e-mail foi enviado; a cotação voltou para rascunho\./)).toBeTruthy();
    expect(dialogoEnvio()).not.toBeNull();
    expect(screen.queryByTestId('fc-toast')).toBeNull();
  });
});

describe('IndentCotacaoGaveta - secao Portal dentro da gaveta', () => {
  it('"Reenviar link" na secao: confirma inline, POST /resend e toast; a gaveta nao fecha', async () => {
    const enviada = cotacao({ status: 'ENVIADA', sentAt: '2026-11-12T18:40:00.000Z', allowedActions: ['response', 'resend'], portal: { hasTokens: true } });
    mockApi(enviada, PORTAL_AGUARDANDO);
    vi.mocked(api.post).mockResolvedValue({ results: [{ email: 'wei@supplier.example', status: 'sent' }], quote: enviada });
    const { onClose } = renderGaveta();

    fireEvent.click(await screen.findByRole('button', { name: 'Reenviar link' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reenviar' }));

    expect(await screen.findByText('Link reenviado para wei@supplier.example')).toBeTruthy();
    expect(api.post).toHaveBeenCalledWith(`${URL_COTACAO}/resend`, {});
    expect(onClose).not.toHaveBeenCalled();
    expect(dialogoGaveta()).toBeTruthy();
    expect(document.querySelectorAll('dialog')).toHaveLength(1);
  });

  it('o clique na secao NAO dispara o submit do <form> da gaveta (todos os botoes sao type="button")', async () => {
    const enviada = cotacao({ status: 'ENVIADA', allowedActions: ['response', 'resend'], portal: { hasTokens: true } });
    mockApi(enviada, PORTAL_AGUARDANDO);
    renderGaveta();
    fireEvent.click(await screen.findByRole('button', { name: 'Reenviar link' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(api.post).not.toHaveBeenCalled();
  });
});

describe('IndentCotacaoGaveta - guardas de fonte e contrato de CSS (regiao tela F14, secao PR 4b)', () => {
  it('nenhum autoFocus, style inline, dangerouslySetInnerHTML, toISOString ou console nos arquivos novos', () => {
    for (const [nome, fonte] of Object.entries({ fonteEnviar, fontePortal, fonteHelpers, fonteServico })) {
      expect(fonte, nome).not.toMatch(/autoFocus|style=\{\{|dangerouslySetInnerHTML|toISOString|console\./);
      expect(fonte, nome).not.toContain('var(--rf-');
    }
    // o foco inicial e sempre por data-autofocus (nunca autoFocus do React)
    expect(fonteEnviar).toContain('data-autofocus');
  });

  const css = readSource('../styles/globals.css').replace(/\r\n/g, '\n');
  const regiao = regioes(css).find((r) => r.nome === 'tela F14');
  const MARCADOR = '/* ======================= Envio da cotacao e secao Portal do fornecedor (PR 4b)';
  const depois = (regiao?.bruto ?? '').split(MARCADOR)[1];
  const bruto = depois === undefined ? '' : `${MARCADOR}${depois}`;
  const regras = parseRules(stripComments(bruto));
  const classesDoCss = new Set(regras.flatMap((r) => r.prelude.split(',').flatMap((sel) => classesDoSeletor(sel))).filter((c) => c.startsWith('indent-') && c !== 'indent-page'));
  const classesDaRegiao = new Set(
    parseRules(stripComments(regiao?.bruto ?? ''))
      .flatMap((r) => r.prelude.split(',').flatMap((sel) => classesDoSeletor(sel)))
      .filter((c) => c.startsWith('indent-')),
  );
  const classesDoDom = (raiz: ParentNode) => Array.from(raiz.querySelectorAll('[class]')).flatMap((el) => Array.from(el.classList));

  it('a secao do CSS existe, so usa tokens, sem at-rule, sem borda de 1.5px e sem altura fixa solta; toda classe dela e usada e toda classe nova do DOM tem regra', async () => {
    expect(regras.length).toBeGreaterThan(10);
    const limpo = stripComments(bruto);
    expect(limpo).not.toMatch(/@|!important|#[0-9a-fA-F]{3,8}\b|rgba?\(|1\.5px/);
    expect(limpo).not.toMatch(/(^|[;{\s])--[\w-]+\s*:/);
    expect(regras.every((r) => r.prelude.split(',').every((s) => s.trim().startsWith('.indent-page ')))).toBe(true);
    // botoes: so medidas
    const medidas = regras.filter((r) => /\.(ghost|primary)-button/.test(r.prelude) && !r.prelude.includes('aria-disabled')).map((r) => r.body);
    expect(medidas.length).toBe(2);
    expect(medidas.join(' ')).not.toMatch(/border|box-shadow|background/);

    // DOM: gaveta (aguardando, com falhas, anexos e confirmacao) + janela (sem parceria, com anexo, R2, erro 502 com lista)
    mockApi(
      cotacao({ status: 'ENVIADA', allowedActions: ['response', 'resend'], portal: { hasTokens: true } }),
      PORTAL_AGUARDANDO,
    );
    const aguardando = renderGaveta();
    fireEvent.click(await screen.findByRole('button', { name: 'Reenviar link' }));
    const usadas = new Set<string>(classesDoDom(document.body));
    aguardando.unmount();

    mockApi(cotacao({}, { hasPartnership: false }), PORTAL_NAO_ENVIADO, { ...contexto({ hasPartnership: false }), kind: 'REVISION', processRef: 'R2 - 275/26' });
    vi.mocked(api.post).mockRejectedValue(
      new ApiError(502, { message: 'Nenhum e-mail foi enviado; a cotação voltou para rascunho.', results: [{ email: 'wei@supplier.example', status: 'failed', error: 'timeout' }] }),
    );
    renderGaveta();
    await abrirJanela();
    fireEvent.change(screen.getByLabelText('Anexos (opcional)'), { target: { files: [new File(['%PDF-1.4'], 'tds.pdf', { type: 'application/pdf' })] } });
    fireEvent.click(within(dialogoEnvio() as HTMLElement).getByRole('checkbox', { name: 'Conferi que os anexos não citam o cliente.' }));
    fireEvent.click(within(dialogoEnvio() as HTMLElement).getByRole('button', { name: 'Enviar' }));
    await screen.findByText(/Nenhum e-mail foi enviado/);
    classesDoDom(document.body).forEach((c) => usadas.add(c));

    expect(classesDoCss.size).toBeGreaterThan(6);
    expect(Array.from(classesDoCss).filter((c) => !usadas.has(c))).toEqual([]);
    const semRegra = Array.from(usadas).filter((c) => c.startsWith('indent-') && !c.endsWith('-page') && !classesDaRegiao.has(c));
    expect(semRegra).toEqual([]);
  });

  const corpoDe = (seletor: string) => regras.find((r) => r.prelude.split(',').some((x) => x.trim() === seletor))?.body.replace(/\s+/g, ' ') ?? '';

  it('D111: botoes com aria-disabled parecem desabilitados (tokens --rf-disabled-*, cursor not-allowed) e o ocupado volta a cor de repouso com cursor progress', () => {
    const primario = corpoDe(".indent-page .primary-button[aria-disabled='true']");
    expect(primario).toContain('background: var(--rf-disabled-bg)');
    expect(primario).toContain('color: var(--rf-disabled-fg)');
    expect(primario).toContain('cursor: not-allowed');
    const fantasma = corpoDe(".indent-page .ghost-button[aria-disabled='true']");
    expect(fantasma).toContain('color: var(--rf-disabled-fg)');
    expect(fantasma).toContain('cursor: not-allowed');
    expect(corpoDe(".indent-page .modal-actions .ghost-button[aria-disabled='true']")).toContain('background: transparent');
    const ocupado = corpoDe(".indent-page .primary-button[aria-disabled='true'][aria-busy='true']");
    expect(ocupado).toContain('background: var(--rf-primary)');
    expect(ocupado).toContain('cursor: progress');
  });

  it('D111/foco: o anel de foco do sistema NAO some nos botoes aria-disabled (focaveis de proposito): primario recupera o anel DEPOIS do box-shadow: none; fantasma e link de download nao zeram o box-shadow nem o outline', () => {
    const indice = (seletor: string) => regras.findIndex((r) => r.prelude.split(',').some((x) => x.trim() === seletor));
    const primario = indice(".indent-page .primary-button[aria-disabled='true']");
    const anel = indice(".indent-page .primary-button[aria-disabled='true']:focus-visible");
    expect(primario).toBeGreaterThanOrEqual(0);
    expect(anel).toBeGreaterThan(primario);
    const corpoAnel = corpoDe(".indent-page .primary-button[aria-disabled='true']:focus-visible");
    expect(corpoAnel).toContain('outline: 2px solid transparent');
    expect(corpoAnel).toContain('box-shadow: 0 0 0 3px var(--rf-surface), 0 0 0 5px var(--rf-action)');
    // as demais regras de aria-disabled/linkbtn desta secao nunca anulam o anel (box-shadow/outline) do :focus-visible do sistema
    for (const r of regras.filter((x) => /aria-disabled|indent-linkbtn/.test(x.prelude) && !x.prelude.includes('focus-visible') && !x.prelude.includes('.primary-button'))) {
      expect(r.body, r.prelude).not.toMatch(/box-shadow|outline/);
    }
  });

  it('D112: o file-input da janela perde a margem inferior; D113: o botao de download do anexo tem 36px; D115: halo do IQ no foco da secao, do alerta e dos checkboxes', () => {
    expect(corpoDe('.indent-page .indent-envio .file-input')).toContain('margin-bottom: 0');
    expect(corpoDe('.indent-page .indent-portal__lista .indent-linkbtn')).toContain('min-height: 36px');
    for (const seletor of ['.indent-page .indent-portal:focus-visible', ".indent-page .indent-envio .alert[tabindex='-1']:focus-visible", '.indent-page .indent-check input:focus-visible']) {
      const corpo = corpoDe(seletor);
      expect(corpo, seletor).toContain('outline: 2px solid transparent');
      expect(corpo, seletor).toContain('box-shadow: 0 0 0 3px var(--rf-surface), 0 0 0 5px var(--rf-action)');
    }
  });
});
