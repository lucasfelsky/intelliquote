import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import IndentEnviarModal from './IndentEnviarModal';

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

// Janela "Enviar cotacao" (PR 4b, mock v13 openSend): parceria x sem parceria, destinatarios, validacao no cliente com as mensagens do backend,
// payload exato, resultados (200/400 por path/413/422/409/502) e foco. Dados FICTICIOS (dominios .example/.test).

type Obj = Record<string, unknown>;

const URL_CONTEXTO = '/api/v1/indent/quotes/100/send-context';
const URL_ENVIO = '/api/v1/indent/quotes/100/send';

const COTACAO = {
  id: 100,
  ref: '275/26',
  revision: 1,
  status: 'RASCUNHO',
  supplier: { id: 5, name: 'Wei Zhang Trading', country: 'China', contactName: 'Wei Zhang', hasPartnership: true, type: 'TRADING' },
  items: [],
  allowedActions: ['mark-sent', 'items', 'send'],
} as never;

function contexto(extra: Obj = {}, fornecedor: Obj = {}) {
  return {
    processRef: '275/26',
    kind: 'REQUEST',
    subject: '275/26 · Indent quotation request · Citric acid anhydrous',
    fromDisplay: 'SQ Quimica | Indent <indent-envio@sqquimica.test>',
    replyTo: 'indent@sqquimica.com',
    supplier: { id: 5, name: 'Wei Zhang Trading', hasPartnership: true, contactEmails: ['wei@supplier.example', 'sales@supplier.example'], ...fornecedor },
    clientName: 'Indústria Química Vale do Itajaí Ltda',
    destinationPort: 'Paranaguá',
    firstItemName: 'Citric acid anhydrous',
    ...extra,
  };
}

const SEM_PARCERIA = { hasPartnership: false };
const SEM_EMAIL = { contactEmails: [] };
const RESPOSTA_OK = {
  results: [{ email: 'wei@supplier.example', status: 'sent' }, { email: 'sales@supplier.example', status: 'sent' }],
  quote: { id: 100, ref: '275/26', status: 'ENVIADA' },
};

function mockContexto(corpo: unknown) {
  vi.mocked(api.get).mockImplementation((async (url: string) => {
    if (url === URL_CONTEXTO) {
      if (corpo instanceof Error) throw corpo;
      return corpo;
    }
    return {};
  }) as typeof api.get);
}

function renderModal() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidar = vi.spyOn(qc, 'invalidateQueries');
  const onClose = vi.fn();
  const onEnviado = vi.fn();
  const tela = render(
    <QueryClientProvider client={qc}>
      <IndentEnviarModal quote={COTACAO} onClose={onClose} onEnviado={onEnviado} />
    </QueryClientProvider>,
  );
  return { ...tela, qc, invalidar, onClose, onEnviado };
}

async function abrir(ctx: unknown = contexto()) {
  mockContexto(ctx);
  const tela = renderModal();
  await screen.findByRole('button', { name: 'Enviar' });
  return tela;
}

const botaoEnviar = () => screen.getByRole('button', { name: 'Enviar' });
const campoExtra = () => (screen.queryByLabelText('Adicionar outro e-mail') ?? screen.getByLabelText('E-mail do fornecedor')) as HTMLInputElement;
const porto = () => screen.getByLabelText('Porto de destino (CFR)') as HTMLInputElement;
const mensagem = () => screen.getByLabelText('Mensagem ao fornecedor (opcional)') as HTMLTextAreaElement;
const arquivos = () => screen.getByLabelText('Anexos (opcional)') as HTMLInputElement;
const mostrarCliente = () => screen.getByRole('checkbox', { name: /Mostrar o nome do cliente ao fornecedor/ }) as HTMLInputElement;
const salvar = () => screen.getByRole('checkbox', { name: /Salvar no cadastro do fornecedor/ }) as HTMLInputElement;
const painel = () => document.querySelector('.indent-envio__visivel') as HTMLElement;

const pdf = (nome: string, conteudo = '%PDF-1.4 teste') => new File([conteudo], nome, { type: 'application/pdf' });
function anexar(...lista: File[]) {
  fireEvent.change(arquivos(), { target: { files: lista } });
}
function limparFoco() {
  (document.activeElement as HTMLElement | null)?.blur();
}

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset();
});

