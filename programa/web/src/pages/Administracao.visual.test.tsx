import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConfirmProvider } from '@/components/useConfirm';
import { FAQ_BY_CATEGORY } from '@/services/help';
import Usuarios from './Usuarios';
import Empresa from './Empresa';
import Auditoria from './Auditoria';
import Templates from './Templates';
import MinhaConta from './MinhaConta';
import Ajuda from './Ajuda';

// F11 (Suite COMEX, boards Usuarios, Empresa, Auditoria, Templates, MinhaConta e ModaisAdmin): markup, texto e ARIA das telas de Administracao.
// O CSS e conferido por telaF11.test.ts e pelo harness; as regras de negocio seguem nos testes de cada tela.

let mockRole = 'admin';
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, name: 'Maria', email: 'maria@exemplo.invalid', role: mockRole } }),
}));

vi.mock('@/api/client', () => {
  class ApiError extends Error {
    status = 0;
    body: unknown = null;
  }
  return { api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() }, ApiError };
});

vi.mock('@/services/audit', () => ({ listAuditLogs: vi.fn(), messageOf: (e: unknown) => String((e as Error).message) }));

vi.mock('@/services/emailTemplates', () => ({
  listEmailTemplates: vi.fn(),
  previewEmailTemplate: vi.fn(),
  saveEmailTemplate: vi.fn(),
  resetEmailTemplate: vi.fn(),
  messageOf: (e: unknown) => String((e as Error).message),
}));

// O Jodit tem DOM proprio e nao carrega no jsdom: um campo simples basta para o markup da pagina.
vi.mock('jodit-react', () => ({
  default: () => <div className="jodit-container" data-testid="jodit" />,
}));

import { api } from '@/api/client';
import { listAuditLogs } from '@/services/audit';
import { listEmailTemplates, previewEmailTemplate } from '@/services/emailTemplates';

function renderPage(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ConfirmProvider>{ui}</ConfirmProvider>
    </QueryClientProvider>,
  );
}

const EMOJIS = /[✉✓✕⏰]|📦/;

beforeEach(() => {
  mockRole = 'admin';
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset();
  vi.mocked(api.put).mockReset();
});
afterEach(() => cleanup());

describe('F11: Usuarios', () => {
  const USERS = [
    { id: 1, name: 'Ana Vendas', email: 'ana@exemplo.invalid', role: 'comprador', isActive: true, createdAt: '2026-03-12T12:00:00Z', updatedAt: '2026-03-12T12:00:00Z' },
    { id: 2, name: 'Bruno Lima', email: 'bruno@exemplo.invalid', role: 'admin', isActive: false, createdAt: '2026-03-12T12:00:00Z', updatedAt: '2026-03-12T12:00:00Z' },
  ];

  it('sem eyebrow "Administracao"; raiz .usuarios-page; "Novo usuario" com icone `plus` e nome sem "+"', async () => {
    vi.mocked(api.get).mockResolvedValue(USERS);
    const { container } = renderPage(<Usuarios />);
    await screen.findByText('Ana Vendas');
    expect(container.querySelector('div.page.usuarios-page')).toBeTruthy();
    expect(container.querySelector('p.eyebrow')).toBeNull();
    expect(container.textContent).not.toContain('Administração');
    const botao = screen.getByRole('button', { name: 'Novo usuário' });
    expect(botao.textContent).toBe('Novo usuário');
    expect(botao.querySelector('svg[aria-hidden="true"] path')?.getAttribute('d')).toBe('M12 5v14M5 12h14');
    expect(container.querySelector('.page-header__actions select')).toBeTruthy();
    expect(container.querySelectorAll('[style]')).toHaveLength(0);
  });

  it('edicao: e-mail desabilitado com cadeado decorativo e sem [style]; cadastro: sem cadeado', async () => {
    vi.mocked(api.get).mockResolvedValue(USERS);
    const { container } = renderPage(<Usuarios />);
    fireEvent.click(await screen.findByRole('button', { name: 'Editar Ana Vendas' }));
    const email = screen.getByLabelText('E-mail') as HTMLInputElement;
    expect(email.disabled).toBe(true);
    expect(container.querySelector('.usuario-campo__cadeado')?.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelector('.usuario-dica')?.textContent).toContain('só o perfil Comercial fica fixo');
    expect(container.querySelectorAll('[style]')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Novo usuário' }));
    expect(container.querySelector('.usuario-campo__cadeado')).toBeNull();
  });

  it('erro da senha: role=alert com icone e senha marcada como invalida', async () => {
    vi.mocked(api.get).mockResolvedValue(USERS);
    renderPage(<Usuarios />);
    fireEvent.click(await screen.findByRole('button', { name: 'Novo usuário' }));
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Carla' } });
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'carla@exemplo.invalid' } });
    // minLength do navegador nao entra no jsdom: o submit chega ao handler
    fireEvent.change(screen.getByLabelText('Senha inicial'), { target: { value: 'curta' } });
    fireEvent.submit(screen.getByLabelText('Senha inicial').closest('form') as HTMLFormElement);
    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toBe('A senha deve ter pelo menos 8 caracteres.');
    expect(alerta.querySelector('svg[aria-hidden="true"]')).toBeTruthy();
    expect(screen.getByLabelText('Senha inicial').getAttribute('aria-invalid')).toBe('true');
  });
});

