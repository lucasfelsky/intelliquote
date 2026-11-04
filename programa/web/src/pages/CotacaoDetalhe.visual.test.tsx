import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConfirmProvider } from '@/components/useConfirm';
import CotacaoDetalhe from './CotacaoDetalhe';

// F6 (Suite COMEX, mock v68: CotacaoResumo, EnvioFornecedores, EnvioPreview, EnvioResultado, LinksPortal): cabecalho, Resumo e os
// modais de envio e de links vestem as classes do mock, sem estilo inline e sem mudar texto, papel ou fluxo. Dados 100% ficticios.

const authState = vi.hoisted(() => ({ role: 'admin' }));

vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, name: 'Admin', email: 'a@b.c', role: authState.role } }),
}));

vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() },
  ApiError: class ApiError extends Error {},
}));

vi.mock('@/services/dispatch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/dispatch')>();
  return {
    ...actual,
    previewDispatch: vi.fn(),
    sendDispatch: vi.fn(),
    listPortalTokens: vi.fn(),
    generatePortalTokens: vi.fn(),
    revokePortalToken: vi.fn(),
    regeneratePortalToken: vi.fn(),
  };
});

import { api } from '@/api/client';
import {
  previewDispatch,
  sendDispatch,
  listPortalTokens,
  type DispatchPreviewResult,
  type DispatchSendResult,
  type PortalTokenListItem,
} from '@/services/dispatch';

