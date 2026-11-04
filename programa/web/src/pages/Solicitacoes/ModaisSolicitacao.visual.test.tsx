import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Solicitacoes from '../Solicitacoes';
import { AnexosLista, AnexosReenvioPainel, validateSelectedFiles } from './AnexosTecnicos';

// F9 (Suite COMEX): marcacao dos modais das Solicitacoes (Vincular a cotacao, Recusar, Marcar atendida, Vincular ao catalogo, Solicitar uma cotacao,
// Anexar, painel de reenvio e a lista de anexos): wrappers sem estilo inline, selecao com aria-pressed e icone, busca, fieldset do item, campo de arquivos
// com o input ainda rotulado, erros com role=alert. Os textos e os IDs `cr-*` sao os de antes da fase.

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

// Dados 100% sinteticos.
const ATTACHMENTS = [
  { id: 3, kind: 'TDS', fileName: 'tds.pdf', mimeType: 'application/pdf', fileSize: 2048, createdAt: '2026-10-18T12:00:00.000Z' },
  { id: 4, kind: 'MSDS', fileName: 'msds.pdf', mimeType: 'application/pdf', fileSize: 1048576, createdAt: '2026-10-18T12:00:00.000Z' },
];

const ITEM_COMEX = {
  id: 1,
  catalogItemId: 10,
  commercialName: 'Resina X',
  isNewItem: false,
  notes: null,
  proposedName: null,
  marketName: 'RX-100',
  dbcorpCode: 'DB-77',
  quantity: 5,
  unit: 'KG',
  targetPrice: '10.50',
  targetCurrency: 'USD',
  quoteRequestItemId: null,
};

function comexRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 9,
    status: 'pending',
    customerName: 'Beta SA',
    notes: null,
    rejectionReason: null,
    fulfillmentNote: null,
    createdAt: '2026-10-18T12:00:00.000Z',
    statusChangedAt: null,
    isDevelopment: false,
    attachments: [],
    requestedBy: { id: 3, name: 'Ana Comercial', email: 'ana@x.com' },
    statusChangedBy: null,
    quoteRequest: null,
    items: [ITEM_COMEX],
    ...overrides,
  };
}

function mineRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    status: 'pending',
    customerName: null,
    notes: null,
    rejectionReason: null,
    fulfillmentNote: null,
    createdAt: '2026-10-18T12:00:00.000Z',
    statusChangedAt: null,
    isDevelopment: true,
    attachments: [ATTACHMENTS[0]],
    quote: null,
    items: [
      { id: 71, catalogItemId: null, commercialName: 'Aditivo Novo', isNewItem: true, notes: null, quantity: 2, unit: 'KG', targetPrice: null, targetCurrency: null, finalPrice: null },
    ],
    ...overrides,
  };
}

function page<T>(data: T[]) {
  return { data, pagination: { page: 1, pageSize: 20, totalItems: data.length, totalPages: 1 } };
}

function mockApi(comex: unknown[] = [], mine: unknown[] = []) {
  vi.mocked(api.get).mockImplementation((async (path: string, params?: { search?: string }) => {
    if (path === '/api/v1/commercial-requests/mine') return page(mine);
    if (path === '/api/v1/commercial-requests') return page(comex);
    if (path === '/api/v1/commercial-requests/requesters') return [{ id: 3, name: 'Ana Comercial' }];
    if (path === '/api/v1/commercial-requests/catalog-items') {
      return params?.search?.includes('xantana') ? [] : [{ id: 10, commercialName: 'Resina X', familyName: 'Resinas' }];
    }
    if (path === '/api/v1/quote-requests') {
      return page([{ id: 77, requestCode: 'QR-OPEN-1', description: 'Cotacao de resinas', createdAt: '2026-10-01T00:00:00Z' }]);
    }
    return [];
  }) as typeof api.get);
}

