import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Solicitacoes from '../Solicitacoes';
import { AnexosLista } from './AnexosTecnicos';

vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, name: 'U', email: 'u@b.c', role: 'comercial' } }),
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

// Dados 100% sinteticos: arquivos em memoria.
const PDF_BYTES = '%PDF-1.4\n%%EOF\n';

function pdfFile(name: string, content = PDF_BYTES): File {
  return new File([content], name, { type: 'application/pdf', lastModified: 1 });
}

function sizedFile(name: string, type: string, size: number): File {
  const file = new File(['x'], name, { type, lastModified: 1 });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

function page<T>(data: T[]) {
  return { data, pagination: { page: 1, pageSize: 20, totalItems: data.length, totalPages: 1 } };
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
    quote: null,
    attachments: [
      { id: 3, kind: 'TDS', fileName: 'tds.pdf', mimeType: 'application/pdf', fileSize: 2048, createdAt: '2026-10-18T12:00:00.000Z' },
    ],
    items: [
      {
        id: 71,
        catalogItemId: null,
        commercialName: 'Aditivo Novo',
        isNewItem: true,
        notes: null,
        quantity: 2,
        unit: 'KG',
        targetPrice: null,
        targetCurrency: null,
        finalPrice: null,
      },
    ],
    ...overrides,
  };
}

function mockApi(rows: unknown[] = []) {
  vi.mocked(api.get).mockImplementation((async (path: string) => {
    if (path === '/api/v1/commercial-requests/mine') return page(rows);
    if (path === '/api/v1/commercial-requests/catalog-items') return [];
    return [];
  }) as typeof api.get);
}