const quote = {
  id: 1,
  requestCode: 'RFQ-001',
  productName: 'Produto X',
  quantity: 100,
  description: 'Descricao da cotacao',
  desiredIncoterm: ['FOB', 'CIF'],
  destinationPort: 'Santos',
  originPort: 'Shanghai',
  currency: 'USD',
  deadlineAt: '2026-10-31T12:00:00.000Z',
  status: 'open',
  createdAt: '2026-01-01T12:00:00.000Z',
  updatedAt: '2026-01-01T12:00:00.000Z',
  closedAt: null,
  createdById: 1,
  items: [
    {
      id: 10,
      quoteRequestId: 1,
      itemCode: null,
      productName: 'Produto X',
      description: null,
      quantity: 50,
      unit: 'KG',
      targetPrice: null,
      notes: null,
      desiredIncoterm: null,
      destinationPort: null,
      catalogItemId: 3,
      catalogItem: { id: 3, commercialName: 'Produto X', marketName: 'PX', familyId: 1 },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
  quoteResponses: [],
};

let quoteAtual: Record<string, unknown> = quote;

const getImpl = async (path: string): Promise<unknown> => {
  if (path.startsWith('/v1/quote-requests/')) return quoteAtual;
  if (path === '/api/v1/company-profile') return { dispatchCc: ['cc@exemplo.invalid'] };
  if (path === '/v1/suppliers') {
    return [{ id: 5, name: 'ACME Ltda', status: 'active', families: [{ id: 1, name: 'Monômero' }] }];
  }
  if (path === '/v1/supplier-contacts') {
    return {
      bySupplier: {
        '5': [
          { id: 10, name: 'Contato', email: 'c@acme.invalid', isPrimary: true },
          { id: 11, name: 'Copia', email: 'd@acme.invalid', isPrimary: false },
        ],
      },
    };
  }
  if (path === '/v1/item-families') return { data: [{ id: 1, name: 'Monômero', isActive: true }] };
  return [];
};

const previewFixture: DispatchPreviewResult = {
  recipientCount: 1,
  recipients: [
    {
      supplierContactId: 10,
      supplierId: 5,
      supplierName: 'ACME Ltda',
      contactName: 'Contato',
      contactEmail: 'c@acme.invalid',
      ccCount: 1,
      cc: [],
    },
  ],
  preview: { subject: 'Assunto teste', html: '<p>oi</p>', text: 'oi' },
  cc: [],
  companyCc: [],
};

const sendParcial: DispatchSendResult = {
  dispatchEventId: 1,
  status: 'partial',
  recipientsCount: 2,
  sentCount: 1,
  failedCount: 1,
  results: [
    { supplierContactId: 10, status: 'sent', dispatchEventId: 1 },
    { supplierContactId: 11, status: 'failed', dispatchEventId: 1, error: '550 falha ficticia' },
  ],
};

const umDia = 86_400_000;
const token = (id: number, over: Partial<PortalTokenListItem>): PortalTokenListItem => ({
  id,
  supplier: { id: 5, name: 'ACME Ltda' },
  contact: { id: 10, name: 'Contato', email: 'c@acme.invalid' },
  expiresAt: new Date(Date.now() + umDia).toISOString(),
  revokedAt: null,
  firstSeenAt: null,
  lastSeenAt: null,
  accessCount: 0,
  respondedAt: null,
  createdAt: new Date().toISOString(),
  ...over,
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/cotacoes/1']}>
        <ConfirmProvider>
          <Routes>
            <Route path="/cotacoes/:id" element={<CotacaoDetalhe />} />
          </Routes>
        </ConfirmProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function dialogByTitle(container: HTMLElement, title: string): HTMLDialogElement {
  const found = Array.from(container.querySelectorAll<HTMLDialogElement>('dialog')).find(
    (d) => d.querySelector('.modal-header h2')?.textContent === title,
  );
  if (!found) throw new Error(`dialog "${title}" não encontrado`);
  return found;
}

const semEstilo = (raiz: ParentNode) => Array.from(raiz.querySelectorAll('[style]')).map((el) => el.outerHTML.slice(0, 120));

beforeEach(() => {
  authState.role = 'admin';
  quoteAtual = quote;
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset();
  vi.mocked(api.get).mockImplementation(getImpl as unknown as typeof api.get);
  vi.mocked(previewDispatch).mockReset();
  vi.mocked(sendDispatch).mockReset();
  vi.mocked(listPortalTokens).mockReset();
  vi.mocked(previewDispatch).mockResolvedValue(previewFixture);
  vi.mocked(sendDispatch).mockResolvedValue(sendParcial);
  vi.mocked(listPortalTokens).mockResolvedValue([]);
});

describe('CotacaoDetalhe (F6): cabecalho e Resumo', () => {
  it('um unico h1 (o codigo), eyebrow "Cotação #id" e subtitulo logo depois; raiz com as classes da pagina', async () => {
    const { container, findByRole } = renderPage();
    await findByRole('heading', { name: 'RFQ-001' });
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    expect(container.querySelector('.page.cotacao-detalhe-page > .page-header .eyebrow')?.textContent).toBe('Cotação #1');
    expect(container.querySelector('.page-header h1 + p')?.textContent).toBe('Produto X');
  });

  it('selo do status com ponto: Aberta = success, Fechada = muted', async () => {
    const aberta = renderPage();
    await aberta.findByRole('heading', { name: 'RFQ-001' });
    const selo = within(aberta.container.querySelector('.page-header__actions') as HTMLElement).getByText('Aberta');
    expect(selo.className).toBe('badge badge--dot badge--success');
    aberta.unmount();

    quoteAtual = { ...quote, status: 'closed', closedAt: '2026-01-05T12:00:00.000Z' };
    const fechada = renderPage();
    await fechada.findByRole('heading', { name: 'RFQ-001' });
    const selo2 = within(fechada.container.querySelector('.page-header__actions') as HTMLElement).getByText('Fechada');
    expect(selo2.className).toBe('badge badge--dot badge--muted');
    expect(fechada.getByRole('button', { name: 'Reabrir' }).querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });

  it('botoes com icone decorativo e os nomes novos: Enviar cotação, Links do portal, Editar e Apagar (ghost-button danger-button)', async () => {
    const { container, findByRole } = renderPage();
    await findByRole('heading', { name: 'RFQ-001' });
    const acoes = within(container.querySelector('.page-header__actions') as HTMLElement);
    for (const nome of ['Enviar cotação', 'Links do portal', 'Editar', 'Apagar']) {
      expect(acoes.getByRole('button', { name: nome }).querySelector('svg[aria-hidden="true"]'), nome).not.toBeNull();
    }
    expect(acoes.getByRole('button', { name: 'Enviar cotação' }).className).toBe('primary-button');
    expect(acoes.getByRole('button', { name: 'Apagar' }).className).toBe('ghost-button danger-button');
    expect(acoes.getByRole('button', { name: 'Fechar cotação' }).querySelector('svg')).toBeNull();
  });

  it('erro de acao (fechar cotacao) em .alert--error com role=alert', async () => {
    vi.mocked(api.post).mockRejectedValue(new Error('Conflito ficticio'));
    const { container, findByRole, getByRole } = renderPage();
    await findByRole('heading', { name: 'RFQ-001' });
    fireEvent.click(getByRole('button', { name: 'Fechar cotação' }));
    const confirmacao = dialogByTitle(container, 'Confirmar ação');
    await waitFor(() => expect(confirmacao.open).toBe(true));
    fireEvent.click(within(confirmacao).getByRole('button', { name: 'Confirmar' }));
    const alerta = await findByRole('alert');
    expect(alerta.className).toBe('alert alert--error');
    expect(alerta.textContent).toBe('Conflito ficticio');
  });

  it('Resumo em dl com os 9 rotulos (dt.eyebrow) e os mesmos textos; o cartao da aba tem a classe do painel', async () => {
    const { container, findByRole } = renderPage();
    await findByRole('heading', { name: 'RFQ-001' });
    const dl = container.querySelector('dl.cotacao-resumo__grade') as HTMLElement;
    const rotulos = Array.from(dl.querySelectorAll('dt.eyebrow')).map((dt) => dt.textContent);
    expect(rotulos).toEqual([
      'Código',
      'Incoterms aceitáveis',
      'Porto de embarque',
      'Porto de destino',
      'Moeda',
      'Prazo',
      'Descrição',
      'Criada em',
      'Fechada em',
    ]);
    const valores = Array.from(dl.querySelectorAll('dd')).map((dd) => dd.textContent);
    expect(valores[0]).toBe('RFQ-001');
    expect(valores[1]).toBe('FOBCIF');
    expect(valores.slice(2, 5)).toEqual(['Shanghai', 'Santos', 'USD']);
    expect(valores[6]).toBe('Descricao da cotacao');
    expect(valores[8]).toBe('—');
    // so o painel da aba ativa existe no DOM: os 4 cartoes tem a classe no TSX (conferido no telaF6.test.ts)
    expect(container.querySelectorAll('section.card.cotacao-detalhe__painel')).toHaveLength(1);
    expect(container.querySelector('.cotacao-resumo > h2')?.textContent).toBe('Resumo');
  });

  it('5 dialogs no load e nenhum [style] na pagina nem nos modais', async () => {
    const { container, findByRole } = renderPage();
    await findByRole('heading', { name: 'RFQ-001' });
    expect(container.querySelectorAll('dialog')).toHaveLength(5);
    expect(semEstilo(container)).toEqual([]);
  });

  it('carregando e erro sem estilo inline: .empty-state, e o erro com role=alert e botao de nova tentativa', async () => {
    vi.mocked(api.get).mockImplementation((() => new Promise(() => undefined)) as unknown as typeof api.get);
    const carregando = renderPage();
    expect(carregando.getByText('Carregando…').closest('.empty-state')).not.toBeNull();
    expect(carregando.container.querySelector('.page.cotacao-detalhe-page')).not.toBeNull();
    expect(semEstilo(carregando.container)).toEqual([]);
    carregando.unmount();

    vi.mocked(api.get).mockImplementation((() => Promise.reject(new Error('falha ficticia'))) as unknown as typeof api.get);
    const erro = renderPage();
    const alerta = await erro.findByRole('alert');
    expect(alerta.className).toContain('empty-state--erro');
    expect(within(alerta).getByText('Não foi possível carregar a cotação.')).toBeTruthy();
    expect(within(alerta).getByRole('button', { name: 'Tentar novamente' })).toBeTruthy();
    expect(semEstilo(erro.container)).toEqual([]);
  });
});

describe('CotacaoDetalhe (F6): Enviar cotação (3 passos)', () => {
  it('subtitulo "código · produto" no cabecalho do modal e Stepper com o passo 1 atual', async () => {
    const { container, findByRole, getByRole } = renderPage();
    await findByRole('heading', { name: 'RFQ-001' });
    fireEvent.click(getByRole('button', { name: 'Enviar cotação' }));
    const dialog = dialogByTitle(container, 'Enviar cotação para fornecedores');
    expect(dialog.querySelector('.modal-subtitle')?.textContent).toBe('RFQ-001 · Produto X');
    const etapas = dialog.querySelector('.cotacao-envio section.stepper');
    expect(etapas?.getAttribute('aria-label')).toBe('Etapas do envio');
    expect(Array.from(etapas?.querySelectorAll('.stepper__passo') ?? []).map((li) => li.textContent)).toEqual([
      '1Fornecedores',
      '2Mensagem e preview',
      '3Resultado',
    ]);
    expect(etapas?.querySelector('[aria-current="step"]')?.textContent).toBe('1Fornecedores');
    await waitFor(() => expect(dialog.querySelector('.dispatcher-list')).not.toBeNull());
    expect(dialog.querySelector('.cotacao-envio__busca svg[aria-hidden="true"]')).not.toBeNull();
    expect(dialog.querySelector('.modal-body > .modal-actions:last-child')).not.toBeNull();
  });

  it('passo 2: Stepper em "Mensagem e preview", pilulas e rodape com Voltar e Enviar agora', async () => {
    const { container, findByRole, getByRole } = renderPage();
    await findByRole('heading', { name: 'RFQ-001' });
    fireEvent.click(getByRole('button', { name: 'Enviar cotação' }));
    const dialog = dialogByTitle(container, 'Enviar cotação para fornecedores');
    await waitFor(() => within(dialog).getByRole('checkbox'));
    fireEvent.click(within(dialog).getByRole('checkbox'));
    expect(dialog.querySelector('.recipient-summary__pill--total')?.textContent).toBe('1 destinatario(s) selecionado(s)');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continuar' }));
    await waitFor(() => within(dialog).getByLabelText('Assunto'));
    expect(dialog.querySelector('[aria-current="step"]')?.textContent).toBe('2Mensagem e preview');
    expect(dialog.querySelector('.stepper__passo--feito')?.textContent).toContain('Fornecedores');
    expect(dialog.querySelector('.recipient-summary__pill__hint')?.textContent).toBe('+1 em CC');
    expect(within(dialog).getByRole('button', { name: 'Voltar' }).querySelector('svg')).not.toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Enviar agora' }).querySelector('svg')).not.toBeNull();
    expect(dialog.querySelector('.preview-frame')).not.toBeNull();
  });

  it('passo 3: resultado parcial (faixa warning), selos success/danger por linha e nenhum [style] no modal', async () => {
    const { container, findByRole, getByRole } = renderPage();
    await findByRole('heading', { name: 'RFQ-001' });
    fireEvent.click(getByRole('button', { name: 'Enviar cotação' }));
    const dialog = dialogByTitle(container, 'Enviar cotação para fornecedores');
    await waitFor(() => within(dialog).getByRole('checkbox'));
    fireEvent.click(within(dialog).getByRole('checkbox'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continuar' }));
    await waitFor(() => within(dialog).getByLabelText('Assunto'));
    await waitFor(() => expect((within(dialog).getByRole('button', { name: 'Enviar agora' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Enviar agora' }));
    const confirmacao = dialogByTitle(container, 'Confirmar ação');
    await waitFor(() => expect(confirmacao.open).toBe(true));
    fireEvent.click(within(confirmacao).getByRole('button', { name: 'Confirmar' }));

    await waitFor(() => expect(dialog.querySelector('.cotacao-envio__resultado')).not.toBeNull());
    const faixa = dialog.querySelector('.cotacao-envio__resultado') as HTMLElement;
    expect(faixa.className).toContain('cotacao-envio__resultado--partial');
    expect(faixa.getAttribute('role')).toBe('status');
    expect(within(faixa).getByText('Parcial').className).toBe('badge badge--dot badge--warning');
    expect(dialog.querySelector('[aria-current="step"]')?.textContent).toBe('3Resultado');
    // numeros em negrito/mono (board EnvioResultado) sem mudar o texto lido: continua "1 enviado(s) · 1 falha(s)"
    const contagem = faixa.querySelector('.cotacao-envio__contagem') as HTMLElement;
    expect(contagem.textContent).toBe('1 enviado(s) · 1 falha(s)');
    expect(Array.from(contagem.querySelectorAll('.cotacao-envio__num')).map((n) => [n.textContent, n.className])).toEqual([
      ['1', 'cotacao-envio__num'],
      ['1', 'cotacao-envio__num cotacao-envio__num--falha'],
    ]);
    const selos = Array.from(dialog.querySelectorAll('.cotacao-envio__tabela tbody .badge'));
    expect(selos.map((s) => [s.textContent, s.className])).toEqual([
      ['Enviado', 'badge badge--dot badge--success'],
      ['Falhou', 'badge badge--dot badge--danger'],
    ]);
    expect(dialog.querySelector('.cotacao-envio__detalhe--falha')?.textContent).toBe('550 falha ficticia');
    expect(dialog.querySelector('.cotacao-envio__tabela')?.classList.contains('table-wrapper')).toBe(true);
    expect(within(dialog).getByRole('button', { name: 'Gerenciar links' }).querySelector('svg')).not.toBeNull();
    expect(semEstilo(dialog)).toEqual([]);
  });

  it('passo 3: com 0 falha(s) o numero das falhas fica na cor do texto (sem a modificadora --falha; desvio do board)', async () => {
    vi.mocked(sendDispatch).mockResolvedValue({
      dispatchEventId: 2,
      status: 'completed',
      recipientsCount: 1,
      sentCount: 1,
      failedCount: 0,
      results: [{ supplierContactId: 10, status: 'sent', dispatchEventId: 2 }],
    });
    const { container, findByRole, getByRole } = renderPage();
    await findByRole('heading', { name: 'RFQ-001' });
    fireEvent.click(getByRole('button', { name: 'Enviar cotação' }));
    const dialog = dialogByTitle(container, 'Enviar cotação para fornecedores');
    await waitFor(() => within(dialog).getByRole('checkbox'));
    fireEvent.click(within(dialog).getByRole('checkbox'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continuar' }));
    await waitFor(() => within(dialog).getByLabelText('Assunto'));
    await waitFor(() => expect((within(dialog).getByRole('button', { name: 'Enviar agora' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Enviar agora' }));
    const confirmacao = dialogByTitle(container, 'Confirmar ação');
    await waitFor(() => expect(confirmacao.open).toBe(true));
    fireEvent.click(within(confirmacao).getByRole('button', { name: 'Confirmar' }));

    await waitFor(() => expect(dialog.querySelector('.cotacao-envio__resultado')).not.toBeNull());
    const contagem = dialog.querySelector('.cotacao-envio__contagem') as HTMLElement;
    expect(contagem.textContent).toBe('1 enviado(s) · 0 falha(s)');
    expect(Array.from(contagem.querySelectorAll('.cotacao-envio__num')).map((n) => [n.textContent, n.className])).toEqual([
      ['1', 'cotacao-envio__num'],
      ['0', 'cotacao-envio__num'],
    ]);
  });
});

describe('CotacaoDetalhe (F6): Links do portal', () => {
  it('selos por status (Respondido success, Expirado warning, Pendente muted), contato em 2 linhas e acoes em .cotacao-links__acoes', async () => {
    vi.mocked(listPortalTokens).mockResolvedValue([
      token(1, { respondedAt: new Date().toISOString() }),
      token(2, { expiresAt: new Date(Date.now() - umDia).toISOString() }),
      token(3, {}),
    ]);
    const { container, findByRole, getByRole } = renderPage();
    await findByRole('heading', { name: 'RFQ-001' });
    fireEvent.click(getByRole('button', { name: 'Links do portal' }));
    const dialog = dialogByTitle(container, 'Links do portal');
    await waitFor(() => expect(dialog.querySelector('.cotacao-links__tabela')).not.toBeNull());
    const selos = Array.from(dialog.querySelectorAll('tbody .badge')).map((s) => [s.textContent, s.className]);
    expect(selos).toEqual([
      ['Respondido', 'badge badge--success badge--dot'],
      ['Expirado', 'badge badge--warning badge--dot'],
      ['Pendente', 'badge badge--muted badge--dot'],
    ]);
    expect(dialog.querySelector('.cotacao-links__contato-nome')?.textContent).toBe('Contato');
    expect(dialog.querySelector('.cotacao-links__contato-email')?.textContent).toBe('c@acme.invalid');
    expect(dialog.querySelectorAll('.cotacao-links__acoes')).toHaveLength(3);
    expect(within(dialog).getAllByRole('button', { name: 'Revogar' })[0]?.className).toBe('ghost-button danger-button');
    expect(within(dialog).getByRole('button', { name: 'Gerar para todos os fornecedores' }).querySelector('svg')).not.toBeNull();
    expect(dialog.querySelector('.modal-body > .modal-actions:last-child')).not.toBeNull();
    expect(semEstilo(dialog)).toEqual([]);
  });

  it('vazio com icone, titulo e texto; carregando com spinner; sem [style]', async () => {
    const { container, findByRole, getByRole } = renderPage();
    await findByRole('heading', { name: 'RFQ-001' });
    fireEvent.click(getByRole('button', { name: 'Links do portal' }));
    const dialog = dialogByTitle(container, 'Links do portal');
    await waitFor(() => expect(dialog.querySelector('.empty-state')).not.toBeNull());
    expect(dialog.querySelector('.empty-state__icon svg[aria-hidden="true"]')).not.toBeNull();
    expect(dialog.querySelector('.empty-state__title')?.textContent).toBe('Nenhum link ativo');
    expect(dialog.querySelector('.empty-state__text')?.textContent).toContain('Gere links para que os fornecedores');
    expect(semEstilo(dialog)).toEqual([]);
  });
});

describe('CotacaoDetalhe (F6): Novo item e Editar cotação', () => {
  it('fieldset "Incoterm e destino" com as classes cotacao-item-form__*; #itemPort e #qrCurrency seguem; nenhum [style]', async () => {
    const { container, findByRole, getByRole } = renderPage();
    await findByRole('heading', { name: 'RFQ-001' });
    fireEvent.click(getByRole('tab', { name: 'Itens' }));
    fireEvent.click(getByRole('button', { name: 'Adicionar item' }));
    const novo = dialogByTitle(container, 'Novo item');
    const escopo = novo.querySelector('fieldset.cotacao-item-form__escopo');
    expect(escopo?.querySelector('legend')?.textContent).toBe('Incoterm e destino');
    expect(escopo?.querySelectorAll('label.cotacao-item-form__opcao')).toHaveLength(2);
    expect(escopo?.querySelector('.cotacao-item-form__incoterms')?.textContent).toBe('FOB / CIF');
    fireEvent.click(within(novo).getByLabelText('Usar o porto da cotação (Santos)'));
    expect(novo.querySelector('#itemPort')).not.toBeNull();
    expect(novo.querySelector('form > .modal-actions:last-child')).not.toBeNull();
    expect(semEstilo(novo)).toEqual([]);

    fireEvent.click(within(container.querySelector('.page-header__actions') as HTMLElement).getByRole('button', { name: 'Editar' }));
    const edicao = dialogByTitle(container, 'Editar cotação');
    expect(edicao.querySelector('#qrCurrency')).not.toBeNull();
    expect(edicao.querySelector('.cotacao-detalhe__edicao #qrDeadline')).not.toBeNull();
    expect(semEstilo(edicao)).toEqual([]);
  });
});