describe('IndentEnviarModal - cabecalho, parceria e destinatarios', () => {
  it('janela do mock: eyebrow "Enviar cotacao <ref>", titulo = fornecedor, dialog.indent-envio com Cancelar e Enviar', async () => {
    await abrir();
    const dialogo = screen.getByRole('dialog', { name: 'Wei Zhang Trading' });
    expect(dialogo.classList.contains('indent-envio')).toBe(true);
    expect(dialogo.querySelector('.modal-eyebrow')?.textContent).toBe('Enviar cotação 275/26');
    expect(Array.from(dialogo.querySelectorAll('.modal-actions button')).map((b) => b.textContent)).toEqual(['Cancelar', 'Enviar']);
    expect(dialogo.querySelector('.modal-actions .ghost-button')?.textContent).toBe('Cancelar');
    expect(dialogo.querySelector('.modal-actions .primary-button[type="submit"]')?.textContent).toBe('Enviar');
    expect(dialogo.querySelector('.modal-actions .primary-button svg')).not.toBeNull();
  });

  it('carregando: status "Carregando dados do envio…" e nenhum botao Enviar', async () => {
    vi.mocked(api.get).mockImplementation((() => new Promise(() => undefined)) as typeof api.get);
    renderModal();
    expect(screen.getByRole('status').textContent).toBe('Carregando dados do envio…');
    expect(screen.queryByRole('button', { name: 'Enviar' })).toBeNull();
  });

  it('com parceria: aviso verde literal e "Mostrar o nome do cliente" marcada e habilitada', async () => {
    await abrir();
    const aviso = document.querySelector('.alert--success') as HTMLElement;
    expect(aviso.textContent).toBe('Parceria firmada. O nome do cliente pode ser exibido ao fornecedor.');
    expect(aviso.querySelector('svg')).not.toBeNull();
    expect(document.querySelector('.alert--warning')).toBeNull();
    expect(mostrarCliente().checked).toBe(true);
    expect(mostrarCliente().disabled).toBe(false);
    expect(document.querySelector('.indent-tag--lock')).toBeNull();
  });

  it('sem parceria: aviso ambar literal e a caixa desabilitada, desmarcada e com a tag "Bloqueado"', async () => {
    await abrir(contexto({}, SEM_PARCERIA));
    const aviso = document.querySelector('.alert--warning') as HTMLElement;
    expect(aviso.textContent).toBe(
      'Sem parceria firmada. A SQ Química aparece, mas nada no e-mail, no portal, nos anexos e na mensagem pode dizer que ela é a compradora ou identificar o cliente final.',
    );
    expect(document.querySelector('.alert--success')).toBeNull();
    expect(mostrarCliente().checked).toBe(false);
    expect(mostrarCliente().disabled).toBe(true);
    const tag = document.querySelector('.indent-tag--lock') as HTMLElement;
    expect(tag.textContent).toBe('Bloqueado');
    expect(mostrarCliente().closest('label')?.contains(tag)).toBe(true);
  });

  it('com e-mails no cadastro: um checkbox MARCADO por e-mail no grupo "Para", foco no 1o e campo "Adicionar outro e-mail (opcional)"', async () => {
    await abrir();
    const grupo = screen.getByRole('group', { name: 'Para' });
    const caixas = within(grupo).getAllByRole('checkbox').filter((c) => !/Salvar no cadastro/.test(c.closest('label')?.textContent ?? '')) as HTMLInputElement[];
    expect(caixas.map((c) => c.closest('label')?.textContent)).toEqual(['wei@supplier.example', 'sales@supplier.example']);
    expect(caixas.every((c) => c.checked)).toBe(true);
    expect(campoExtra().placeholder).toBe('Adicionar outro e-mail (opcional)');
    expect(screen.queryByText(/não tem e-mail cadastrado/)).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(caixas[0]));
    expect(caixas[0]?.getAttribute('data-autofocus')).not.toBeNull();
    expect(campoExtra().getAttribute('data-autofocus')).toBeNull();
  });

  it('sem e-mail no cadastro: aviso literal, campo "E-mail do fornecedor" com o foco (data-autofocus) e nenhum checkbox de e-mail', async () => {
    await abrir(contexto({}, SEM_EMAIL));
    expect(screen.getByText('Este fornecedor não tem e-mail cadastrado. Digite um abaixo; você pode salvá-lo no cadastro.')).toBeTruthy();
    expect(campoExtra().placeholder).toBe('E-mail do fornecedor');
    expect(campoExtra().getAttribute('data-autofocus')).not.toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(campoExtra()));
    const grupo = screen.getByRole('group', { name: 'Para' });
    expect(within(grupo).getAllByRole('checkbox')).toHaveLength(1); // so "Salvar no cadastro"
  });

  it('nunca usa autoFocus do React: o foco inicial vem do atributo data-autofocus', async () => {
    await abrir();
    expect(document.querySelectorAll('[data-autofocus]')).toHaveLength(1);
    expect(document.querySelector('[autofocus]')).toBeNull();
  });

  it('"Salvar no cadastro": habilitada com 9 e-mails; desabilitada com 10 e a dica "O cadastro já tem 10 e-mails."', async () => {
    const nove = Array.from({ length: 9 }, (_, i) => `u${i}@supplier.example`);
    const tela = await abrir(contexto({}, { contactEmails: nove }));
    expect(salvar().disabled).toBe(false);
    expect(screen.queryByText('O cadastro já tem 10 e-mails.')).toBeNull();
    tela.unmount();

    await abrir(contexto({}, { contactEmails: [...nove, 'u9@supplier.example'] }));
    expect(salvar().disabled).toBe(true);
    expect(screen.getByText('O cadastro já tem 10 e-mails.')).toBeTruthy();
  });

  it('remetente, "Responder para" e assunto vem do contexto (assunto em mono)', async () => {
    await abrir();
    const dl = document.querySelector('dl.indent-dl') as HTMLElement;
    expect(Array.from(dl.querySelectorAll('dt')).map((dt) => dt.textContent)).toEqual(['Remetente', 'Responder para', 'Assunto']);
    expect(Array.from(dl.querySelectorAll('dd')).map((dd) => dd.textContent)).toEqual([
      'SQ Quimica | Indent <indent-envio@sqquimica.test>',
      'indent@sqquimica.com',
      '275/26 · Indent quotation request · Citric acid anhydrous',
    ]);
    expect(dl.querySelectorAll('dd')[2]?.className).toContain('indent-dl__mono');
  });

  it('porto de destino vem preenchido do contexto, com dica; anexos e mensagem com os textos do plano', async () => {
    await abrir();
    expect(porto().value).toBe('Paranaguá');
    expect(porto().maxLength).toBe(80);
    expect(screen.getByText('Aparece no e-mail e no portal. Não use nada que identifique o cliente.')).toBeTruthy();
    expect(arquivos().accept).toBe('.pdf,application/pdf');
    expect(arquivos().multiple).toBe(true);
    expect(screen.getByText('Até 3 PDFs, 10 MB no total. Os anexos não ficam guardados no IQ.')).toBeTruthy();
    expect(mensagem().placeholder).toBe('Ex.: Podem melhorar o preço do STPP?');
    expect(mensagem().maxLength).toBe(2000);
    expect(mensagem().rows).toBe(3);
  });

  it('revisao R2: eyebrow com "R2 - ", aviso azul e a linha "Oferta anterior" no painel; pedido novo nao tem nenhum dos dois', async () => {
    const r2 = await abrir(contexto({ kind: 'REVISION', processRef: 'R2 - 275/26' }));
    expect(document.querySelector('.modal-eyebrow')?.textContent).toBe('Enviar cotação R2 - 275/26');
    expect(document.querySelector('.alert--info')?.textContent).toBe('Revisão: o fornecedor verá a oferta anterior preenchida no portal. Os links da versão anterior deixam de valer.');
    expect(painel().textContent).toContain('Oferta anterior: preenchida no portal');
    r2.unmount();

    await abrir();
    expect(document.querySelector('.alert--info')).toBeNull();
    expect(painel().textContent).not.toContain('Oferta anterior');
  });
});