describe('F11: Empresa e Parceiros de credito', () => {
  function mockEmpresa() {
    vi.mocked(api.get).mockImplementation((async (path: string) => {
      if (path.includes('company-profile')) {
        return { id: 1, companyName: 'SQ Quimica', dispatchCc: ['fin@exemplo.invalid'], commercialRequestNotifyEmails: ['gestor@exemplo.invalid'] };
      }
      if (path.includes('users-directory')) {
        return [
          { id: 1, name: 'Ana', email: 'ana@exemplo.invalid', role: 'admin', isActive: true },
          { id: 2, name: 'Bruno', email: 'bruno@exemplo.invalid', role: 'comprador', isActive: false },
        ];
      }
      if (path.includes('credit-partners')) {
        return [
          {
            id: 1,
            name: 'Banco Alfa',
            taxId: null,
            website: null,
            country: 'Brasil',
            notes: null,
            isActive: true,
            createdAt: '2026-10-07T12:00:00.000Z',
            updatedAt: '2026-10-07T12:00:00.000Z',
            contacts: [{ id: 10, name: 'Contato Alfa', email: 'alfa@exemplo.invalid', phone: null, position: null, isPrimary: true }],
          },
        ];
      }
      return [];
    }) as typeof api.get);
    vi.mocked(api.put).mockImplementation((async (_p: string, body: Record<string, unknown>) => ({ id: 1, ...body, dispatchCc: [] })) as typeof api.put);
  }

  it('.empresa-page sem eyebrow, caixa label.cc-mode-toggle, fieldset.cc-users e nenhum [style]', async () => {
    mockEmpresa();
    const { container } = renderPage(<Empresa />);
    await screen.findByRole('button', { name: 'Salvar perfil' });
    expect(container.querySelector('div.page.empresa-page')).toBeTruthy();
    expect(container.querySelector('p.eyebrow')).toBeNull();
    expect(container.textContent).not.toContain('Administração');
    expect(container.querySelector('label.cc-mode-toggle input[type="checkbox"]')).toBeTruthy();
    expect(container.querySelector('fieldset.cc-users legend')?.textContent).toMatch(/^Perfis do sistema \(/);
    expect(container.querySelector('h2.empresa-secao__eyebrow')?.textContent).toBe('Dados cadastrais');
    expect(container.querySelectorAll('[style]')).toHaveLength(0);
  });

  it('"Salvo as" com role=status e icone depois de salvar', async () => {
    mockEmpresa();
    renderPage(<Empresa />);
    fireEvent.click(await screen.findByRole('button', { name: 'Salvar perfil' }));
    const selo = await screen.findByText(/Salvo às/);
    expect(selo.getAttribute('role')).toBe('status');
    expect(selo.classList.contains('badge')).toBe(true);
    expect(selo.querySelector('svg[aria-hidden="true"]')).toBeTruthy();
  });

  it('viewer: aviso "Somente leitura" informativo (.alert sem tom)', async () => {
    mockRole = 'viewer';
    mockEmpresa();
    renderPage(<Empresa />);
    const aviso = await screen.findByText(/Somente leitura/);
    expect(aviso.classList.contains('alert')).toBe(true);
    expect(aviso.className).not.toMatch(/alert--/);
  });

  it('Parceiros: .parceiros-credito, nenhuma classe credit-support*, modal com fieldset "Contato 1"', async () => {
    mockEmpresa();
    const { container } = renderPage(<Empresa />);
    await screen.findByText('Banco Alfa');
    const secao = container.querySelector('section.card.parceiros-credito');
    expect(secao).toBeTruthy();
    const classes = Array.from(secao?.querySelectorAll('[class]') ?? []).flatMap((el) => Array.from(el.classList));
    expect(classes.filter((c) => /^(credit-support|forwarder-?|contact-)/.test(c))).toEqual([]);
    expect(screen.getByRole('button', { name: 'Novo parceiro' }).querySelector('svg[aria-hidden="true"]')).toBeTruthy();
    expect(secao?.querySelector('.badge.badge--info.parceiro-credito__padrao')?.textContent).toBe('Padrão');
    fireEvent.click(screen.getByRole('button', { name: 'Novo parceiro' }));
    const legenda = Array.from(container.querySelectorAll('dialog fieldset.parceiro-credito-contato legend')).map((l) => l.textContent?.trim());
    expect(legenda).toEqual(['Contato 1']);
    expect(container.querySelector('dialog.modal-dialog--wide')).toBeTruthy();
  });
});

describe('F11: Auditoria', () => {
  const LOG = {
    id: 1,
    entityType: 'quoteRequest',
    entityId: '132',
    action: 'update',
    performedById: 1,
    createdAt: '2026-10-20T17:31:00Z',
    before: { status: 'open' },
    after: { status: 'closed' },
    performedBy: { id: 1, name: 'Carlos', email: 'carlos@exemplo.invalid', role: { name: 'gestor' } },
  };

  it('sem eyebrow; filtros em form[aria-label]; "Ver diff" com details e `pre` Antes/Depois; nenhum [style]', async () => {
    vi.mocked(listAuditLogs).mockResolvedValue([LOG, { ...LOG, id: 2, before: null, after: null }]);
    const { container } = renderPage(<Auditoria />);
    await screen.findAllByText('Carlos');
    expect(container.querySelector('div.page.auditoria-page')).toBeTruthy();
    expect(container.querySelector('p.eyebrow')).toBeNull();
    expect(container.querySelector('form[aria-label="Filtros de auditoria"]')).toBeTruthy();
    expect(container.querySelectorAll('details.auditoria-diff')).toHaveLength(1);
    expect(container.querySelector('details.auditoria-diff summary')?.textContent).toBe('Ver diff');
    // o painel so existe com o diff aberto: linha irma (colspan) com <details open> para o harness
    expect(container.querySelector('.auditoria-diff-linha')).toBeNull();
    fireEvent.click(container.querySelector('details.auditoria-diff summary') as HTMLElement);
    expect(container.querySelector('details.auditoria-diff')?.hasAttribute('open')).toBe(true);
    expect(container.querySelector('tr.auditoria-linha--aberta')).toBeTruthy();
    expect(container.querySelector('tr.auditoria-diff-linha td')?.getAttribute('colspan')).toBe('5');
    expect(container.querySelector('tr.auditoria-diff-linha details[open] .auditoria-diff__grade')).toBeTruthy();
    const lados = Array.from(container.querySelectorAll('.auditoria-diff__lado')).map((l) => l.querySelector('strong')?.textContent);
    expect(lados).toEqual(['Antes', 'Depois']);
    expect(container.querySelectorAll('pre.auditoria-diff__json')).toHaveLength(2);
    expect(container.querySelector('.chip--static')?.textContent).toBe('2 resultados');
    expect(container.querySelectorAll('[style]')).toHaveLength(0);
  });

  it('vazio: titulo "Sem eventos" no padrao dos estados', async () => {
    vi.mocked(listAuditLogs).mockResolvedValue([]);
    const { container } = renderPage(<Auditoria />);
    expect(await screen.findByText('Sem eventos')).toBeTruthy();
    expect(container.querySelector('.empty-state .empty-state__icon svg[aria-hidden="true"]')).toBeTruthy();
  });
});

describe('F11: Templates', () => {
  const TEMPLATE = { id: 1, key: 'quote_dispatch', locale: 'en', subject: 'Assunto', htmlBody: '<p>x</p>', textBody: 'x', isActive: true, updatedAt: '2026-10-20T12:00:00Z', updatedById: 1 };

  beforeEach(() => {
    vi.mocked(listEmailTemplates).mockResolvedValue([TEMPLATE]);
    vi.mocked(previewEmailTemplate).mockResolvedValue({ subject: 'Assunto', html: '<p>previa</p>', text: 'x', isActive: true, source: 'database', locale: 'en' });
  });

  it('.templates-page com header.page-header, 7 cartoes com svg aria-hidden e nenhum emoji no texto', async () => {
    const { container } = renderPage(<Templates />);
    await screen.findByText('Personalizado');
    expect(container.querySelector('div.page.templates-page > header.page-header')).toBeTruthy();
    expect(container.querySelector('p.page-subtitle')).toBeTruthy();
    expect(container.querySelector('.page--templates, .page__header, .page__subtitle')).toBeNull();
    const cartoes = container.querySelectorAll('button.template-card');
    expect(cartoes).toHaveLength(7);
    cartoes.forEach((c) => expect(c.querySelector('svg[aria-hidden="true"]')).toBeTruthy());
    expect(cartoes[0]?.getAttribute('aria-pressed')).toBe('true');
    expect(container.textContent).not.toMatch(EMOJIS);
    expect(container.querySelectorAll('[style]')).toHaveLength(0);
  });

  it('"Personalizado" sem o glifo e com icone; variaveis em chips com `plus`; Jodit dentro de .templates-editor', async () => {
    const { container } = renderPage(<Templates />);
    const selo = await screen.findByText('Personalizado');
    expect(selo.closest('.template-source-badge')?.textContent).toBe('Personalizado');
    expect(selo.closest('.template-source-badge')?.querySelector('svg[aria-hidden="true"]')).toBeTruthy();
    expect(container.querySelectorAll('.templates-variaveis .chip svg[aria-hidden="true"]').length).toBeGreaterThan(5);
    expect(container.querySelector('.templates-editor .jodit-container')).toBeTruthy();
  });

  it('previa: iframe com sandbox="" nas duas visoes (inline e tela cheia, com aria-expanded)', async () => {
    const { container } = renderPage(<Templates />);
    await waitFor(() => expect(container.querySelector('.templates-previa__quadro iframe')).toBeTruthy());
    expect(container.querySelector('iframe[sandbox=""]')).toBeTruthy();
    const expandir = screen.getByRole('button', { name: 'Expandir' });
    expect(expandir.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(expandir);
    expect(screen.getByRole('button', { name: 'Expandir' }).getAttribute('aria-expanded')).toBe('true');
    const iframes = Array.from(container.querySelectorAll('iframe'));
    expect(iframes).toHaveLength(2);
    iframes.forEach((f) => expect(f.getAttribute('sandbox')).toBe(''));
    expect(container.querySelector('.preview-popout')).toBeTruthy();
  });

  it('perfil nao admin: aviso .alert--warning com role=status, sem Salvar nem Restaurar', async () => {
    mockRole = 'comprador';
    renderPage(<Templates />);
    const aviso = await screen.findByText(/Somente administradores/);
    expect(aviso.classList.contains('alert--warning')).toBe(true);
    expect(aviso.getAttribute('role')).toBe('status');
    expect(screen.queryByRole('button', { name: 'Salvar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Restaurar padrão' })).toBeNull();
  });
});

describe('F11: Minha conta', () => {
  it('previa em papel: div.paper-surface[data-testid=signature-preview] sem outra classe; "38,2 KB" com virgula; sem [style] fora dela', async () => {
    vi.mocked(api.get).mockResolvedValue({
      name: 'Maria',
      email: 'maria@exemplo.invalid',
      text: 'Att,\nMaria',
      image: { dataUri: 'data:image/png;base64,AAAA', mimeType: 'image/png', width: 420, height: 120, size: 39117 },
      fallbackSignature: 'Best regards,',
    });
    const { container } = renderPage(<MinhaConta />);
    const atual = await screen.findByText(/420×120 px · 38,2 KB/);
    expect(atual.textContent).toBe('420×120 px · 38,2 KB');
    expect(atual.closest('p')?.textContent).toBe('Imagem atual: 420×120 px · 38,2 KB');
    expect(container.querySelector('div.page.minha-conta-page')).toBeTruthy();
    const papel = container.querySelector('[data-testid="signature-preview"]');
    expect(papel?.className).toBe('paper-surface');
    expect(container.querySelectorAll('section.card.assinatura-cartao')).toHaveLength(3);
    const comStyle = Array.from(container.querySelectorAll('[style]'));
    expect(comStyle.every((el) => papel?.contains(el))).toBe(true);
    expect(container.querySelector('.assinatura-arquivo svg[aria-hidden="true"]')).toBeTruthy();
    expect(screen.getByLabelText('Substituir imagem')).toBeTruthy();
  });

  it('dica com 600×300 em mono e o texto do paragrafo identico ao de antes', async () => {
    vi.mocked(api.get).mockResolvedValue({ name: 'Maria', email: 'maria@exemplo.invalid', text: null, image: null, fallbackSignature: 'Best regards,' });
    const { container } = renderPage(<MinhaConta />);
    await screen.findByLabelText('Texto (opcional)');
    const dica = container.querySelector('.assinatura-dica');
    expect(dica?.textContent).toBe('PNG ou JPEG, até 300 KB e no máximo 600×300 px. A imagem não é redimensionada: envie já no tamanho final.');
    expect(dica?.querySelector('.assinatura-mono')?.textContent).toBe('600×300');
    expect(screen.getByText('0/2000')).toBeTruthy();
  });
});

describe('F11: copy do Ajuda e do help.ts', () => {
  it('FAQ sem nenhum "+ " nos nomes de botao das respostas', () => {
    const respostas = FAQ_BY_CATEGORY.flatMap((g) => g.questions.map((q) => q.answer));
    expect(respostas.filter((r) => r.includes('"+ '))).toEqual([]);
    expect(respostas.some((r) => r.includes('clique em "Nova cotação"'))).toBe(true);
  });

  it('Ajuda: "1 resposta" no singular quando o filtro deixa uma pergunta; plural com varias', () => {
    const primeira = FAQ_BY_CATEGORY[0]?.questions[0]?.question ?? '';
    const { container } = render(<Ajuda />);
    expect(container.querySelector('.chip--static')?.textContent).toMatch(/^\d+ respostas$/);
    fireEvent.change(screen.getByPlaceholderText('Palavras-chave da pergunta'), { target: { value: primeira } });
    expect(container.querySelector('.chip--static')?.textContent).toBe('1 resposta');
  });
});