function renderWithClient(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

function renderPage() {
  return renderWithClient(
    <MemoryRouter initialEntries={['/solicitacoes']}>
      <Routes>
        <Route path="*" element={<Solicitacoes />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function openModalWithNewItem() {
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: 'Solicitar uma cotação' }));
  fireEvent.change(screen.getByLabelText('Buscar item'), { target: { value: 'Aditivo Novo' } });
  fireEvent.click(await screen.findByRole('button', { name: '+ Incluir "Aditivo Novo" como item novo' }));
}

function selectFiles(files: File[]) {
  fireEvent.change(screen.getByLabelText('Arquivos técnicos (opcional)'), { target: { files } });
}

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset();
  vi.mocked(api.del).mockReset();
  mockApi();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Anexos tecnicos no modal da solicitacao', () => {
  it('so aparece com item novo (campo opcional + ajuda)', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Solicitar uma cotação' }));
    expect(screen.queryByLabelText('Arquivos técnicos (opcional)')).toBeNull();

    fireEvent.change(screen.getByLabelText('Buscar item'), { target: { value: 'Aditivo Novo' } });
    fireEvent.click(await screen.findByRole('button', { name: '+ Incluir "Aditivo Novo" como item novo' }));

    expect(screen.getByLabelText('Arquivos técnicos (opcional)')).toBeTruthy();
    expect(
      screen.getByText('TDS, MSDS ou outro. PDF, PNG ou JPEG, até 10 MB cada, no máximo 5.'),
    ).toBeTruthy();
  });

  it('rejeita no cliente arquivo de 11 MB e .exe, com mensagem', async () => {
    await openModalWithNewItem();

    selectFiles([
      sizedFile('grande.pdf', 'application/pdf', 11 * 1024 * 1024),
      sizedFile('virus.exe', 'application/x-msdownload', 100),
      sizedFile('vazio.pdf', 'application/pdf', 0),
    ]);

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('"grande.pdf": excede o limite de 10 MB.');
    expect(alert.textContent).toContain('"virus.exe": tipo não permitido. Envie PDF, PNG ou JPEG.');
    expect(alert.textContent).toContain('"vazio.pdf": o arquivo está vazio.');
    expect(screen.queryByLabelText('Arquivos selecionados')).toBeNull();
  });

  it('rejeita o 6o arquivo e mantem os 5 primeiros', async () => {
    await openModalWithNewItem();

    selectFiles(Array.from({ length: 6 }, (_, i) => pdfFile(`doc-${i}.pdf`, `${PDF_BYTES}${i}`)));

    expect(screen.getByRole('alert').textContent).toContain('Máximo de 5 arquivos por solicitação.');
    expect(screen.getByLabelText('Arquivos selecionados').querySelectorAll('li')).toHaveLength(5);
  });

  it('tipo padrao pelo nome (tds -> TDS, msds -> MSDS, senao Outro) e editavel', async () => {
    await openModalWithNewItem();

    selectFiles([pdfFile('TDS_resina.pdf'), pdfFile('msds_resina.pdf', `${PDF_BYTES}a`), pdfFile('ficha.pdf', `${PDF_BYTES}b`)]);

    expect((screen.getByLabelText('Tipo de TDS_resina.pdf') as HTMLSelectElement).value).toBe('TDS');
    expect((screen.getByLabelText('Tipo de msds_resina.pdf') as HTMLSelectElement).value).toBe('MSDS');
    const other = screen.getByLabelText('Tipo de ficha.pdf') as HTMLSelectElement;
    expect(other.value).toBe('OUTRO');
    fireEvent.change(other, { target: { value: 'MSDS' } });
    expect(other.value).toBe('MSDS');
  });

  it('remover a ultima linha nova esconde o campo de anexos e descarta a selecao', async () => {
    await openModalWithNewItem();
    selectFiles([pdfFile('tds.pdf')]);
    expect(screen.getByLabelText('Arquivos selecionados')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Remover item' }));

    expect(screen.queryByLabelText('Arquivos técnicos (opcional)')).toBeNull();
    expect(screen.queryByLabelText('Arquivos selecionados')).toBeNull();
  });

  it('depois do create envia 1 POST por arquivo, em sequencia, com o kind escolhido', async () => {
    vi.mocked(api.post).mockImplementation((async (path: string) => {
      if (path === '/api/v1/commercial-requests') return { id: 6, isDevelopment: true, items: [] };
      return { id: 1, kind: 'TDS', fileName: 'x', mimeType: 'application/pdf', fileSize: 1, createdAt: 'x' };
    }) as typeof api.post);
    await openModalWithNewItem();
    selectFiles([pdfFile('tds.pdf'), pdfFile('msds.pdf', `${PDF_BYTES}a`)]);

    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(3));
    const calls = vi.mocked(api.post).mock.calls as Array<[string, Record<string, unknown>]>;
    expect(calls[0]![0]).toBe('/api/v1/commercial-requests');
    expect(calls[1]![0]).toBe('/api/v1/commercial-requests/6/attachments');
    expect(calls[1]![1]).toMatchObject({ kind: 'TDS', fileName: 'tds.pdf', mimeType: 'application/pdf' });
    expect(calls[2]![1]).toMatchObject({ kind: 'MSDS', fileName: 'msds.pdf', mimeType: 'application/pdf' });
    expect(calls[1]![1].contentBase64).toBe(btoa(PDF_BYTES));
    expect(String(calls[1]![1].contentBase64)).not.toContain('data:');
    // Sucesso total: o modal fecha.
    await waitFor(() => expect(screen.queryByLabelText('Buscar item')).toBeNull());
  });

  it('falha no 2o arquivo: avisa que a solicitacao foi criada, mantem o modal e permite tentar de novo', async () => {
    let attachmentCalls = 0;
    vi.mocked(api.post).mockImplementation((async (path: string) => {
      if (path === '/api/v1/commercial-requests') return { id: 6, isDevelopment: true, items: [] };
      attachmentCalls += 1;
      if (attachmentCalls === 2) {
        throw new ApiError(409, { message: 'Este arquivo ja foi anexado.' });
      }
      return { id: 1, kind: 'TDS', fileName: 'x', mimeType: 'application/pdf', fileSize: 1, createdAt: 'x' };
    }) as typeof api.post);
    await openModalWithNewItem();
    selectFiles([pdfFile('tds.pdf'), pdfFile('msds.pdf', `${PDF_BYTES}a`)]);

    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(
      'Solicitação #6 criada, mas o anexo "msds.pdf" não foi enviado: Este arquivo ja foi anexado. Reenvie pela lista.',
    );
    // Modal aberto em modo "so anexos": so o arquivo que falhou continua na selecao.
    expect(screen.queryByRole('button', { name: 'Enviar' })).toBeNull();
    const remaining = screen.getByLabelText('Arquivos selecionados').querySelectorAll('li');
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.textContent).toContain('msds.pdf');

    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(4));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Tentar de novo' })).toBeNull());
  });
});