describe('IndentEnviarModal - painel "O que o fornecedor vai ver"', () => {
  it('parceiro: cliente visivel com o nome; desmarcar a caixa passa para oculto; o porto digitado aparece', async () => {
    await abrir();
    expect(painel().querySelector('strong')?.textContent).toBe('O que o fornecedor vai ver');
    expect(Array.from(painel().querySelectorAll('li')).map((li) => li.textContent)).toEqual([
      'Nome do cliente: visível (Indústria Química Vale do Itajaí Ltda)',
      'Nome da SQ Química: visível, como emissora do pedido',
      'Porto de destino: Paranaguá',
      'Anexos: confira se os nomes dos arquivos não citam o cliente',
    ]);

    fireEvent.click(mostrarCliente());
    expect(painel().textContent).toContain('Nome do cliente: oculto');
    fireEvent.change(porto(), { target: { value: '  Santos ' } });
    expect(painel().textContent).toContain('Porto de destino: Santos');
    fireEvent.change(porto(), { target: { value: '' } });
    expect(painel().textContent).toContain('Porto de destino: —');
  });

  it('sem parceria: cliente oculto e a SQ aparece "(sem dizer que é a compradora)"', async () => {
    await abrir(contexto({}, SEM_PARCERIA));
    expect(painel().textContent).toContain('Nome do cliente: oculto');
    expect(painel().textContent).toContain('Nome da SQ Química: visível, como emissora do pedido (sem dizer que é a compradora)');
  });
});

