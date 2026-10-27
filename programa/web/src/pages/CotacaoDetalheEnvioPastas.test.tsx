/// <reference types="node" />
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConfirmProvider } from '@/components/useConfirm';
import CotacaoDetalhe from './CotacaoDetalhe';

vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, name: 'Admin', email: 'a@b.c', role: 'admin' } }),
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

const quoteFixture = {
  id: 1,
  requestCode: 'RFQ-001',
  productName: 'Produto X',
  quantity: 100,
  description: 'Descricao da cotacao',
  desiredIncoterm: ['FOB'],
  destinationPort: 'Santos',
  originPort: 'Shanghai',
  currency: 'USD',
  deadlineAt: null,
  status: 'open',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
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
      catalogItem: {
        id: 3,
        commercialName: 'Produto X',
        marketName: 'PX',
        familyId: 1,
      },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
  quoteResponses: [],
};

const SYNTHETIC_FAMILIES = 32;

function syntheticName(i: number): string {
  return `Família Sintética ${String(i).padStart(3, '0')}`;
}

const suppliersFixture = [
  { id: 1, name: 'Fornecedor Monômero', status: 'active', families: [{ id: 1, name: 'Monômero' }] },
  ...Array.from({ length: SYNTHETIC_FAMILIES }, (_, idx) => {
    const i = idx + 1;
    return {
      id: 100 + i,
      name: `Fornecedor Sintético ${String(i).padStart(3, '0')}`,
      status: 'active',
      families: [{ id: 200 + i, name: syntheticName(i) }],
    };
  }),
  { id: 999, name: 'Fornecedor Sem Família', status: 'active', families: [] },
];

const getImpl = async (path: string): Promise<unknown> => {
  if (path.startsWith('/v1/quote-requests/')) return quoteFixture;
  if (path === '/api/v1/company-profile') return { dispatchCc: [] };
  if (path === '/v1/item-families') {
    return { data: [{ id: 1, name: 'Monômero', isActive: true }] };
  }
  if (path === '/v1/suppliers') return suppliersFixture;
  if (path === '/v1/supplier-contacts') return { bySupplier: {} };
  return [];
};

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

function folderButton(folders: Element, nome: string): HTMLButtonElement {
  const found = Array.from(folders.querySelectorAll<HTMLButtonElement>('button.folder')).find(
    (b) => b.firstChild?.textContent?.trim() === nome,
  );
  if (!found) throw new Error(`pasta "${nome}" não encontrada`);
  return found;
}

const css = readFileSync(resolve(import.meta.dirname, '../styles/globals.css'), 'utf8');

describe('Modal de envio: coluna de pastas', () => {
  it('renderiza a coluna dentro do master-detail, com contadores e seleção única', async () => {
    vi.mocked(api.get).mockImplementation(getImpl as never);
    const { container, getByRole } = renderPage();
    await waitFor(() => getByRole('button', { name: 'Enviar cotacao' }));
    fireEvent.click(getByRole('button', { name: 'Enviar cotacao' }));
    const dialog = dialogByTitle(container, 'Enviar cotação para fornecedores');
    await waitFor(() => {
      const f = dialog.querySelector('.dispatcher-folders');
      expect(f).not.toBeNull();
      expect(f?.querySelectorAll('button.folder').length).toBe(35);
    });

    expect(dialog.querySelector('.dispatcher-master-detail > .dispatcher-folders')).not.toBeNull();
    const folders = dialog.querySelector('.dispatcher-folders') as HTMLElement;
    const text = folders.textContent ?? '';
    for (const label of ['Pastas', 'Famílias desta cotação', 'Outras famílias', 'Sem família']) {
      expect(text).toContain(label);
    }

    const todos = folders.querySelector('button.folder') as HTMLButtonElement;
    expect(todos.querySelector('.fcount')?.textContent).toBe('34');
    expect(todos.className).toContain('folder--on');

    const alvo = folderButton(folders, 'Família Sintética 017');
    expect(alvo.querySelector('.fcount')?.textContent).toBe('1');
    expect(folderButton(folders, 'Sem família').querySelector('.fcount')?.textContent).toBe('1');

    fireEvent.click(alvo);
    await waitFor(() => expect(alvo.className).toContain('folder--on'));
    expect(todos.className).not.toContain('folder--on');
    expect(folders.querySelectorAll('.folder--on').length).toBe(1);
    expect(dialog.textContent).toContain('Fornecedores · Família Sintética 017');
  });

  it('CSS: coluna de pastas tem teto de altura, scroll interno e rótulo fixo', () => {
    const base = /\n\.dispatcher-folders \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(base).toContain('max-height: 420px');
    expect(base).toContain('min-height: 0');
    expect(base).toContain('overflow-y: auto');

    const label = /\n\.dispatcher-folders__label \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(label).toContain('position: sticky');
    expect(label).toContain('top: -12px');
    expect(label).toContain('padding: 14px 6px 6px');
    expect(label).toContain('background: var(--surface-muted)');

    expect(css).toMatch(/\.dispatcher-folders > \* \{\s*flex-shrink: 0;\s*\}/);

    const mediaBlocks = css.match(/@media \(max-width: 720px\) \{[\s\S]*?\n\}/g) ?? [];
    const mobile = mediaBlocks.find((b) =>
      b.includes('.dispatcher-master-detail { grid-template-columns: 1fr; }'),
    );
    expect(mobile).toBeDefined();
    expect(mobile).toMatch(/\.dispatcher-folders \{[^}]*max-height: 220px/);
  });
});
