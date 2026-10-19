import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SupplierDocumentsSection } from './SupplierDocumentsSection';

let mockRole = 'comprador';
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, name: 'U', email: 'u@b.c', role: mockRole } }),
}));

const { confirmMock } = vi.hoisted(() => ({ confirmMock: vi.fn(async () => true) }));
vi.mock('@/components/useConfirm', () => ({ useConfirm: () => confirmMock }));

vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() },
  ApiError: class ApiError extends Error {},
}));

import { api } from '@/api/client';

type Status = 'ok' | 'expiring' | 'due_today' | 'expired';

function doc(id: number, name: string, status: Status, daysLeft: number, expiresOn = '2026-12-01') {
  return {
    id,
    supplierId: 10,
    name,
    expiresOn,
    notes: null,
    fileName: `${name}.pdf`,
    mimeType: 'application/pdf',
    fileSize: 2048,
    daysLeft,
    status,
    createdAt: '2026-10-19T12:00:00.000Z',
    updatedAt: '2026-10-19T12:00:00.000Z',
    createdBy: { id: 1, name: 'U' },
  };
}

function mockList(rows: ReturnType<typeof doc>[]) {
  vi.mocked(api.get).mockImplementation((async () => rows) as typeof api.get);
}

function renderSection() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SupplierDocumentsSection supplierId={10} supplierName="ACME Ltda" />
    </QueryClientProvider>,
  );
}

function pickFile(file: File) {
  const input = document.querySelector('#sd-file') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
}

