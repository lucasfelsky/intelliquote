import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConfirmProvider } from '@/components/useConfirm';
import MinhaConta from './MinhaConta';

vi.mock('@/api/client', () => {
  class ApiError extends Error {
    status: number;
    body: unknown;
    constructor(status: number, body: unknown, message?: string) {
      super(message ?? `HTTP ${status}`);
      this.status = status;
      this.body = body;
    }
  }
  return { api: { get: vi.fn(), put: vi.fn(), del: vi.fn() }, ApiError };
});

// jsdom nao carrega imagens (Image.onload nunca dispara): so' a leitura das
// dimensoes e' substituida; o resto do servico e' o real.
vi.mock('@/services/account', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/account')>();
  return { ...actual, readImageDimensions: vi.fn(async () => ({ width: 300, height: 90 })) };
});

import { api, ApiError } from '@/api/client';
import { readImageDimensions } from '@/services/account';

const BASE_SIGNATURE = {
  name: 'Maria Compradora',
  email: 'maria@sqquimica.com',
  text: null,
  image: null,
  fallbackSignature: 'Best regards,\nMaria Compradora\nmaria@sqquimica.com',
};

const IMAGE = {
  dataUri: 'data:image/png;base64,AAAA',
  mimeType: 'image/png' as const,
  width: 300,
  height: 90,
  size: 2048,
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ConfirmProvider>
        <MinhaConta />
      </ConfirmProvider>
    </QueryClientProvider>,
  );
}

