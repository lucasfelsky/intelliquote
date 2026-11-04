import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Navigate, Route, Routes } from 'react-router-dom';
import ComercialRouteGuard from './ComercialRouteGuard';

let mockRole = 'comercial';
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, name: 'U', email: 'u@b.c', role: mockRole } }),
}));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<ComercialRouteGuard />}>
          <Route path="/" element={<div>pagina-home</div>} />
          <Route path="/cotacoes" element={<div>pagina-cotacoes</div>} />
          <Route path="/solicitacoes" element={<div>pagina-solicitacoes</div>} />
          <Route path="/manual" element={<div>pagina-manual</div>} />
          <Route path="/ajuda" element={<Navigate to="/manual" replace />} />
          <Route path="/manualx" element={<div>pagina-manualx</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('ComercialRouteGuard', () => {
  it('comercial em /cotacoes e redirecionado para /solicitacoes', () => {
    mockRole = 'comercial';
    renderAt('/cotacoes');
    expect(screen.getByText('pagina-solicitacoes')).toBeTruthy();
    expect(screen.queryByText('pagina-cotacoes')).toBeNull();
  });

  it('comercial em / e redirecionado para /solicitacoes', () => {
    mockRole = 'comercial';
    renderAt('/');
    expect(screen.getByText('pagina-solicitacoes')).toBeTruthy();
    expect(screen.queryByText('pagina-home')).toBeNull();
  });

  it('comercial em /solicitacoes permanece', () => {
    mockRole = 'comercial';
    renderAt('/solicitacoes');
    expect(screen.getByText('pagina-solicitacoes')).toBeTruthy();
  });

  it('comercial em /manual permanece', () => {
    mockRole = 'comercial';
    renderAt('/manual');
    expect(screen.getByText('pagina-manual')).toBeTruthy();
  });

  it('comercial em /manual/ (barra final) permanece', () => {
    mockRole = 'comercial';
    renderAt('/manual/');
    expect(screen.getByText('pagina-manual')).toBeTruthy();
  });

  it('comercial em /ajuda chega a /manual (o guard libera o caminho que so redireciona)', () => {
    mockRole = 'comercial';
    renderAt('/ajuda');
    expect(screen.getByText('pagina-manual')).toBeTruthy();
  });

  it('comercial em /manualx volta a /solicitacoes (so /manual e liberado, nao o prefixo)', () => {
    mockRole = 'comercial';
    renderAt('/manualx');
    expect(screen.getByText('pagina-solicitacoes')).toBeTruthy();
    expect(screen.queryByText('pagina-manualx')).toBeNull();
  });

  it('comprador em /manual permanece', () => {
    mockRole = 'comprador';
    renderAt('/manual');
    expect(screen.getByText('pagina-manual')).toBeTruthy();
  });

  it('comprador em /cotacoes permanece', () => {
    mockRole = 'comprador';
    renderAt('/cotacoes');
    expect(screen.getByText('pagina-cotacoes')).toBeTruthy();
  });
});