function renderWith(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/solicitacoes']}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

function renderPage() {
  return renderWith(
    <Routes>
      <Route path="*" element={<Solicitacoes />} />
    </Routes>,
  );
}

function pdf(name: string, size = 2048): File {
  const file = new File(['x'], name, { type: 'application/pdf', lastModified: 1 });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset();
  vi.mocked(api.del).mockReset();
  mockApi();
});

const semEstiloInline = (raiz: Element) => expect(Array.from(raiz.querySelectorAll('[style]')).map((el) => el.outerHTML.slice(0, 80))).toEqual([]);
const comIcone = (el: Element | null) => expect(el?.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
const semGlifo = (texto: string | null | undefined) => expect(texto ?? '').not.toMatch(/[✓▸▾→]|^\s*\+\s/);

describe('F9: modais de acao do COMEX', () => {
  it('Vincular a cotacao: wrapper .solicitacao-modal (fora e dentro), busca com icone, selecao com aria-pressed + check (sem " ✓"), dica com info, erro com role=alert', async () => {
    mockRole = 'comprador';
    mockApi([comexRow()]);
    const { container } = renderPage();
    await screen.findByText('Beta SA');
    fireEvent.click(screen.getByRole('button', { name: 'Vincular a cotação' }));
    const campo = await screen.findByLabelText('Buscar cotação aberta');
    const dialog = campo.closest('dialog') as HTMLElement;
    expect(dialog.parentElement?.classList.contains('solicitacao-modal')).toBe(true);
    const interno = campo.closest('.modal-body')?.firstElementChild as HTMLElement;
    expect(interno.classList.contains('solicitacao-modal')).toBe(true);
    expect(interno.classList.contains('solicitacao-modal--vincular')).toBe(true);
    comIcone(campo.closest('.solicitacao-busca__campo'));
    expect(dialog.querySelector('.solicitacao-modal__dica')?.textContent).toBe('Itens novos não entram nos links já enviados aos fornecedores.');
    comIcone(dialog.querySelector('.solicitacao-modal__dica'));

    fireEvent.change(campo, { target: { value: 'qr' } });
    const opcao = await screen.findByRole('button', { name: /QR-OPEN-1/ });
    expect(opcao.getAttribute('aria-pressed')).toBe('false');
    expect(opcao.className).toBe('solicitacao-cotacao');
    expect(within(dialog).getByRole('list', { name: 'Cotações abertas' })).toBeTruthy();
    fireEvent.click(opcao);
    expect(opcao.getAttribute('aria-pressed')).toBe('true');
    comIcone(opcao);
    expect(opcao.textContent).toBe('QR-OPEN-1 — Cotacao de resinas');
    semGlifo(opcao.textContent);
    expect(opcao.querySelector('.solicitacao-cotacao__codigo')?.textContent).toBe('QR-OPEN-1');

    vi.mocked(api.post).mockRejectedValue(new ApiError(409, { message: 'ja vinculada' }));
    const vincular = screen.getByRole('button', { name: 'Vincular' });
    comIcone(vincular);
    fireEvent.click(vincular);
    const alerta = await within(dialog).findByRole('alert');
    expect(alerta.className).toContain('alert--error');
    expect(alerta.textContent).toBe('ja vinculada');
    comIcone(alerta);
    expect(dialog.querySelector('.modal-actions')).not.toBeNull();
    semEstiloInline(container);
  });

  it('Recusar: campo .solicitacao-modal__campo (rotulo, textarea e dica), Confirmar recusa em perigo solido, IDs de antes', async () => {
    mockRole = 'admin';
    mockApi([comexRow()]);
    const { container } = renderPage();
    await screen.findByText('Beta SA');
    fireEvent.click(screen.getByRole('button', { name: 'Recusar' }));
    const motivo = (await screen.findByLabelText('Motivo da recusa *')) as HTMLTextAreaElement;
    expect(motivo.id).toBe('cr-reject-reason');
    expect(motivo.closest('.modal-body')?.firstElementChild?.classList.contains('solicitacao-modal')).toBe(true);
    expect(motivo.closest('.solicitacao-modal__campo')?.querySelector('.solicitacao-modal__nota')?.textContent).toBe('O solicitante verá este motivo.');
    const confirmar = screen.getByRole('button', { name: 'Confirmar recusa' });
    expect(confirmar.classList.contains('danger-button')).toBe(true);
    expect(confirmar.classList.contains('primary-button')).toBe(false);
    expect((confirmar as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(motivo, { target: { value: 'fora do escopo' } });
    expect((confirmar as HTMLButtonElement).disabled).toBe(false);
    vi.mocked(api.post).mockRejectedValue(new ApiError(500, { message: 'falhou' }));
    fireEvent.click(confirmar);
    const alerta = await screen.findByRole('alert');
    expect(alerta.classList.contains('alert--error')).toBe(true);
    comIcone(alerta);
    semEstiloInline(container);
  });

  it('Marcar atendida: "Atender sem preco" (so admin) na faixa de aviso, Motivo so quando marcado, Confirmar primario', async () => {
    mockRole = 'admin';
    mockApi([comexRow({ status: 'quoting', quoteRequest: { id: 4, requestCode: 'QR-2026-001', status: 'open' } })]);
    const { container } = renderPage();
    await screen.findByText('Beta SA');
    fireEvent.click(screen.getByRole('button', { name: 'Marcar atendida' }));
    const caixa = (await screen.findByLabelText('Atender sem preço')) as HTMLInputElement;
    const faixa = caixa.closest('label') as HTMLElement;
    expect(faixa.classList.contains('checkbox-field')).toBe(true);
    expect(faixa.classList.contains('solicitacao-modal__atender-sem-preco')).toBe(true);
    expect(screen.queryByLabelText('Motivo *')).toBeNull();
    fireEvent.click(caixa);
    const motivo = await screen.findByLabelText('Motivo *');
    expect(motivo.id).toBe('cr-fulfill-note');
    expect(motivo.closest('.solicitacao-modal__motivo')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Confirmar' }).classList.contains('primary-button')).toBe(true);
    semEstiloInline(container);
  });

  it('Marcar atendida para o comprador: sem "Atender sem preco"', async () => {
    mockRole = 'comprador';
    mockApi([comexRow({ status: 'quoting', quoteRequest: { id: 4, requestCode: 'QR-2026-001', status: 'open' } })]);
    renderPage();
    await screen.findByText('Beta SA');
    fireEvent.click(screen.getByRole('button', { name: 'Marcar atendida' }));
    await screen.findByRole('button', { name: 'Confirmar' });
    expect(screen.queryByLabelText('Atender sem preço')).toBeNull();
  });
});

describe('F9: Vincular ao catalogo', () => {
  async function abrir() {
    mockRole = 'admin';
    mockApi([
      comexRow({
        isDevelopment: true,
        items: [{ ...ITEM_COMEX, id: 8, catalogItemId: null, commercialName: 'Resina Nova', isNewItem: true, proposedName: 'Resina Nova', marketName: null, dbcorpCode: null }],
      }),
    ]);
    const utils = renderPage();
    await screen.findByText('Beta SA');
    fireEvent.click(screen.getByRole('button', { name: 'Ver itens' }));
    const botao = await screen.findByRole('button', { name: 'Vincular ao catálogo' });
    comIcone(botao);
    fireEvent.click(botao);
    await screen.findByRole('group', { name: 'Modo' });
    return utils;
  }

  it('.vincular-catalogo sem estilo inline, subtitulo no cabecalho, segmentado role=group com aria-pressed de hoje e wrapper de fora com .solicitacao-modal', async () => {
    const { container } = await abrir();
    const modo = screen.getByRole('group', { name: 'Modo' });
    expect(modo.className).toBe('vincular-catalogo__modo');
    expect(modo.closest('.vincular-catalogo')).not.toBeNull();
    expect(modo.closest('dialog')?.parentElement?.classList.contains('solicitacao-modal')).toBe(true);
    expect(modo.closest('.modal-content')?.querySelector('.modal-subtitle')?.textContent).toBe(
      'Solicitação #9. O item precisa estar no catálogo antes de entrar em uma cotação.',
    );
    const [existente, cadastrar] = within(modo).getAllByRole('button');
    expect(existente?.textContent).toBe('Selecionar existente');
    expect(existente?.getAttribute('aria-pressed')).toBe('true');
    expect(cadastrar?.getAttribute('aria-pressed')).toBe('false');
    semEstiloInline(container);
  });

  it('Cadastrar e vincular: NCM invalido com aria-invalid e .field-error; erro do vinculo com role=alert + icone', async () => {
    const { container } = await abrir();
    fireEvent.click(screen.getByRole('button', { name: 'Cadastrar e vincular' }));
    const ncm = (await screen.findByLabelText('NCM (opcional)')) as HTMLInputElement;
    expect(ncm.getAttribute('aria-invalid')).toBeNull();
    fireEvent.change(ncm, { target: { value: '3906' } });
    expect(ncm.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('NCM inválido. Use 8 dígitos.').className).toContain('field-error');
    fireEvent.change(ncm, { target: { value: '39069090' } });
    fireEvent.change(screen.getByLabelText('Nome de mercado *'), { target: { value: 'Resina acrilica' } });
    vi.mocked(api.post).mockRejectedValue(new ApiError(500, { message: 'falhou' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Cadastrar e vincular' }).pop() as HTMLElement);
    const alerta = await screen.findByRole('alert');
    expect(alerta.classList.contains('alert--error')).toBe(true);
    comIcone(alerta);
    expect(container.querySelector('.vincular-catalogo__painel > .modal-actions')).not.toBeNull();
    semEstiloInline(container);
  });
});

describe('F9: Solicitar uma cotacao', () => {
  async function abrir() {
    mockRole = 'comercial';
    mockApi([], [mineRow({ id: 5, isDevelopment: false, attachments: [] })]);
    const utils = renderPage();
    await screen.findByText('Pendente', { selector: 'span.badge' });
    fireEvent.click(screen.getByRole('button', { name: 'Solicitar uma cotação' }));
    await screen.findByLabelText('Buscar item');
    return utils;
  }

  it('busca com icone, resultado com plus, item em fieldset.solicitacao-item (legenda nome · familia), "Adicionado" com check e ids cr-* de antes', async () => {
    const { container } = await abrir();
    expect(screen.getByLabelText('Cliente (opcional)').id).toBe('cr-customer');
    expect(screen.getByLabelText('Observações').id).toBe('cr-notes');
    expect(screen.getByLabelText('Buscar item').id).toBe('cr-search');
    comIcone(screen.getByLabelText('Buscar item').closest('.solicitacao-busca__campo'));
    expect(container.querySelector('form.solicitacao-form')).not.toBeNull();
    expect(container.querySelector('h3.solicitacao-form__titulo')?.textContent).toBe('Itens da solicitação');
    expect(container.querySelector('.solicitacao-form__vazio')?.textContent).toBe('Nenhum item adicionado. Busque abaixo e clique no item para incluí-lo.');

    fireEvent.change(screen.getByLabelText('Buscar item'), { target: { value: 're' } });
    const resultado = await screen.findByRole('button', { name: 'Resina X · Resinas' });
    expect(resultado.className).toBe('solicitacao-busca__resultado');
    comIcone(resultado);
    semGlifo(resultado.textContent);
    expect(resultado.textContent).toBe('Resina X · Resinas');
    fireEvent.click(resultado);

    const fieldset = container.querySelector('fieldset.solicitacao-item') as HTMLElement;
    expect(fieldset.querySelector('legend')?.textContent).toBe('Resina X · Resinas');
    const qtd = within(fieldset).getByLabelText('Quantidade *') as HTMLInputElement;
    expect(qtd.id).toMatch(/^cr-qty-c:/);
    expect(qtd.classList.contains('solicitacao-item__numero')).toBe(true);
    expect(within(fieldset).getByLabelText('Preço-alvo').id).toMatch(/^cr-price-/);
    expect(within(fieldset).getByLabelText('Unidade').id).toMatch(/^cr-unit-/);
    expect(within(fieldset).getByLabelText('Moeda').id).toMatch(/^cr-cur-/);
    const remover = within(fieldset).getByRole('button', { name: 'Remover item' });
    comIcone(remover);
    expect(remover.classList.contains('danger-button')).toBe(true);
    expect(remover.closest('.solicitacao-item__grade')).not.toBeNull();

    const outro = screen.getByRole('button', { name: 'Adicionar outro item' });
    expect(outro.id).toBe('cr-add-more');
    comIcone(outro);
    fireEvent.click(outro);
    fireEvent.change(screen.getByLabelText('Buscar item'), { target: { value: 're' } });
    const adicionado = (await screen.findByRole('button', { name: /Resina X · Resinas\s+Adicionado/ })) as HTMLButtonElement;
    expect(adicionado.disabled).toBe(true);
    expect(adicionado.querySelector('.sol-added')?.textContent).toBe('Adicionado');
    comIcone(adicionado.querySelector('.sol-added'));
    semGlifo(adicionado.textContent);
    semEstiloInline(container);
  });

  it('item novo: "Incluir ... como item novo" com plus, aviso .alert--info role=status com info, campo de arquivos com botao (upload), estado e lista', async () => {
    const { container } = await abrir();
    fireEvent.change(screen.getByLabelText('Buscar item'), { target: { value: 'xantana' } });
    const incluir = await screen.findByRole('button', { name: 'Incluir "xantana" como item novo' });
    expect(incluir.className).toBe('solicitacao-busca__incluir');
    comIcone(incluir);
    semGlifo(incluir.textContent);
    expect(screen.getByText('Nenhum item cadastrado com esse nome.')).toBeTruthy();
    fireEvent.click(incluir);

    const fieldset = container.querySelector('fieldset.solicitacao-item') as HTMLElement;
    expect(fieldset.querySelector('legend .badge--info')?.textContent).toBe('Item novo');
    expect(fieldset.querySelector('legend')?.textContent).toBe('xantana · Item novo');
    expect(within(fieldset).getByLabelText('Observação do item')).toBeTruthy();
    const aviso = screen.getByRole('status');
    expect(aviso.classList.contains('alert--info')).toBe(true);
    comIcone(aviso);
    expect(aviso.textContent).toBe('Item novo: esta solicitação será de desenvolvimento. O COMEX cadastra o item antes de cotar.');

    const input = screen.getByLabelText('Arquivos técnicos (opcional)') as HTMLInputElement;
    expect(input.type).toBe('file');
    expect(input.id).toBe('cr-attach-input');
    const campo = input.closest('.anexos-campo') as HTMLElement;
    const botao = campo.querySelector('label.anexos-campo__botao') as HTMLElement;
    expect(botao.getAttribute('for')).toBe('cr-attach-input');
    expect(botao.textContent).toBe('Escolher arquivos');
    comIcone(botao);
    expect(campo.querySelector('.anexos-campo__estado')?.textContent).toBe('Nenhum arquivo escolhido');
    expect(campo.querySelector('.anexos-campo__dica')?.textContent).toBe('TDS, MSDS ou outro. PDF, PNG ou JPEG, até 10 MB cada, no máximo 5.');

    fireEvent.change(input, { target: { files: [pdf('tds.pdf'), pdf('msds.pdf', 1048576)] } });
    expect(campo.querySelector('.anexos-campo__estado')?.textContent).toBe('2 arquivos selecionados');
    const lista = within(campo).getByRole('list', { name: 'Arquivos selecionados' });
    const arquivos = Array.from(lista.querySelectorAll('.anexos-campo__arquivo')) as HTMLElement[];
    expect(arquivos.map((a) => a.textContent)).toEqual(['tds.pdf · 2,0 KB', 'msds.pdf · 1,0 MB']);
    comIcone(arquivos[0] ?? null);
    expect(within(lista).getByLabelText('Tipo de tds.pdf')).toBeTruthy();
    expect(within(lista).getByRole('button', { name: 'Remover tds.pdf da seleção' }).textContent).toBe('Remover da seleção');
    semEstiloInline(container);
  });

  it('validacao dos anexos: erros em ul.anexos-campo__erros role=alert; erro de envio e item faltando em .alert--error + icone', async () => {
    const { container } = await abrir();
    fireEvent.change(screen.getByLabelText('Buscar item'), { target: { value: 'xantana' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Incluir "xantana" como item novo' }));
    const input = screen.getByLabelText('Arquivos técnicos (opcional)');
    fireEvent.change(input, { target: { files: [new File(['x'], 'laudo.docx', { type: 'application/msword', lastModified: 1 })] } });
    const erros = container.querySelector('ul.anexos-campo__erros') as HTMLElement;
    expect(erros.getAttribute('role')).toBe('alert');
    expect(erros.textContent).toBe('"laudo.docx": tipo não permitido. Envie PDF, PNG ou JPEG.');

    fireEvent.click(screen.getByRole('button', { name: 'Remover item' }));
    fireEvent.change(screen.getByLabelText('Buscar item'), { target: { value: 're' } });
    expect(container.querySelector('.anexos-campo')).toBeNull(); // sem item novo o campo some
    fireEvent.submit(container.querySelector('form.solicitacao-form') as HTMLFormElement);
    const alerta = await screen.findByText('Adicione ao menos um item.');
    expect(alerta.getAttribute('role')).toBe('alert');
    expect(alerta.classList.contains('alert--error')).toBe(true);
    comIcone(alerta);
    semEstiloInline(container);
  });

  it('Enviar em andamento: spinner da F3 (aria-hidden) e texto "Enviando…"; rodape em .modal-actions', async () => {
    const { container } = await abrir();
    fireEvent.change(screen.getByLabelText('Buscar item'), { target: { value: 're' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Resina X · Resinas' }));
    vi.mocked(api.post).mockImplementation((() => new Promise(() => undefined)) as typeof api.post);
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
    const enviando = await screen.findByRole('button', { name: 'Enviando…' });
    expect(enviando.querySelector('.btn-spinner[aria-hidden="true"]')).not.toBeNull();
    expect(enviando.textContent).toBe('Enviando…');
    expect(enviando.closest('.modal-actions')).not.toBeNull();
    semEstiloInline(container);
  });
});

describe('F9: Anexar, reenvio e lista de anexos', () => {
  it('Anexar: wrapper .solicitacao-modal, contagem do board (D-F9-14), campo com upload e rodape em .modal-actions', async () => {
    mockRole = 'comercial';
    mockApi([], [mineRow()]);
    const { container } = renderPage();
    const anexar = await screen.findByRole('button', { name: 'Anexar arquivo à solicitação #7' });
    fireEvent.click(anexar);
    const input = (await screen.findByLabelText('Arquivos técnicos (opcional)')) as HTMLInputElement;
    expect(input.id).toBe('cr-attach-later-input');
    const dialog = input.closest('dialog') as HTMLElement;
    expect(dialog.querySelector('.modal-body')?.firstElementChild?.classList.contains('solicitacao-modal')).toBe(true);
    expect(dialog.querySelector('.anexos-anexar__contagem')?.textContent).toBe('Esta solicitação já tem 1 anexo. Cabem mais 4.');
    comIcone(dialog.querySelector('label.anexos-campo__botao'));
    expect(within(dialog).getByRole('button', { name: 'Enviar anexos' }).closest('.modal-actions')).not.toBeNull();
    semEstiloInline(container);
  });

  it('Anexar com 2 anexos: "já tem 2 anexos. Cabem mais 3."', async () => {
    mockRole = 'comercial';
    mockApi([], [mineRow({ attachments: ATTACHMENTS })]);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Anexar arquivo à solicitação #7' }));
    const contagem = await waitFor(() => {
      const el = document.querySelector('.anexos-anexar__contagem');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(contagem.textContent).toBe('Esta solicitação já tem 2 anexos. Cabem mais 3.');
  });

  it('painel de reenvio: .anexos-reenvio, erro .alert--error role=alert + icone, "restantes" e rodape Fechar / Tentar de novo', () => {
    const { accepted } = validateSelectedFiles([pdf('msds.pdf'), pdf('ficha.pdf')], 1);
    const { container } = renderWith(
      <AnexosReenvioPainel
        error={'Solicitação #318 criada, mas o anexo "x.pdf" não foi enviado: arquivo vazio. Reenvie pela lista.'}
        files={accepted}
        onChange={() => undefined}
        uploaded={1}
        busy={false}
        onRetry={() => undefined}
        onClose={() => undefined}
      />,
    );
    const painel = container.querySelector('div.anexos-reenvio') as HTMLElement;
    const alerta = within(painel).getByRole('alert', { name: '' }) as HTMLElement;
    expect(alerta.classList.contains('alert--error')).toBe(true);
    comIcone(alerta);
    expect(painel.querySelector('.anexos-campo__estado')?.textContent).toBe('2 arquivos restantes');
    expect(painel.querySelector('input[type="file"]')?.id).toBe('cr-attach-retry-input');
    expect(within(painel).getByRole('button', { name: 'Fechar' }).closest('.modal-actions')).not.toBeNull();
    expect(within(painel).getByRole('button', { name: 'Tentar de novo' }).classList.contains('primary-button')).toBe(true);
    semEstiloInline(container);
  });

  it('AnexosLista: ul.anexos-lista, selo do tipo badge--info, nome e tamanho em spans (textContent "nome · tamanho"), Baixar com download, confirmacao de remocao', () => {
    const { container } = renderWith(<AnexosLista requestId={7} attachments={ATTACHMENTS} canRemove />);
    const lista = container.querySelector('ul.anexos-lista') as HTMLElement;
    const itens = Array.from(lista.querySelectorAll('li.anexos-lista__item')) as HTMLElement[];
    expect(itens).toHaveLength(2);
    expect(itens.map((li) => li.querySelector('.anexos-lista__arquivo')?.textContent)).toEqual(['tds.pdf · 2,0 KB', 'msds.pdf · 1,0 MB']);
    expect(itens[0]?.querySelector('.anexos-lista__nome')?.textContent).toBe('tds.pdf');
    expect(itens[0]?.querySelector('.anexos-lista__tamanho')?.textContent).toBe('· 2,0 KB');
    const selo = itens[0]?.querySelector('.badge--info.anexos-lista__tipo') as HTMLElement;
    expect(selo.textContent).toBe('TDS');
    const baixar = within(itens[0] as HTMLElement).getByRole('button', { name: 'Baixar tds.pdf' });
    expect(baixar.textContent).toBe('Baixar');
    comIcone(baixar);
    fireEvent.click(within(itens[0] as HTMLElement).getByRole('button', { name: 'Remover tds.pdf' }));
    expect(within(itens[0] as HTMLElement).getByText('Remover este anexo?')).toBeTruthy();
    const confirmar = within(itens[0] as HTMLElement).getByRole('button', { name: 'Confirmar remoção' });
    expect(confirmar.classList.contains('danger-button')).toBe(true);
    expect(within(itens[0] as HTMLElement).getByRole('button', { name: 'Cancelar' })).toBeTruthy();
    semEstiloInline(container);
  });

  it('AnexosLista sem canRemove nao tem Remover; erro de download em .alert--error role=alert + icone', async () => {
    const { container } = renderWith(<AnexosLista requestId={7} attachments={[ATTACHMENTS[0] as (typeof ATTACHMENTS)[number]]} />);
    expect(screen.queryByRole('button', { name: /Remover/ })).toBeNull();
    vi.mocked(api.get).mockRejectedValue(new ApiError(404, { message: 'arquivo indisponivel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Baixar tds.pdf' }));
    const alerta = await screen.findByRole('alert');
    expect(alerta.classList.contains('alert--error')).toBe(true);
    comIcone(alerta);
    expect(alerta.textContent).toContain('Não foi possível baixar o anexo');
    semEstiloInline(container);
  });
});