describe('IndentEnviarModal - validacao no cliente (mensagens do backend, sem chamar a API, foco no 1o campo invalido)', () => {
  async function tentar(preparo: () => void, campo: () => HTMLElement, mensagemEsperada: string) {
    preparo();
    limparFoco();
    fireEvent.click(botaoEnviar());
    const alerta = await screen.findByText(mensagemEsperada);
    expect(alerta.getAttribute('role')).toBe('alert');
    expect(alerta.className).toContain('field-error');
    await waitFor(() => expect(document.activeElement).toBe(campo()));
    expect(campo().getAttribute('aria-invalid')).toBe('true');
    expect(campo().getAttribute('aria-describedby') ?? '').toContain(alerta.id);
    expect(api.post).not.toHaveBeenCalled();
  }

  it('nenhum destinatario: "Escolha ou digite ao menos um e-mail." e foco no campo extra', async () => {
    await abrir();
    await tentar(
      () => {
        for (const caixa of within(screen.getByRole('group', { name: 'Para' })).getAllByRole('checkbox').slice(0, 2)) fireEvent.click(caixa);
      },
      campoExtra,
      'Escolha ou digite ao menos um e-mail.',
    );
  });

  it('e-mail extra invalido: "E-mail inválido."', async () => {
    await abrir();
    await tentar(() => fireEvent.change(campoExtra(), { target: { value: 'sem-arroba' } }), campoExtra, 'E-mail inválido.');
  });

  it('mais de 5 destinatarios (5 marcados + 1 digitado): "Escolha no máximo 5 destinatários."', async () => {
    const cinco = Array.from({ length: 5 }, (_, i) => `u${i}@supplier.example`);
    await abrir(contexto({}, { contactEmails: cinco }));
    await tentar(() => fireEvent.change(campoExtra(), { target: { value: 'sexto@supplier.example' } }), campoExtra, 'Escolha no máximo 5 destinatários.');
  });

  it('porto vazio: "Informe o porto de destino."', async () => {
    await abrir();
    await tentar(() => fireEvent.change(porto(), { target: { value: '   ' } }), porto, 'Informe o porto de destino.');
  });

  it('arquivo que nao e PDF (tipo ou extensao): "Envie só arquivos PDF."', async () => {
    await abrir();
    await tentar(() => anexar(new File(['x'], 'foto.png', { type: 'image/png' })), arquivos, 'Envie só arquivos PDF.');
    fireEvent.change(arquivos(), { target: { files: [] } });
  });

  it('PDF com extensao trocada ou tipo trocado tambem e barrado', async () => {
    await abrir();
    anexar(new File(['%PDF-1.4'], 'laudo.txt', { type: 'application/pdf' }));
    fireEvent.click(botaoEnviar());
    expect(await screen.findByText('Envie só arquivos PDF.')).toBeTruthy();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('mais de 3 anexos: "Envie no máximo 3 anexos."', async () => {
    await abrir();
    await tentar(() => anexar(pdf('a.pdf'), pdf('b.pdf'), pdf('c.pdf'), pdf('d.pdf')), arquivos, 'Envie no máximo 3 anexos.');
  });

  it('soma acima de 10 MB: "Os anexos passam de 10 MB."', async () => {
    await abrir();
    const a = pdf('a.pdf');
    const b = pdf('b.pdf');
    Object.defineProperty(a, 'size', { value: 6 * 1024 * 1024 });
    Object.defineProperty(b, 'size', { value: 5 * 1024 * 1024 });
    await tentar(() => anexar(a, b), arquivos, 'Os anexos passam de 10 MB.');
  });

  it('sem parceria e com anexo sem a conferencia: "Confirme que conferiu que o arquivo não cita o cliente." e foco na caixa', async () => {
    await abrir(contexto({}, SEM_PARCERIA));
    await tentar(
      () => anexar(pdf('tds.pdf')),
      () => screen.getByRole('checkbox', { name: 'Conferi que os anexos não citam o cliente.' }),
      'Confirme que conferiu que o arquivo não cita o cliente.',
    );
  });

  it('com parceria nao existe a caixa de conferencia e o anexo segue sem confirmacao', async () => {
    await abrir();
    anexar(pdf('tds.pdf'));
    expect(screen.queryByRole('checkbox', { name: 'Conferi que os anexos não citam o cliente.' })).toBeNull();
    vi.mocked(api.post).mockResolvedValue(RESPOSTA_OK);
    fireEvent.click(botaoEnviar());
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(Object.keys(vi.mocked(api.post).mock.calls[0]?.[1] as Obj)).not.toContain('attachmentsConfirmed');
  });

  it('o erro some quando o campo e corrigido; mais de um erro: o foco vai para o 1o na ordem da tela (Para antes do porto)', async () => {
    await abrir(contexto({}, SEM_EMAIL));
    fireEvent.change(porto(), { target: { value: '' } });
    limparFoco();
    fireEvent.click(botaoEnviar());
    expect(await screen.findByText('Escolha ou digite ao menos um e-mail.')).toBeTruthy();
    expect(screen.getByText('Informe o porto de destino.')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(campoExtra()));

    fireEvent.change(campoExtra(), { target: { value: 'novo@supplier.example' } });
    expect(screen.queryByText('Escolha ou digite ao menos um e-mail.')).toBeNull();
    expect(campoExtra().getAttribute('aria-invalid')).toBeNull();
  });

  it('Enter no campo de e-mail ou no porto NAO envia (no mock nao ha formulario: o envio e sempre um clique)', async () => {
    await abrir();
    fireEvent.keyDown(campoExtra(), { key: 'Enter' });
    fireEvent.keyDown(porto(), { key: 'Enter' });
    expect(api.post).not.toHaveBeenCalled();
    // jsdom nao dispara o submit implicito do Enter; o que se prova e que o evento chega cancelado (o navegador nao submete)
    const evento = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    campoExtra().dispatchEvent(evento);
    expect(evento.defaultPrevented).toBe(true);
  });
});

describe('IndentEnviarModal - payload exato', () => {
  it('parceiro: marcados + extra normalizado, mensagem aparada, showClientName true, sem anexos e sem attachmentsConfirmed', async () => {
    vi.mocked(api.post).mockResolvedValue(RESPOSTA_OK);
    const { onEnviado } = await abrir();

    fireEvent.click(screen.getByRole('checkbox', { name: 'sales@supplier.example' }));
    fireEvent.change(campoExtra(), { target: { value: '  OUTRO@Supplier.Example ' } });
    fireEvent.change(mensagem(), { target: { value: '  Podem melhorar o preço do STPP?  ' } });
    fireEvent.click(botaoEnviar());

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(api.post).toHaveBeenCalledWith(URL_ENVIO, {
      recipients: ['wei@supplier.example', 'outro@supplier.example'],
      saveToSupplier: false,
      message: 'Podem melhorar o preço do STPP?',
      showClientName: true,
      destinationPort: 'Paranaguá',
    });
    expect(Object.keys(vi.mocked(api.post).mock.calls[0]?.[1] as Obj).sort()).toEqual(['destinationPort', 'message', 'recipients', 'saveToSupplier', 'showClientName']);
    await waitFor(() => expect(onEnviado).toHaveBeenCalledWith(RESPOSTA_OK, false));
  });

  it('parceiro com a caixa "Mostrar o nome" desmarcada envia showClientName false; mensagem vazia vira null', async () => {
    vi.mocked(api.post).mockResolvedValue(RESPOSTA_OK);
    await abrir();
    fireEvent.click(mostrarCliente());
    fireEvent.click(botaoEnviar());
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.post).mock.calls[0]?.[1]).toMatchObject({ showClientName: false, message: null });
  });

  it('sem parceria: anexo em base64 puro, attachmentsConfirmed true, saveToSupplier true so com e-mail NOVO digitado; showClientName sempre false', async () => {
    vi.mocked(api.post).mockResolvedValue({ results: [{ email: 'novo@supplier.example', status: 'sent' }], quote: {} });
    const { onEnviado } = await abrir(contexto({}, { ...SEM_PARCERIA, ...SEM_EMAIL }));

    fireEvent.change(campoExtra(), { target: { value: 'novo@supplier.example' } });
    fireEvent.click(salvar());
    anexar(pdf('tds.pdf', '%PDF-1.4 conteudo'));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Conferi que os anexos não citam o cliente.' }));
    fireEvent.change(mensagem(), { target: { value: 'Podem melhorar o preço?' } });
    fireEvent.click(botaoEnviar());

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(api.post).toHaveBeenCalledWith(URL_ENVIO, {
      recipients: ['novo@supplier.example'],
      saveToSupplier: true,
      message: 'Podem melhorar o preço?',
      showClientName: false,
      destinationPort: 'Paranaguá',
      attachments: [{ fileName: 'tds.pdf', contentBase64: btoa('%PDF-1.4 conteudo') }],
      attachmentsConfirmed: true,
    });
    await waitFor(() => expect(onEnviado).toHaveBeenCalledTimes(1));
    expect(onEnviado.mock.calls[0]?.[1]).toBe(true);
  });

  it('"Salvar no cadastro" marcada sem e-mail novo (extra vazio ou ja cadastrado) envia saveToSupplier false', async () => {
    vi.mocked(api.post).mockResolvedValue(RESPOSTA_OK);
    await abrir();
    fireEvent.click(salvar());
    fireEvent.click(botaoEnviar());
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.post).mock.calls[0]?.[1]).toMatchObject({ saveToSupplier: false });

    vi.mocked(api.post).mockClear();
    fireEvent.change(campoExtra(), { target: { value: 'WEI@supplier.example' } });
    fireEvent.click(botaoEnviar());
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.post).mock.calls[0]?.[1]).toMatchObject({ saveToSupplier: false, recipients: ['wei@supplier.example', 'sales@supplier.example'] });
  });

  it('anexos: lista com nome e tamanho, "Remover" tira o arquivo e devolve o foco ao campo; repetido (mesmo nome e tamanho) e ignorado', async () => {
    vi.mocked(api.post).mockResolvedValue(RESPOSTA_OK);
    await abrir();
    anexar(pdf('tds.pdf', '%PDF-1.4 a'), pdf('msds.pdf', '%PDF-1.4 bb'));
    anexar(pdf('tds.pdf', '%PDF-1.4 a'));
    const lista = document.querySelector('.indent-envio__anexos') as HTMLElement;
    expect(Array.from(lista.querySelectorAll('li')).map((li) => li.querySelector('span')?.textContent)).toEqual(['tds.pdf · 10 B', 'msds.pdf · 11 B']);

    const remover = screen.getByRole('button', { name: 'Remover anexo tds.pdf' });
    expect(remover.textContent).toBe('Remover');
    expect(remover.className).toContain('ghost-button--sm');
    limparFoco();
    fireEvent.click(remover);
    expect(Array.from(lista.querySelectorAll('li')).map((li) => li.querySelector('span')?.textContent)).toEqual(['msds.pdf · 11 B']);
    expect(document.activeElement).toBe(arquivos());

    fireEvent.click(botaoEnviar());
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect((vi.mocked(api.post).mock.calls[0]?.[1] as { attachments: unknown[] }).attachments).toHaveLength(1);
  });
});

