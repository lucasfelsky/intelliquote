import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import IndentPortalSecao from './IndentPortalSecao';

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

// Secao "Portal do fornecedor" da gaveta (PR 4b, mock v13 portalSec): 4 estados + "Link vencido", dl literal, anexos do fornecedor (download binario),
// falhas de envio, "Reenviar link" so com canResend e confirmacao INLINE. Dados FICTICIOS.

type Obj = Record<string, unknown>;

const URL_PORTAL = '/api/v1/indent/quotes/100/portal';
const URL_REENVIO = '/api/v1/indent/quotes/100/resend';
const AGORA = new Date('2026-11-20T12:00:00.000Z');

const COTACAO = (extra: Obj = {}) => ({ id: 100, ref: '275/26', status: 'ENVIADA', acceptedQuote: null, ...extra }) as never;

function estado(extra: Obj = {}) {
  return {
    state: 'AGUARDANDO',
    lastSentAt: '2026-11-12T18:40:00.000Z', // 15:40 em Sao Paulo
    recipients: ['wei@supplier.example', 'sales@supplier.example'],
    lastAccessAt: null,
    expiresAt: '2026-11-26T18:40:00.000Z',
    canResend: true,
    mails: [],
    response: null,
    attachments: [],
    ...extra,
  };
}

function mockPortal(corpo: unknown) {
  vi.mocked(api.get).mockImplementation((async (url: string) => {
    if (url === URL_PORTAL) {
      if (corpo instanceof Error) throw corpo;
      return corpo;
    }
    return {};
  }) as typeof api.get);
}

function renderSecao(cotacao: unknown = COTACAO()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidar = vi.spyOn(qc, 'invalidateQueries');
  const mostrar = vi.fn();
  const tela = render(
    <QueryClientProvider client={qc}>
      <IndentPortalSecao quote={cotacao as never} mostrar={mostrar} />
    </QueryClientProvider>,
  );
  return { ...tela, invalidar, mostrar };
}

async function abrir(corpo: unknown, cotacao: unknown = COTACAO()) {
  mockPortal(corpo);
  const tela = renderSecao(cotacao);
  await screen.findByRole('heading', { name: 'Portal do fornecedor' });
  await waitFor(() => expect(screen.queryByText('Carregando o estado do portal…')).toBeNull());
  return tela;
}