describe('MinhaConta - assinatura de e-mail', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.put).mockReset();
    vi.mocked(api.del).mockReset();
    vi.mocked(readImageDimensions).mockClear();
    vi.mocked(readImageDimensions).mockResolvedValue({ width: 300, height: 90 });
    vi.mocked(api.get).mockResolvedValue(BASE_SIGNATURE);
  });

  it('carrega: textarea com contador, e a previa mostra o fallback quando nao ha assinatura', async () => {
    const { findByLabelText, getByTestId, getByText } = renderPage();
    const textarea = (await findByLabelText('Texto (opcional)')) as HTMLTextAreaElement;
    expect(textarea.value).toBe('');
    expect(getByText('0/2000')).toBeTruthy();
    expect(api.get).toHaveBeenCalledWith('/v1/account/email-signature');
    expect(getByTestId('signature-preview').textContent).toContain('Best regards,');
    expect(getByTestId('signature-preview').textContent).toContain('maria@sqquimica.com');
  });

  it('carrega com texto e imagem: a previa mostra o texto e a imagem via dataUri', async () => {
    vi.mocked(api.get).mockResolvedValue({ ...BASE_SIGNATURE, text: 'Att,\nMaria', image: IMAGE });
    const { findByLabelText, getByTestId } = renderPage();
    const textarea = (await findByLabelText('Texto (opcional)')) as HTMLTextAreaElement;
    expect(textarea.value).toBe('Att,\nMaria');
    const preview = getByTestId('signature-preview');
    expect(preview.textContent).toContain('Att,');
    expect(preview.querySelector('img')?.getAttribute('src')).toBe(IMAGE.dataUri);
    expect(preview.textContent).not.toContain('Best regards,');
  });

  it('so imagem: a previa mostra "Best regards," + imagem', async () => {
    vi.mocked(api.get).mockResolvedValue({ ...BASE_SIGNATURE, image: IMAGE });
    const { findByLabelText, getByTestId } = renderPage();
    await findByLabelText('Texto (opcional)');
    const preview = getByTestId('signature-preview');
    expect(preview.textContent).toContain('Best regards,');
    expect(preview.textContent).not.toContain('maria@sqquimica.com');
    expect(preview.querySelector('img')).toBeTruthy();
  });

  it('salva o texto: PUT /text com o payload { text } (com trim)', async () => {
    vi.mocked(api.put).mockResolvedValue({ text: 'Maria Compradora' });
    const { findByLabelText, getByRole, findByText } = renderPage();
    const textarea = await findByLabelText('Texto (opcional)');
    fireEvent.change(textarea, { target: { value: '  Maria Compradora  ' } });
    fireEvent.click(getByRole('button', { name: 'Salvar texto' }));

    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith('/v1/account/email-signature/text', {
        text: 'Maria Compradora',
      }),
    );
    expect(await findByText('Texto da assinatura salvo.')).toBeTruthy();
  });

  it('texto vazio salva null', async () => {
    vi.mocked(api.get).mockResolvedValue({ ...BASE_SIGNATURE, text: 'Antigo' });
    vi.mocked(api.put).mockResolvedValue({ text: null });
    const { findByLabelText, getByRole } = renderPage();
    const textarea = await findByLabelText('Texto (opcional)');
    fireEvent.change(textarea, { target: { value: '   ' } });
    fireEvent.click(getByRole('button', { name: 'Salvar texto' }));
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith('/v1/account/email-signature/text', { text: null }),
    );
  });

  it('upload envia fileName, fileType, fileSize e contentBase64', async () => {
    vi.mocked(api.put).mockResolvedValue({ image: IMAGE });
    const { findByLabelText, findByText } = renderPage();
    const input = (await findByLabelText('Enviar imagem')) as HTMLInputElement;
    const file = new File(['abc'], 'assinatura.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    const [path, body] = vi.mocked(api.put).mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe('/v1/account/email-signature/image');
    expect(body).toEqual({
      fileName: 'assinatura.png',
      fileType: 'image/png',
      fileSize: 3,
      contentBase64: btoa('abc'),
    });
    expect(await findByText('Imagem da assinatura salva.')).toBeTruthy();
  });

  it('pre-checagem no cliente: tipo invalido nao chama a API', async () => {
    const { findByLabelText, findByRole } = renderPage();
    const input = (await findByLabelText('Enviar imagem')) as HTMLInputElement;
    const file = new File(['<svg/>'], 'a.svg', { type: 'image/svg+xml' });
    fireEvent.change(input, { target: { files: [file] } });
    const alert = await findByRole('alert');
    expect(alert.textContent).toContain('PNG ou JPEG');
    expect(api.put).not.toHaveBeenCalled();
  });

  it('pre-checagem no cliente: dimensoes acima do limite nao chamam a API', async () => {
    vi.mocked(readImageDimensions).mockResolvedValue({ width: 800, height: 100 });
    const { findByLabelText, findByRole } = renderPage();
    const input = (await findByLabelText('Enviar imagem')) as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File(['abc'], 'grande.png', { type: 'image/png' })] },
    });
    const alert = await findByRole('alert');
    expect(alert.textContent).toContain('600×300');
    expect(api.put).not.toHaveBeenCalled();
  });

  it('remover imagem: confirma e chama DELETE', async () => {
    vi.mocked(api.get).mockResolvedValue({ ...BASE_SIGNATURE, image: IMAGE });
    vi.mocked(api.del).mockResolvedValue(undefined);
    const { findByRole, container } = renderPage();
    fireEvent.click(await findByRole('button', { name: 'Remover imagem' }));

    // O modal de confirmacao e' um <dialog>; o botao de confirmar chama-se "Remover".
    const dialog = container.ownerDocument.querySelector('dialog') as HTMLDialogElement;
    expect(dialog).toBeTruthy();
    const confirmButton = Array.from(dialog.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Remover',
    ) as HTMLButtonElement;
    expect(confirmButton).toBeTruthy();
    fireEvent.click(confirmButton);

    await waitFor(() => expect(api.del).toHaveBeenCalledWith('/v1/account/email-signature/image'));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Remover imagem' })).toBeNull());
  });

  it('erro 400 do backend aparece na tela', async () => {
    vi.mocked(api.put).mockRejectedValue(
      new ApiError(400, null, 'Redimensione para no maximo 600x300 px.'),
    );
    const { findByLabelText, findByRole } = renderPage();
    const input = (await findByLabelText('Enviar imagem')) as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File(['abc'], 'a.png', { type: 'image/png' })] },
    });
    const alert = await findByRole('alert');
    expect(alert.textContent).toContain('Redimensione para no maximo 600x300 px.');
  });

  it('erro ao salvar o texto aparece na tela', async () => {
    vi.mocked(api.put).mockRejectedValue(new ApiError(400, null, 'O texto da assinatura deve ter no maximo 2000 caracteres.'));
    const { findByLabelText, getByRole, findByRole } = renderPage();
    fireEvent.change(await findByLabelText('Texto (opcional)'), { target: { value: 'x' } });
    fireEvent.click(getByRole('button', { name: 'Salvar texto' }));
    const alert = await findByRole('alert');
    expect(alert.textContent).toContain('2000 caracteres');
  });
});