describe('SupplierDocumentsSection', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
    vi.mocked(api.put).mockReset();
    vi.mocked(api.patch).mockReset();
    vi.mocked(api.del).mockReset();
    confirmMock.mockClear();
    confirmMock.mockResolvedValue(true);
    mockRole = 'comprador';
  });

  it('viewer so ve "Baixar": sem Novo documento, Editar, Substituir nem Excluir', async () => {
    mockRole = 'viewer';
    mockList([doc(1, 'Licenca', 'ok', 90)]);
    renderSection();

    expect(await screen.findByText('Licenca')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Baixar' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Novo documento' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Editar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Substituir' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Excluir' })).toBeNull();
  });

  it('comprador ve todas as acoes', async () => {
    mockList([doc(1, 'Licenca', 'ok', 90)]);
    renderSection();

    expect(await screen.findByText('Licenca')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Novo documento' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Baixar' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Editar' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Substituir' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Excluir' })).toBeTruthy();
  });

  it('mostra o badge de situacao a partir de status/daysLeft do backend', async () => {
    mockList([
      doc(1, 'Doc A', 'expired', -3, '2026-10-16'),
      doc(2, 'Doc B', 'due_today', 0, '2026-10-19'),
      doc(3, 'Doc C', 'expiring', 5, '2026-10-24'),
      doc(4, 'Doc D', 'ok', 200, '2027-05-07'),
    ]);
    renderSection();

    expect((await screen.findByText('Vencido')).className).toContain('badge--danger');
    // "Vence hoje" e mais urgente (danger) que "Vence em N dias" (warning).
    expect(screen.getByText('Vence hoje').className).toContain('badge--danger');
    expect(screen.getByText('Vence em 5 dias').className).toContain('badge--warning');
    expect(screen.getByText('Em dia').className).not.toContain('badge--');
    // Data formatada por split, sem deslocamento de fuso.
    expect(screen.getByText('16/10/2026')).toBeTruthy();
  });

  it('abaixo de 720px renderiza cards empilhados (sem tabela) com as mesmas acoes', async () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: true,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })) as unknown as typeof window.matchMedia;

    try {
      mockList([doc(1, 'Licenca', 'expiring', 5, '2026-10-24')]);
      const { container } = renderSection();

      expect(await screen.findByText('Vence em 5 dias')).toBeTruthy();
      expect(container.querySelector('table')).toBeNull();
      expect(screen.getByRole('article', { name: 'Licenca' })).toBeTruthy();
      expect(screen.getByText('Vencimento: 24/10/2026')).toBeTruthy();
      for (const label of ['Baixar', 'Editar', 'Substituir', 'Excluir']) {
        expect(screen.getByRole('button', { name: label })).toBeTruthy();
      }
    } finally {
      window.matchMedia = original;
    }
  });

  it('modo tabela nao alarga a tabela externa: raiz width 0/min 100%, layout fixo, sem min-width nem nowrap', async () => {
    mockList([doc(1, 'Licenca', 'ok', 90)]);
    const { container } = renderSection();
    await screen.findByText('Licenca');

    const root = screen.getByText('Documentos').closest('.page-header')!.parentElement as HTMLElement;
    expect(root.style.width).toBe('0px');
    expect(root.style.minWidth).toBe('100%');
    expect(root.style.position).toBe('');

    const table = container.querySelector('table') as HTMLTableElement;
    expect(table.style.tableLayout).toBe('fixed');
    expect(table.style.width).toBe('100%');
    for (const th of Array.from(table.querySelectorAll('th'))) {
      expect(th.style.minWidth).toBe('');
      expect(th.style.width).toMatch(/%$/);
    }
    expect(container.querySelector('.row-actions--nowrap')).toBeNull();
    expect(container.querySelector('.cell-nowrap')?.textContent).toBe('01/12/2026');
  });

  it('modo cards: secao inteira sticky com a largura do ancestral rolavel (re-medida no resize)', async () => {
    const originalMatchMedia = window.matchMedia;
    const originalRO = (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
    let notify: () => void = () => {};
    window.matchMedia = ((query: string) => ({
      matches: true,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })) as unknown as typeof window.matchMedia;
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      constructor(cb: () => void) {
        notify = cb;
      }
      observe() {}
      disconnect() {}
    };

    try {
      mockList([doc(1, 'Licenca', 'ok', 90)]);
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const { container } = render(
        <QueryClientProvider client={qc}>
          <div className="table-wrapper" style={{ overflowX: 'auto' }} data-testid="scroller">
            <table>
              <tbody>
                <tr>
                  <td style={{ padding: '12px' }}>
                    <SupplierDocumentsSection supplierId={10} supplierName="ACME Ltda" />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </QueryClientProvider>,
      );
      const scroller = container.querySelector('[data-testid="scroller"]') as HTMLElement;
      let clientWidth = 342;
      Object.defineProperty(scroller, 'clientWidth', { configurable: true, get: () => clientWidth });

      await screen.findByRole('article', { name: 'Licenca' });
      notify();

      const root = screen.getByText('Documentos').closest('.page-header')!.parentElement as HTMLElement;
      await waitFor(() => expect(root.style.width).toBe('318px'));
      expect(root.style.position).toBe('sticky');
      expect(root.style.left).toBe('12px');
      expect(root.style.boxSizing).toBe('border-box');
      // Titulo, botao e cards ficam todos dentro da raiz sticky.
      expect(root.contains(screen.getByRole('button', { name: 'Novo documento' }))).toBe(true);
      expect(root.contains(screen.getByRole('article', { name: 'Licenca' }))).toBe(true);

      clientWidth = 500;
      notify();
      await waitFor(() => expect(root.style.width).toBe('476px'));
    } finally {
      window.matchMedia = originalMatchMedia;
      (globalThis as { ResizeObserver?: unknown }).ResizeObserver = originalRO;
    }
  });

  it('modal Substituir mostra o nome do documento e o arquivo atual', async () => {
    mockList([doc(1, 'Licenca', 'ok', 90)]);
    renderSection();

    fireEvent.click(await screen.findByRole('button', { name: 'Substituir' }));

    expect(await screen.findByText('Arquivo atual: Licenca.pdf · 2,0 KB')).toBeTruthy();
    expect(screen.getAllByText('Licenca').length).toBeGreaterThan(1);
    expect(document.querySelector('#sd-name')).toBeNull();
  });

  it('rotulo do arquivo e curto e a ajuda fica abaixo do input', async () => {
    mockList([]);
    renderSection();

    fireEvent.click(await screen.findByRole('button', { name: 'Novo documento' }));

    expect(document.querySelector('label[for="sd-file"]')?.textContent).toBe('Arquivo *');
    expect(screen.getByText('PDF, PNG ou JPEG, até 10 MB.')).toBeTruthy();
  });

  it('arquivo de 11 MB mostra erro e nao chama api.post', async () => {
    mockList([]);
    renderSection();

    fireEvent.click(await screen.findByRole('button', { name: 'Novo documento' }));
    const big = new File(['x'], 'grande.pdf', { type: 'application/pdf' });
    Object.defineProperty(big, 'size', { value: 11 * 1024 * 1024 });
    pickFile(big);

    expect((await screen.findByRole('alert')).textContent).toContain('10 MB');

    fireEvent.change(document.querySelector('#sd-name') as HTMLInputElement, {
      target: { value: 'Grande' },
    });
    fireEvent.change(document.querySelector('#sd-expires') as HTMLInputElement, {
      target: { value: '2027-01-31' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(api.post).not.toHaveBeenCalled();
  });

  it('arquivo .exe mostra erro de tipo e nao chama api.post', async () => {
    mockList([]);
    renderSection();

    fireEvent.click(await screen.findByRole('button', { name: 'Novo documento' }));
    pickFile(new File(['MZ'], 'setup.exe', { type: 'application/x-msdownload' }));

    expect((await screen.findByRole('alert')).textContent).toContain('PDF, PNG ou JPEG');

    fireEvent.change(document.querySelector('#sd-name') as HTMLInputElement, {
      target: { value: 'Setup' },
    });
    fireEvent.change(document.querySelector('#sd-expires') as HTMLInputElement, {
      target: { value: '2027-01-31' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(api.post).not.toHaveBeenCalled();
  });

  it('novo documento valido envia o arquivo em base64 e pre-preenche o nome', async () => {
    mockList([]);
    vi.mocked(api.post).mockResolvedValue(doc(9, 'Certificado', 'ok', 100));
    renderSection();

    fireEvent.click(await screen.findByRole('button', { name: 'Novo documento' }));
    pickFile(new File(['%PDF-1.7 conteudo'], 'Certificado.pdf', { type: 'application/pdf' }));

    await waitFor(() =>
      expect((document.querySelector('#sd-name') as HTMLInputElement).value).toBe('Certificado'),
    );
    fireEvent.change(document.querySelector('#sd-expires') as HTMLInputElement, {
      target: { value: '2027-01-31' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    const [url, body] = vi.mocked(api.post).mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toBe('/api/v1/supplier-documents');
    expect(body).toMatchObject({
      supplierId: 10,
      name: 'Certificado',
      expiresOn: '2027-01-31',
      fileName: 'Certificado.pdf',
      mimeType: 'application/pdf',
    });
    expect(atob(body.contentBase64 as string)).toBe('%PDF-1.7 conteudo');
  });

  it('renomear chama api.patch so com { name }', async () => {
    mockList([doc(1, 'Licenca', 'ok', 90)]);
    vi.mocked(api.patch).mockResolvedValue(doc(1, 'Licenca nova', 'ok', 90));
    renderSection();

    fireEvent.click(await screen.findByRole('button', { name: 'Editar' }));
    fireEvent.change(document.querySelector('#sd-name') as HTMLInputElement, {
      target: { value: 'Licenca nova' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
    expect(api.patch).toHaveBeenCalledWith('/api/v1/supplier-documents/1', { name: 'Licenca nova' });
  });

  it('excluir passa pelo confirm e chama api.del', async () => {
    mockList([doc(1, 'Licenca', 'ok', 90)]);
    vi.mocked(api.del).mockResolvedValue({ ok: true });
    renderSection();

    fireEvent.click(await screen.findByRole('button', { name: 'Excluir' }));

    await waitFor(() => expect(api.del).toHaveBeenCalledWith('/api/v1/supplier-documents/1'));
    expect(confirmMock).toHaveBeenCalledTimes(1);
  });

  it('excluir cancelado no confirm nao chama api.del', async () => {
    mockList([doc(1, 'Licenca', 'ok', 90)]);
    confirmMock.mockResolvedValue(false);
    renderSection();

    fireEvent.click(await screen.findByRole('button', { name: 'Excluir' }));

    await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1));
    expect(api.del).not.toHaveBeenCalled();
  });
});