const secao = () => document.querySelector('section.indent-portal') as HTMLElement;
const tag = () => secao().querySelector('.indent-painel__cabeca .indent-tag') as HTMLElement;
const linhas = () => {
  const dl = secao().querySelector('dl.indent-dl') as HTMLElement;
  const dts = Array.from(dl.querySelectorAll('dt')).map((dt) => dt.textContent);
  const dds = Array.from(dl.querySelectorAll('dd')).map((dd) => dd.textContent);
  return Object.fromEntries(dts.map((dt, i) => [dt, dds[i]]));
};
const botaoReenviar = () => screen.getByRole('button', { name: 'Reenviar link' });
function limparFoco() {
  (document.activeElement as HTMLElement | null)?.blur();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(AGORA);
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset();
  vi.mocked(api.blob).mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('IndentPortalSecao - estados e tags', () => {
  it('NAO_ENVIADO: tag neutra "Não enviado" e o texto do mock; sem dl e sem botao', async () => {
    await abrir(estado({ state: 'NAO_ENVIADO', lastSentAt: null, recipients: [], expiresAt: null, canResend: false }), COTACAO({ status: 'RASCUNHO' }));

    expect(secao().getAttribute('aria-labelledby')).toBe(secao().querySelector('h2')?.id);
    expect(tag().textContent).toBe('Não enviado');
    expect(tag().className).toBe('indent-tag');
    expect(screen.getByText('O link do portal é gerado no envio.')).toBeTruthy();
    expect(secao().querySelector('dl')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('MARCADA_SEM_EMAIL: "Enviada sem e-mail" e o aviso de que nao ha link; sem botao', async () => {
    await abrir(estado({ state: 'MARCADA_SEM_EMAIL', lastSentAt: null, recipients: [], expiresAt: null, canResend: false }));

    expect(tag().textContent).toBe('Enviada sem e-mail');
    expect(tag().className).toBe('indent-tag');
    expect(screen.getByText('Marcada como enviada sem e-mail: não há link do portal.')).toBeTruthy();
    expect(secao().querySelector('dl')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('AGUARDANDO (nunca acessado): tag ambar e as 3 linhas literais do mock (data em Sao Paulo, "para" com os e-mails, validade dd/mm/aaaa)', async () => {
    await abrir(estado());

    expect(tag().textContent).toBe('Aguardando resposta');
    expect(tag().className).toBe('indent-tag indent-tag--manual');
    expect(linhas()).toEqual({
      'Link enviado': '12/11 15:40 para wei@supplier.example, sales@supplier.example',
      Acesso: 'Ainda não acessado',
      Validade: '26/11/2026',
    });
  });

  it('AGUARDANDO (acessado): "Acessado em dd/mm hh:mm"', async () => {
    await abrir(estado({ lastAccessAt: '2026-11-13T12:12:00.000Z' }));
    expect(linhas().Acesso).toBe('Acessado em 13/11 09:12');
  });

  it('"Link vencido": validade no passado OU nula (todos os links revogados) = tag vermelha e " (vencido)" na validade', async () => {
    const passado = await abrir(estado({ expiresAt: '2026-11-19T18:40:00.000Z' }));
    expect(tag().textContent).toBe('Link vencido');
    expect(tag().className).toBe('indent-tag indent-tag--lock');
    expect(linhas().Validade).toBe('19/11/2026 (vencido)');
    passado.unmount();

    await abrir(estado({ expiresAt: null }));
    expect(tag().textContent).toBe('Link vencido');
    expect(linhas().Validade).toBe('— (vencido)');
  });

  it('RESPONDIDO pelo portal: tag verde, "Versão N recebida em" e as linhas do link', async () => {
    await abrir(estado({ state: 'RESPONDIDO', lastAccessAt: '2026-11-13T12:12:00.000Z', response: { version: 2, submittedAt: '2026-11-13T12:20:00.000Z', via: 'portal' } }));

    expect(tag().textContent).toBe('Resposta recebida');
    expect(tag().className).toBe('indent-tag indent-tag--ok');
    expect(linhas()).toEqual({
      'Link enviado': '12/11 15:40 para wei@supplier.example, sales@supplier.example',
      Acesso: 'Acessado em 13/11 09:12',
      Validade: '26/11/2026',
      Resposta: 'Versão 2 recebida em 13/11 09:20',
    });
  });

  it('RESPONDIDO manual sem nenhum link: so a linha "Registrada manualmente em" (nada de "Ainda não acessado")', async () => {
    await abrir(
      estado({
        state: 'RESPONDIDO',
        lastSentAt: null,
        recipients: [],
        expiresAt: null,
        canResend: false,
        response: { version: null, submittedAt: '2026-11-13T12:20:00.000Z', via: 'manual' },
      }),
    );
    expect(linhas()).toEqual({ Resposta: 'Registrada manualmente em 13/11 09:20' });
  });

  it('RESPONDIDO manual COM link enviado antes: mostra o link e a resposta manual', async () => {
    await abrir(estado({ state: 'RESPONDIDO', response: { version: null, submittedAt: '2026-11-13T12:20:00.000Z', via: 'manual' } }));
    expect(linhas().Resposta).toBe('Registrada manualmente em 13/11 09:20');
    expect(linhas()['Link enviado']).toContain('12/11 15:40');
  });

  it('link enviado sem lista de e-mails: so a data', async () => {
    await abrir(estado({ recipients: [] }));
    expect(linhas()['Link enviado']).toBe('12/11 15:40');
  });

  it('resposta {} ou [] (testes antigos): texto neutro, SEM role="alert" e sem botao; erro de rede tambem', async () => {
    const vazio = await abrir({});
    expect(screen.getByText('Estado do portal indisponível.')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(secao().querySelector('.indent-tag')).toBeNull();
    vazio.unmount();

    const lista = await abrir([]);
    expect(screen.getByText('Estado do portal indisponível.')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    lista.unmount();

    await abrir(new ApiError(500, { message: 'Erro interno.' }));
    expect(screen.getByText('Estado do portal indisponível.')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('403 (sem acesso): a secao nao renderiza nada', async () => {
    mockPortal(new ApiError(403, { message: 'Sem permissão.' }));
    renderSecao();
    await waitFor(() => expect(api.get).toHaveBeenCalledWith(URL_PORTAL));
    await waitFor(() => expect(document.querySelector('section.indent-portal')).toBeNull());
    expect(screen.queryByText('Estado do portal indisponível.')).toBeNull();
  });
});

describe('IndentPortalSecao - anexos do fornecedor e falhas de envio', () => {
  const ANEXOS = [
    { id: 3, fileName: 'TDS final.pdf', fileSize: 870400, createdAt: '2026-11-13T12:19:00.000Z' },
    { id: 4, fileName: 'MSDS.pdf', fileSize: 1258291, createdAt: '2026-11-13T12:19:30.000Z' },
  ];

  function prepararDownload() {
    const createObjectURL = vi.fn(() => 'blob:fake');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true, writable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, configurable: true, writable: true });
    const clicados: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicados.push(this);
    });
    return { createObjectURL, revokeObjectURL, clicados };
  }

  it('linha "Anexos do fornecedor": um botao-link por arquivo, com icone e "nome (tamanho)"', async () => {
    await abrir(estado({ state: 'RESPONDIDO', attachments: ANEXOS, response: { version: 1, submittedAt: '2026-11-13T12:20:00.000Z', via: 'portal' } }));

    const botoes = within(secao().querySelector('dl') as HTMLElement).getAllByRole('button');
    expect(botoes.map((b) => b.textContent?.trim())).toEqual(['TDS final.pdf (850 KB)', 'MSDS.pdf (1,2 MB)']);
    expect(botoes.every((b) => b.className === 'indent-linkbtn' && b.getAttribute('type') === 'button' && b.querySelector('svg'))).toBe(true);
  });

  it('clicar baixa por api.blob (URL exata, nunca por api.get) e entrega por <a download> com o nome do arquivo', async () => {
    const { createObjectURL, revokeObjectURL, clicados } = prepararDownload();
    const blob = new Blob(['%PDF-1.4'], { type: 'application/pdf' });
    vi.mocked(api.blob).mockResolvedValue(blob);
    await abrir(estado({ attachments: ANEXOS }));

    fireEvent.click(screen.getByRole('button', { name: /TDS final\.pdf/ }));

    await waitFor(() => expect(clicados).toHaveLength(1));
    expect(api.blob).toHaveBeenCalledWith('/api/v1/indent/quotes/100/portal-attachments/3');
    expect(vi.mocked(api.get).mock.calls.map((c) => c[0])).toEqual([URL_PORTAL]);
    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(clicados[0]?.download).toBe('TDS final.pdf');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('falha do download: mensagem "Não foi possível baixar o anexo: ..." (role=alert) e o botao continua utilizavel', async () => {
    prepararDownload();
    vi.mocked(api.blob).mockRejectedValue(new ApiError(404, { message: 'Anexo não encontrado.' }));
    await abrir(estado({ attachments: ANEXOS }));

    fireEvent.click(screen.getByRole('button', { name: /TDS final\.pdf/ }));

    const erro = await screen.findByRole('alert');
    expect(erro.textContent).toBe('Não foi possível baixar o anexo: Anexo não encontrado.');
    expect(erro.className).toContain('field-error');
    expect(screen.getByRole('button', { name: /TDS final\.pdf/ }).getAttribute('aria-disabled')).toBeNull();
  });

  it('falhas de envio: so failed e suppressed, "dd/mm hh:mm · e-mail · motivo", ate 5 das mais recentes', async () => {
    const mail = (id: number, status: string, extra: Obj = {}) => ({
      id,
      kind: 'REQUEST',
      toEmail: `u${id}@supplier.example`,
      status,
      errorMessage: null,
      createdAt: '2026-11-12T18:40:00.000Z',
      sentAt: null,
      attachmentNames: [],
      ...extra,
    });
    await abrir(
      estado({
        mails: [
          mail(1, 'sent'),
          mail(2, 'failed', { errorMessage: 'caixa cheia' }),
          mail(3, 'suppressed', { errorMessage: 'interno' }),
          mail(4, 'failed'),
          mail(5, 'queued'),
          mail(6, 'failed', { errorMessage: 'seis' }),
          mail(7, 'failed', { errorMessage: 'sete' }),
          mail(8, 'failed', { errorMessage: 'oito' }),
          mail(9, 'failed', { errorMessage: 'nove' }),
        ],
      }),
    );

    const lista = screen.getByRole('list', { name: 'Falhas de envio' });
    expect(Array.from(lista.querySelectorAll('li')).map((li) => li.textContent)).toEqual([
      '12/11 15:40 · u2@supplier.example · caixa cheia',
      '12/11 15:40 · u3@supplier.example · endereço interno bloqueado (não enviado)',
      '12/11 15:40 · u4@supplier.example · falha no envio',
      '12/11 15:40 · u6@supplier.example · seis',
      '12/11 15:40 · u7@supplier.example · sete',
    ]);
  });

  it('sem falhas nao ha a lista; NAO_ENVIADO apos compensacao mostra as falhas recentes', async () => {
    const limpo = await abrir(estado());
    expect(screen.queryByRole('list', { name: 'Falhas de envio' })).toBeNull();
    limpo.unmount();

    await abrir(
      estado({
        state: 'NAO_ENVIADO',
        lastSentAt: null,
        recipients: [],
        expiresAt: null,
        canResend: false,
        mails: [{ id: 1, kind: 'REQUEST', toEmail: 'wei@supplier.example', status: 'failed', errorMessage: 'timeout', createdAt: '2026-11-12T18:40:00.000Z', sentAt: null, attachmentNames: [] }],
      }),
      COTACAO({ status: 'RASCUNHO' }),
    );
    expect(screen.getByText('O link do portal é gerado no envio.')).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Falhas de envio' }).textContent).toBe('12/11 15:40 · wei@supplier.example · timeout');
  });
});

describe('IndentPortalSecao - Reenviar link', () => {
  it('so aparece com canResend (viewer e estados sem link nao veem o botao)', async () => {
    const sem = await abrir(estado({ canResend: false }));
    expect(screen.queryByRole('button', { name: 'Reenviar link' })).toBeNull();
    sem.unmount();

    await abrir(estado({ canResend: true }));
    const botao = botaoReenviar();
    expect(botao.getAttribute('type')).toBe('button');
    expect(botao.className).toBe('ghost-button');
    expect(botao.querySelector('svg')).not.toBeNull();
  });

  it('aceite em outra cotacao (ENVIADA, sem canResend): aviso "Reenvio bloqueado..." no lugar do botao', async () => {
    await abrir(estado({ canResend: false }), COTACAO({ acceptedQuote: { id: 150, ref: '275/26', supplierName: 'Beta Corp' } }));
    expect(screen.getByText('Reenvio bloqueado: a solicitação já tem uma cotação aceita. O link já enviado continua valendo.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reenviar link' })).toBeNull();
  });

  it('sem aceite nao ha o aviso de bloqueio, mesmo sem canResend', async () => {
    await abrir(estado({ canResend: false }));
    expect(screen.queryByText(/Reenvio bloqueado/)).toBeNull();
  });

  it('o clique abre a confirmacao INLINE (grupo "Confirmar reenvio"): texto com os e-mails, foco em "Reenviar" e o botao original some', async () => {
    await abrir(estado());
    botaoReenviar().focus();
    fireEvent.click(botaoReenviar());

    const grupo = screen.getByRole('group', { name: 'Confirmar reenvio' });
    expect(grupo.textContent).toContain(
      'Reenviar o link para wei@supplier.example, sales@supplier.example? Os links anteriores deixam de valer para quem receber o novo.',
    );
    expect(screen.queryByRole('button', { name: 'Reenviar link' })).toBeNull();
    expect(Array.from(grupo.querySelectorAll('button')).map((b) => b.textContent)).toEqual(['Cancelar', 'Reenviar']);
    expect(grupo.querySelector('button.ghost-button')?.textContent).toBe('Cancelar');
    expect(grupo.querySelector('button.primary-button')?.textContent).toBe('Reenviar');
    expect(grupo.closest('dialog')).toBeNull(); // sem dialog aninhado
    await waitFor(() => expect(document.activeElement).toBe(within(grupo).getByRole('button', { name: 'Reenviar' })));
    expect(api.post).not.toHaveBeenCalled();
  });

  it('Cancelar fecha a confirmacao e DEVOLVE o foco ao "Reenviar link" (com o foco tirado antes)', async () => {
    await abrir(estado());
    fireEvent.click(botaoReenviar());
    const grupo = screen.getByRole('group', { name: 'Confirmar reenvio' });
    limparFoco();
    expect(document.activeElement).toBe(document.body);

    fireEvent.click(within(grupo).getByRole('button', { name: 'Cancelar' }));

    expect(screen.queryByRole('group', { name: 'Confirmar reenvio' })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(botaoReenviar()));
    expect(api.post).not.toHaveBeenCalled();
  });

  it('confirmar: POST /resend com {}, toast "Link reenviado para ..." e as consultas sao recarregadas; foco volta ao "Reenviar link"', async () => {
    vi.mocked(api.post).mockResolvedValue({
      results: [{ email: 'wei@supplier.example', status: 'sent' }, { email: 'sales@supplier.example', status: 'queued' }],
      quote: {},
    });
    const { mostrar, invalidar } = await abrir(estado());
    fireEvent.click(botaoReenviar());
    limparFoco();
    fireEvent.click(screen.getByRole('button', { name: 'Reenviar' }));

    await waitFor(() => expect(mostrar).toHaveBeenCalledTimes(1));
    expect(api.post).toHaveBeenCalledWith(URL_REENVIO, {});
    expect(mostrar).toHaveBeenCalledWith('salvo', 'Link reenviado para wei@supplier.example, sales@supplier.example', '');
    expect(invalidar).toHaveBeenCalledWith({ queryKey: ['indent', 'quotes'] });
    expect(invalidar).toHaveBeenCalledWith({ queryKey: ['indent', 'requests'] });
    expect(screen.queryByRole('group', { name: 'Confirmar reenvio' })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(botaoReenviar()));
  });

  it('entrega parcial: o toast lista so os entregues e o texto diz "Não entregue para: ..."', async () => {
    vi.mocked(api.post).mockResolvedValue({
      results: [{ email: 'wei@supplier.example', status: 'sent' }, { email: 'sales@supplier.example', status: 'failed', error: 'caixa cheia' }],
      quote: {},
    });
    const { mostrar } = await abrir(estado());
    fireEvent.click(botaoReenviar());
    fireEvent.click(screen.getByRole('button', { name: 'Reenviar' }));

    await waitFor(() => expect(mostrar).toHaveBeenCalledTimes(1));
    expect(mostrar).toHaveBeenCalledWith('salvo', 'Link reenviado para wei@supplier.example', 'Não entregue para: sales@supplier.example.');
  });

  it('dois cliques em "Reenviar" disparam UM POST; o botao fica aria-busy e aria-disabled (nao disabled) e conserva o foco', async () => {
    vi.mocked(api.post).mockImplementation((() => new Promise(() => undefined)) as typeof api.post);
    await abrir(estado());
    fireEvent.click(botaoReenviar());
    const confirmar = screen.getByRole('button', { name: 'Reenviar' });
    confirmar.focus();

    fireEvent.click(confirmar);
    fireEvent.click(confirmar);
    fireEvent.click(confirmar);

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(confirmar.getAttribute('aria-busy')).toBe('true'));
    expect(confirmar.getAttribute('aria-disabled')).toBe('true');
    expect((confirmar as HTMLButtonElement).disabled).toBe(false);
    expect(document.activeElement).toBe(confirmar);
    // Cancelar tambem fica inerte durante o envio
    fireEvent.click(within(screen.getByRole('group', { name: 'Confirmar reenvio' })).getByRole('button', { name: 'Cancelar' }));
    expect(screen.getByRole('group', { name: 'Confirmar reenvio' })).toBeTruthy();
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it.each([
    [409, 'Esta solicitação já tem uma cotação aceita (275/26 · Beta Corp).'],
    [422, 'O conteúdo do e-mail identifica o cliente (campo: items[0].name). Revise o item ou o porto antes de enviar.'],
  ])('%i: a mensagem do backend aparece DENTRO da secao (alerta ambar), as consultas sao recarregadas e o foco volta ao "Reenviar link"', async (status, texto) => {
    vi.mocked(api.post).mockRejectedValue(new ApiError(status, { message: texto }));
    const { invalidar, mostrar } = await abrir(estado());
    fireEvent.click(botaoReenviar());
    limparFoco();
    fireEvent.click(screen.getByRole('button', { name: 'Reenviar' }));

    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toBe(texto);
    expect(alerta.className).toContain('alert--warning');
    expect(secao().contains(alerta)).toBe(true);
    expect(invalidar).toHaveBeenCalledWith({ queryKey: ['indent', 'quotes'] });
    expect(mostrar).not.toHaveBeenCalled();
    expect(screen.queryByRole('group', { name: 'Confirmar reenvio' })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(botaoReenviar()));
  });

  it('502: mensagem + lista "e-mail: motivo" por destinatario dentro da secao', async () => {
    vi.mocked(api.post).mockRejectedValue(
      new ApiError(502, {
        message: 'Nenhum e-mail foi reenviado; os links anteriores continuam valendo.',
        results: [
          { email: 'wei@supplier.example', status: 'failed', error: 'caixa cheia' },
          { email: 'sales@supplier.example', status: 'suppressed' },
        ],
      }),
    );
    await abrir(estado());
    fireEvent.click(botaoReenviar());
    fireEvent.click(screen.getByRole('button', { name: 'Reenviar' }));

    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toContain('Nenhum e-mail foi reenviado; os links anteriores continuam valendo.');
    expect(Array.from(alerta.querySelectorAll('li')).map((li) => li.textContent)).toEqual([
      'wei@supplier.example: caixa cheia',
      'sales@supplier.example: endereço interno bloqueado (não enviado)',
    ]);
  });

  it('erro de rede: alerta com a mensagem do erro', async () => {
    vi.mocked(api.post).mockRejectedValue(new Error('Falha de rede'));
    await abrir(estado());
    fireEvent.click(botaoReenviar());
    fireEvent.click(screen.getByRole('button', { name: 'Reenviar' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Falha de rede');
  });

  it('todos os botoes da secao sao type="button" (ela vive DENTRO do <form> da gaveta)', async () => {
    await abrir(estado({ attachments: [{ id: 3, fileName: 'a.pdf', fileSize: 10, createdAt: '2026-11-13T12:19:00.000Z' }] }));
    fireEvent.click(botaoReenviar());
    const botoes = Array.from(secao().querySelectorAll('button'));
    expect(botoes.length).toBeGreaterThanOrEqual(3);
    expect(botoes.every((b) => b.getAttribute('type') === 'button')).toBe(true);
  });
});