describe('Anexos tecnicos na lista do comercial', () => {
  it('pendente + desenvolvimento: lista, Baixar, Remover e Anexar', async () => {
    mockApi([mineRow()]);
    renderPage();

    expect(await screen.findByText('tds.pdf · 2,0 KB')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Baixar tds.pdf' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remover tds.pdf' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Anexar arquivo à solicitação #7' })).toBeTruthy();
  });

  it('solicitacao em cotacao: so baixa (sem Remover nem Anexar)', async () => {
    mockApi([mineRow({ status: 'quoting' })]);
    renderPage();

    expect(await screen.findByRole('button', { name: 'Baixar tds.pdf' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Remover tds.pdf' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Anexar arquivo/ })).toBeNull();
  });

  it('solicitacao comum sem anexos mostra "—" na coluna Anexos', async () => {
    mockApi([mineRow({ isDevelopment: false, attachments: [] })]);
    renderPage();

    await screen.findByText('#7');
    expect(screen.queryByRole('button', { name: /Anexar arquivo/ })).toBeNull();
    expect(document.querySelector('td[data-label="Anexos"]')?.textContent).toBe('—');
  });

  it('Anexar depois: envia o arquivo na solicitacao e respeita o limite com os anexos existentes', async () => {
    vi.mocked(api.post).mockResolvedValue({ id: 9, kind: 'OUTRO', fileName: 'x', mimeType: 'application/pdf', fileSize: 1, createdAt: 'x' });
    mockApi([mineRow()]);
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Anexar arquivo à solicitação #7' }));
    // 1 anexo ja existe: so cabem mais 4.
    selectFiles(Array.from({ length: 5 }, (_, i) => pdfFile(`extra-${i}.pdf`, `${PDF_BYTES}${i}`)));
    expect(screen.getByRole('alert').textContent).toContain('Máximo de 5 arquivos por solicitação.');
    expect(screen.getByLabelText('Arquivos selecionados').querySelectorAll('li')).toHaveLength(4);

    fireEvent.click(screen.getByRole('button', { name: 'Enviar anexos' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(4));
    expect(vi.mocked(api.post).mock.calls[0]![0]).toBe('/api/v1/commercial-requests/7/attachments');
  });

  it('Remover pede confirmacao e chama DELETE do anexo', async () => {
    vi.mocked(api.del).mockResolvedValue(undefined);
    mockApi([mineRow()]);
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Remover tds.pdf' }));
    expect(api.del).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar remoção' }));

    await waitFor(() => expect(api.del).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.del).mock.calls[0]![0]).toBe('/api/v1/commercial-requests/7/attachments/3');
  });
});

describe('AnexosLista: download', () => {
  it('"Baixar" chama /download e cria o Blob com o tipo do servidor (sem abrir em aba)', async () => {
    const createObjectURL = vi.fn(() => 'blob:fake');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true, writable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, configurable: true, writable: true });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    vi.mocked(api.get).mockResolvedValue({
      fileName: 'tds.pdf',
      mimeType: 'application/pdf',
      contentBase64: btoa(PDF_BYTES),
    });

    renderWithClient(
      <AnexosLista
        requestId={7}
        attachments={[
          { id: 3, kind: 'TDS', fileName: 'tds.pdf', mimeType: 'application/pdf', fileSize: 2048, createdAt: '2026-10-18T12:00:00.000Z' },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Baixar tds.pdf' }));

    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.get).mock.calls[0]![0]).toBe('/api/v1/commercial-requests/7/attachments/3/download');
    const blob = (createObjectURL.mock.calls[0] as unknown as [Blob])[0];
    expect(blob.type).toBe('application/pdf');
    expect(blob.size).toBe(PDF_BYTES.length);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake');
    expect(openSpy).not.toHaveBeenCalled();
    // Sem Remover quando canRemove nao e passado (visao COMEX).
    expect(screen.queryByRole('button', { name: /Remover/ })).toBeNull();
  });

  it('falha no download mostra a mensagem do servidor', async () => {
    vi.mocked(api.get).mockRejectedValue(new ApiError(404, { message: 'Anexo nao encontrado.' }));

    renderWithClient(
      <AnexosLista
        requestId={7}
        attachments={[
          { id: 3, kind: 'MSDS', fileName: 'msds.pdf', mimeType: 'application/pdf', fileSize: 10, createdAt: 'x' },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Baixar msds.pdf' }));

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Não foi possível baixar o anexo: Anexo nao encontrado.',
    );
  });
});