describe('IndentEnviarModal - conferencia dos anexos (sem parceria) vale so para a lista conferida', () => {
  const conferi = () => screen.getByRole('checkbox', { name: 'Conferi que os anexos não citam o cliente.' }) as HTMLInputElement;
  const MSG = 'Confirme que conferiu que o arquivo não cita o cliente.';

  async function prepararConfirmado() {
    vi.mocked(api.post).mockResolvedValue({ results: [{ email: 'novo@supplier.example', status: 'sent' }], quote: {} });
    const tela = await abrir(contexto({}, { ...SEM_PARCERIA, ...SEM_EMAIL }));
    fireEvent.change(campoExtra(), { target: { value: 'novo@supplier.example' } });
    anexar(pdf('a.pdf', '%PDF-1.4 a'));
    fireEvent.click(conferi());
    expect(conferi().checked).toBe(true);
    expect(botaoEnviar().getAttribute('aria-disabled')).toBeNull();
    return tela;
  }

  it('adicionar OUTRO PDF desmarca a conferencia, bloqueia o Enviar (aria-disabled, sem POST) e so o POST apos reconferir leva attachmentsConfirmed e os anexos finais', async () => {
    await prepararConfirmado();

    anexar(pdf('cliente-vale.pdf', '%PDF-1.4 b'));

    expect(conferi().checked).toBe(false);
    expect(botaoEnviar().getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(botaoEnviar());
    expect((await screen.findByText(MSG)).className).toContain('field-error');
    await new Promise((resolver) => setTimeout(resolver, 50));
    expect(api.post).not.toHaveBeenCalled();

    fireEvent.click(conferi());
    expect(botaoEnviar().getAttribute('aria-disabled')).toBeNull();
    fireEvent.click(botaoEnviar());
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    const corpo = vi.mocked(api.post).mock.calls[0]?.[1] as { attachments: Array<{ fileName: string }>; attachmentsConfirmed: boolean };
    expect(corpo.attachmentsConfirmed).toBe(true);
    expect(corpo.attachments.map((anexo) => anexo.fileName)).toEqual(['a.pdf', 'cliente-vale.pdf']);
  });

  it('REMOVER um PDF tambem desmarca a conferencia e exige reconferir; o POST leva so o anexo restante', async () => {
    await prepararConfirmado();
    anexar(pdf('b.pdf', '%PDF-1.4 bb'));
    fireEvent.click(conferi());
    expect(conferi().checked).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Remover anexo a.pdf' }));

    expect(conferi().checked).toBe(false);
    expect(botaoEnviar().getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(botaoEnviar());
    expect(await screen.findByText(MSG)).toBeTruthy();
    await new Promise((resolver) => setTimeout(resolver, 50));
    expect(api.post).not.toHaveBeenCalled();

    fireEvent.click(conferi());
    fireEvent.click(botaoEnviar());
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    const corpo = vi.mocked(api.post).mock.calls[0]?.[1] as { attachments: Array<{ fileName: string }>; attachmentsConfirmed: boolean };
    expect(corpo.attachmentsConfirmed).toBe(true);
    expect(corpo.attachments.map((anexo) => anexo.fileName)).toEqual(['b.pdf']);
  });

  it('escolher de novo um arquivo JA na lista (repetido) nao desmarca a conferencia', async () => {
    await prepararConfirmado();
    anexar(pdf('a.pdf', '%PDF-1.4 a'));
    expect(conferi().checked).toBe(true);
  });
});

describe('IndentEnviarModal - guarda do duplo clique e botoes', () => {
  it('dois cliques seguidos em "Enviar" chamam a API UMA vez; o botao fica aria-busy e aria-disabled (nao disabled) e conserva o foco', async () => {
    vi.mocked(api.post).mockImplementation((() => new Promise(() => undefined)) as typeof api.post);
    await abrir();
    botaoEnviar().focus();

    fireEvent.click(botaoEnviar());
    fireEvent.click(botaoEnviar());
    fireEvent.click(botaoEnviar());

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(botaoEnviar().getAttribute('aria-busy')).toBe('true'));
    expect(botaoEnviar().getAttribute('aria-disabled')).toBe('true');
    expect((botaoEnviar() as HTMLButtonElement).disabled).toBe(false);
    expect(document.activeElement).toBe(botaoEnviar());
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it('com o envio em andamento Cancelar e o X nao fecham a janela (o e-mail sairia sem a tela saber)', async () => {
    vi.mocked(api.post).mockImplementation((() => new Promise(() => undefined)) as typeof api.post);
    const { onClose } = await abrir();
    fireEvent.click(botaoEnviar());
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Cancelar, X e Esc (cancel) chamam onClose quando nao ha envio em andamento', async () => {
    const { onClose } = await abrir();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});

describe('IndentEnviarModal - respostas do backend', () => {
  async function enviarComErro(erro: unknown, ctx: unknown = contexto()) {
    vi.mocked(api.post).mockRejectedValue(erro);
    const tela = await abrir(ctx);
    botaoEnviar().focus();
    fireEvent.click(botaoEnviar());
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    return tela;
  }

  it.each([
    ['recipients', 'E-mail inválido.', () => campoExtra()],
    ['saveToSupplier', 'O cadastro do fornecedor já tem 10 e-mails; desmarque "Salvar no cadastro".', () => campoExtra()],
    ['destinationPort', 'O porto de destino identifica o cliente. Informe só o porto.', () => porto()],
    ['message', 'A mensagem cita o cliente ou diz que a SQ é a compradora. Remova antes de enviar: este fornecedor não tem parceria firmada.', () => mensagem()],
    ['attachments', 'Envie só arquivos PDF.', () => arquivos()],
    ['showClientName', 'Este fornecedor não tem parceria firmada: o nome do cliente não pode ser exibido.', () => mostrarCliente()],
  ])('400 com path "%s": a mensagem do backend aparece NO CAMPO (nao no topo) e o foco vai para ele', async (caminho, texto, campo) => {
    await enviarComErro(new ApiError(400, { message: texto, path: caminho }));

    const erro = await screen.findByText(texto);
    expect(erro.getAttribute('role')).toBe('alert');
    expect(erro.className).toContain('field-error');
    expect(document.querySelector('form > .alert[role="alert"]')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(campo()));
    expect(campo().getAttribute('aria-invalid')).toBe('true');
  });

  it('400 com path attachmentsConfirmed aparece na caixa de conferencia (sem parceria + anexo)', async () => {
    vi.mocked(api.post).mockRejectedValue(new ApiError(400, { message: 'Confirme que conferiu que o arquivo não cita o cliente.', path: 'attachmentsConfirmed' }));
    await abrir(contexto({}, SEM_PARCERIA));
    anexar(pdf('tds.pdf'));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Conferi que os anexos não citam o cliente.' }));
    fireEvent.click(botaoEnviar());

    const erro = await screen.findByText('Confirme que conferiu que o arquivo não cita o cliente.');
    expect(erro.className).toContain('field-error');
    expect(screen.getByRole('checkbox', { name: 'Conferi que os anexos não citam o cliente.' }).getAttribute('aria-invalid')).toBe('true');
  });

  it('400 sem path vai para o alerta do topo', async () => {
    await enviarComErro(new ApiError(400, { message: 'Os dados enviados são inválidos.' }));
    const alerta = await screen.findByText('Os dados enviados são inválidos.');
    expect(alerta.getAttribute('role')).toBe('alert');
    expect(alerta.className).toContain('alert--error');
  });

  it('413: a mensagem do corpo aparece em Anexos', async () => {
    await enviarComErro(new ApiError(413, { message: 'Os anexos passam de 10 MB.' }));
    const erro = await screen.findByText('Os anexos passam de 10 MB.');
    expect(erro.className).toContain('field-error');
    expect(arquivos().getAttribute('aria-invalid')).toBe('true');
  });

  it('422 (sentinela): alerta de erro com o campo TRADUZIDO ("nome do item 1")', async () => {
    await enviarComErro(
      new ApiError(422, { message: 'O conteúdo do e-mail identifica o cliente (campo: items[0].name). Revise o item ou o porto antes de enviar.' }),
      contexto({}, SEM_PARCERIA),
    );
    const alerta = await screen.findByText('O conteúdo do e-mail identifica o cliente (campo: nome do item 1). Revise o item ou o porto antes de enviar.');
    expect(alerta.getAttribute('role')).toBe('alert');
    expect(alerta.className).toContain('alert--error');
    expect(screen.queryByText(/items\[0\]/)).toBeNull();
    // o foco vai para o alerta (tabIndex -1) e o envio pode ser tentado de novo (aria-disabled so durante o envio)
    expect(document.activeElement).toBe(alerta);
    expect(botaoEnviar().getAttribute('aria-disabled')).toBeNull();
  });

  it('409: alerta ambar, "Enviar" fica desabilitado (so Cancelar) e as cotacoes sao recarregadas', async () => {
    const { invalidar } = await enviarComErro(
      new ApiError(409, { message: 'Esta solicitação já tem uma cotação aceita (275/26 · Beta Corp).' }),
    );
    const alerta = await screen.findByText('Esta solicitação já tem uma cotação aceita (275/26 · Beta Corp).');
    expect(alerta.className).toContain('alert--warning');
    expect(botaoEnviar().getAttribute('aria-disabled')).toBe('true');
    expect(invalidar).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ['indent', 'quotes'] }));
    expect(invalidar).toHaveBeenCalledWith({ queryKey: ['indent', 'requests'] });

    vi.mocked(api.post).mockClear();
    fireEvent.click(botaoEnviar());
    fireEvent.click(botaoEnviar());
    // o mutationFn e assincrono (le os anexos antes do POST): espera um instante para a ausencia da chamada nao ser vacua
    await new Promise((resolver) => setTimeout(resolver, 50));
    expect(api.post).not.toHaveBeenCalled();
  });

  it('502: alerta com a mensagem e a lista "e-mail: motivo" por destinatario, janela ABERTA, cotacoes recarregadas', async () => {
    const { invalidar, onClose, onEnviado } = await enviarComErro(
      new ApiError(502, {
        message: 'Nenhum e-mail foi enviado; a cotação voltou para rascunho.',
        results: [
          { email: 'wei@supplier.example', status: 'failed', error: 'caixa cheia' },
          { email: 'sales@supplier.example', status: 'suppressed', error: 'interno' },
        ],
      }),
    );
    const alerta = await screen.findByText(/Nenhum e-mail foi enviado; a cotação voltou para rascunho\./);
    expect(alerta.className).toContain('alert--error');
    expect(Array.from(alerta.querySelectorAll('li')).map((li) => li.textContent)).toEqual([
      'wei@supplier.example: caixa cheia',
      'sales@supplier.example: endereço interno bloqueado (não enviado)',
    ]);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    expect(onEnviado).not.toHaveBeenCalled();
    expect(invalidar).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ['indent', 'quotes'] }));
    expect(invalidar).toHaveBeenCalledWith({ queryKey: ['indent', 'requests'] });
    expect(botaoEnviar().getAttribute('aria-disabled')).toBeNull();
  });

  it('outro erro (rede/500): alerta de erro com a mensagem', async () => {
    await enviarComErro(new Error('Falha de rede'));
    const alerta = await screen.findByText('Falha de rede');
    expect(alerta.className).toContain('alert--error');
  });

  it('200: onEnviado recebe a resposta e salvouNoCadastro (true so quando o e-mail novo foi gravado)', async () => {
    vi.mocked(api.post).mockResolvedValue(RESPOSTA_OK);
    const { onEnviado } = await abrir();
    fireEvent.click(botaoEnviar());
    await waitFor(() => expect(onEnviado).toHaveBeenCalledWith(RESPOSTA_OK, false));
  });

  it('send-context 409: so o alerta com a mensagem do backend e o botao "Fechar" (nada de Enviar)', async () => {
    mockContexto(new ApiError(409, { message: 'Esta solicitação já tem uma cotação aceita (270/26 · Beta Corp).' }));
    const { onClose } = renderModal();

    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toBe('Esta solicitação já tem uma cotação aceita (270/26 · Beta Corp).');
    expect(alerta.className).toContain('alert--warning');
    expect(Array.from(document.querySelectorAll('.modal-actions button')).map((b) => b.textContent)).toEqual(['Fechar']);
    expect(screen.queryByRole('button', { name: 'Enviar' })).toBeNull();
    fireEvent.click(document.querySelector('.modal-actions button') as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// Correcoes do harness visual (D110, D112, D114, D117).
describe('IndentEnviarModal - alerta de erro visivel (D110)', () => {
  const rolagem = vi.fn();
  beforeEach(() => {
    rolagem.mockReset();
    Element.prototype.scrollIntoView = rolagem;
  });

  it.each([
    [422, { message: 'O conteúdo do e-mail identifica o cliente (campo: subject). Revise o item ou o porto antes de enviar.' }],
    [409, { message: 'Esta solicitação já tem uma cotação aceita (275/26 · Beta Corp).' }],
    [502, { message: 'Nenhum e-mail foi enviado; a cotação voltou para rascunho.', results: [{ email: 'wei@supplier.example', status: 'failed', error: 'timeout' }] }],
  ])('%i: o alerta rola para a vista (block nearest) e RECEBE o foco (tabIndex -1, role alert)', async (status, corpo) => {
    vi.mocked(api.post).mockRejectedValue(new ApiError(status, corpo));
    await abrir();
    botaoEnviar().focus();
    limparFoco();
    fireEvent.click(botaoEnviar());

    const alerta = (await screen.findByText(new RegExp(corpo.message.slice(0, 20)))).closest('[role="alert"]') as HTMLElement;
    expect(alerta.getAttribute('tabindex')).toBe('-1');
    await waitFor(() => expect(document.activeElement).toBe(alerta));
    expect(rolagem).toHaveBeenCalledWith({ block: 'nearest' });
    expect(rolagem.mock.contexts[0]).toBe(alerta);
  });

  it('sem erro nao ha alerta nem rolagem', async () => {
    await abrir();
    expect(document.querySelector('form > [role="alert"]')).toBeNull();
    expect(rolagem).not.toHaveBeenCalled();
  });
});

describe('IndentEnviarModal - campo de arquivo do IQ (D112)', () => {
  it('o input de anexos usa .file-input (nao .input, que mostraria o botao nativo)', async () => {
    await abrir();
    expect(arquivos().className).toBe('file-input');
  });
});

describe('IndentEnviarModal - send-context 409 recarrega a cotacao (D114)', () => {
  it('invalida quotes (SEM o send-context) e requests, e o send-context nao e pedido de novo', async () => {
    mockContexto(new ApiError(409, { message: 'Esta solicitação já tem uma cotação aceita (270/26 · Beta Corp).' }));
    const { invalidar } = renderModal();
    await screen.findByText('Esta solicitação já tem uma cotação aceita (270/26 · Beta Corp).');
    await new Promise((resolver) => setTimeout(resolver, 60));

    const chamadas = invalidar.mock.calls.map((c) => c[0] as { queryKey: unknown[]; predicate?: (q: { queryKey: unknown[] }) => boolean });
    const quotes = chamadas.find((c) => c.queryKey[1] === 'quotes');
    expect(quotes).toBeDefined();
    expect(quotes?.predicate?.({ queryKey: ['indent', 'quotes', 100, 'send-context'] })).toBe(false);
    expect(quotes?.predicate?.({ queryKey: ['indent', 'quotes', 100] })).toBe(true);
    expect(chamadas.some((c) => c.queryKey[1] === 'requests')).toBe(true);
    expect(vi.mocked(api.get).mock.calls.filter((c) => c[0] === URL_CONTEXTO)).toHaveLength(1);
  });

  it('outro erro do send-context (500) nao invalida nada', async () => {
    mockContexto(new ApiError(500, { message: 'Erro interno.' }));
    const { invalidar } = renderModal();
    await screen.findByText('Erro interno.');
    await new Promise((resolver) => setTimeout(resolver, 60));
    expect(invalidar).not.toHaveBeenCalled();
  });
});

describe('IndentEnviarModal - cadastro com mais de 5 e-mails (D117)', () => {
  const dez = Array.from({ length: 10 }, (_, i) => `u${i}@supplier.example`);
  const caixa = (email: string) => screen.getByRole('checkbox', { name: email }) as HTMLInputElement;

  it('abre com so os 5 PRIMEIROS marcados; os demais desmarcados e desabilitados enquanto houver 5 marcados, com a dica', async () => {
    await abrir(contexto({}, { contactEmails: dez }));
    expect(dez.map((e) => caixa(e).checked)).toEqual([true, true, true, true, true, false, false, false, false, false]);
    expect(dez.slice(5).every((e) => caixa(e).disabled)).toBe(true);
    expect(dez.slice(0, 5).every((e) => !caixa(e).disabled)).toBe(true);
    expect(screen.getByText('O cadastro tem 10 e-mails: marque até 5 destinatários.')).toBeTruthy();
  });

  it('desmarcar um libera os demais; marcar o 6o respeita o limite; o POST leva exatamente os marcados', async () => {
    vi.mocked(api.post).mockResolvedValue(RESPOSTA_OK);
    await abrir(contexto({}, { contactEmails: dez }));
    fireEvent.click(caixa('u0@supplier.example'));
    expect(caixa('u7@supplier.example').disabled).toBe(false);
    fireEvent.click(caixa('u7@supplier.example'));
    expect(caixa('u7@supplier.example').checked).toBe(true);
    expect(caixa('u8@supplier.example').disabled).toBe(true);
    fireEvent.click(botaoEnviar());

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect((vi.mocked(api.post).mock.calls[0]?.[1] as { recipients: string[] }).recipients).toEqual([
      'u1@supplier.example',
      'u2@supplier.example',
      'u3@supplier.example',
      'u4@supplier.example',
      'u7@supplier.example',
    ]);
  });

  it('com 5 ou menos e-mails nao ha dica e nada fica desabilitado', async () => {
    await abrir(contexto({}, { contactEmails: dez.slice(0, 5) }));
    expect(screen.queryByText(/marque até 5 destinatários/)).toBeNull();
    expect(dez.slice(0, 5).every((e) => !caixa(e).disabled && caixa(e).checked)).toBe(true);
  });
});
