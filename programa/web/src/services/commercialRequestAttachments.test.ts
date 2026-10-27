import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() },
}));

import { api } from '@/api/client';
import {
  defaultAttachmentKind,
  deleteCommercialRequestAttachment,
  downloadCommercialRequestAttachment,
  resolveAttachmentMime,
  uploadCommercialRequestAttachment,
} from './commercialRequestAttachments';

// Dados sinteticos em memoria.
const PDF_BYTES = '%PDF-1.4\n%%EOF\n';

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset();
  vi.mocked(api.del).mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('uploadCommercialRequestAttachment', () => {
  it('POST com kind, fileName, mimeType e contentBase64 puro (sem prefixo data-URL)', async () => {
    vi.mocked(api.post).mockResolvedValue({ id: 1 });
    const file = new File([PDF_BYTES], 'tds.pdf', { type: 'application/pdf' });

    await uploadCommercialRequestAttachment(12, { kind: 'TDS', file });

    expect(api.post).toHaveBeenCalledTimes(1);
    const [path, body] = vi.mocked(api.post).mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe('/api/v1/commercial-requests/12/attachments');
    expect(Object.keys(body).sort()).toEqual(['contentBase64', 'fileName', 'kind', 'mimeType']);
    expect(body).toMatchObject({ kind: 'TDS', fileName: 'tds.pdf', mimeType: 'application/pdf' });
    expect(body.contentBase64).toBe(btoa(PDF_BYTES));
    expect(String(body.contentBase64)).not.toMatch(/^data:/);
  });

  it('sem tipo no navegador usa o da extensao; extensao fora da lista nao chama a API', async () => {
    vi.mocked(api.post).mockResolvedValue({ id: 1 });

    await uploadCommercialRequestAttachment(1, {
      kind: 'OUTRO',
      file: new File(['x'], 'foto.JPG', { type: '' }),
    });
    expect((vi.mocked(api.post).mock.calls[0]![1] as Record<string, unknown>).mimeType).toBe('image/jpeg');

    await expect(
      uploadCommercialRequestAttachment(1, { kind: 'OUTRO', file: new File(['x'], 'run.exe', { type: '' }) }),
    ).rejects.toThrow(/Tipo de arquivo não permitido/);
    expect(api.post).toHaveBeenCalledTimes(1);
  });
});

describe('resolveAttachmentMime / defaultAttachmentKind', () => {
  it('tipo informado fora da lista ou extensao dupla com tipo estranho sao recusados', () => {
    expect(resolveAttachmentMime({ name: 'a.pdf', type: 'application/pdf' })).toBe('application/pdf');
    expect(resolveAttachmentMime({ name: 'a.pdf', type: 'application/x-msdownload' })).toBeNull();
    expect(resolveAttachmentMime({ name: 'a.pdf.exe', type: 'application/pdf' })).toBeNull();
    expect(resolveAttachmentMime({ name: 'semextensao', type: 'application/pdf' })).toBeNull();
  });

  it('tipo padrao pelo nome', () => {
    expect(defaultAttachmentKind('TDS final.pdf')).toBe('TDS');
    expect(defaultAttachmentKind('msds.pdf')).toBe('MSDS');
    expect(defaultAttachmentKind('ficha_SDS.png')).toBe('MSDS');
    expect(defaultAttachmentKind('laudo.pdf')).toBe('OUTRO');
  });
});

describe('downloadCommercialRequestAttachment', () => {
  it('monta o Blob com o mime do servidor e baixa por <a download>', async () => {
    const createObjectURL = vi.fn(() => 'blob:fake');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true, writable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, configurable: true, writable: true });
    let clicked: HTMLAnchorElement | null = null;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked = this;
    });
    vi.mocked(api.get).mockResolvedValue({
      fileName: 'msds.png',
      mimeType: 'image/png',
      contentBase64: btoa('png-bytes'),
    });

    await downloadCommercialRequestAttachment(12, 4);

    expect(api.get).toHaveBeenCalledWith('/api/v1/commercial-requests/12/attachments/4/download');
    const blob = (createObjectURL.mock.calls[0] as unknown as [Blob])[0];
    expect(blob.type).toBe('image/png');
    expect(blob.size).toBe('png-bytes'.length);
    expect(clicked).not.toBeNull();
    expect((clicked as unknown as HTMLAnchorElement).download).toBe('msds.png');
    expect((clicked as unknown as HTMLAnchorElement).href).toBe('blob:fake');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake');
  });
});

describe('deleteCommercialRequestAttachment', () => {
  it('DELETE no anexo da solicitacao', async () => {
    vi.mocked(api.del).mockResolvedValue(undefined);

    await deleteCommercialRequestAttachment(12, 4);

    expect(api.del).toHaveBeenCalledWith('/api/v1/commercial-requests/12/attachments/4');
  });
});
