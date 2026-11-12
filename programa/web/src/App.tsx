import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from '@/auth/AuthProvider';
import LoginGate from '@/pages/LoginGate';
import LoadingShell from '@/components/LoadingShell';
import AppShell from '@/components/AppShell';
import ComercialRouteGuard from '@/components/ComercialRouteGuard';
import NewVersionBanner from '@/components/NewVersionBanner';
import Home from '@/pages/Home';
import Fornecedores from '@/pages/Fornecedores';
import Forwarders from '@/pages/Forwarders';
import Usuarios from '@/pages/Usuarios';
import Empresa from '@/pages/Empresa';
import Cotacoes from '@/pages/Cotacoes';
import CotacaoNova from '@/pages/CotacaoNova';
import CotacaoDetalhe from '@/pages/CotacaoDetalhe';
import Itens from '@/pages/Itens';
import Familias from '@/pages/Familias';

import Relatorios from '@/pages/Relatorios';
import Manual from '@/pages/Manual';
import Auditoria from '@/pages/Auditoria';
import Templates from '@/pages/Templates';
import MinhaConta from '@/pages/MinhaConta';
import Solicitacoes from '@/pages/Solicitacoes';
import Forecast from '@/pages/Forecast';
import IndentCatalogo from '@/pages/Indent/IndentCatalogo';
import IndentFornecedores from '@/pages/Indent/IndentFornecedores';
import IndentClientes from '@/pages/Indent/IndentClientes';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (count, err) => {
        if (err && typeof err === 'object' && 'status' in err) {
          const s = (err as { status: number }).status;
          if (s === 401 || s === 403 || s === 404) return false;
        }
        return count < 2;
      },
    },
  },
});

function RequireAuth() {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <LoadingShell />;
  if (status === 'unauthenticated') {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return <Outlet />;
}

function RedirectIfAuthed() {
  const { status } = useAuth();
  if (status === 'loading') return <LoadingShell />;
  if (status === 'authenticated') return <Navigate to="/" replace />;
  return <Outlet />;
}

import { ConfirmProvider } from '@/components/useConfirm';

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ConfirmProvider>
        <AuthProvider>
          <BrowserRouter>
            <Routes>
              <Route element={<RedirectIfAuthed />}>
                <Route path="/login" element={<LoginGate />} />
              </Route>
              <Route element={<RequireAuth />}>
                <Route element={<ComercialRouteGuard />}>
                <Route element={<AppShell />}>
                  <Route path="/" element={<Home />} />
                  <Route path="/fornecedores" element={<Fornecedores />} />
                  <Route path="/forwarders" element={<Forwarders />} />
                  <Route path="/usuarios" element={<Usuarios />} />
                  <Route path="/empresa" element={<Empresa />} />
                  <Route path="/cotacoes" element={<Cotacoes />} />
                                  <Route path="/cotacoes/nova" element={<CotacaoNova />} />
                                  <Route path="/cotacoes/:id" element={<CotacaoDetalhe />} />
                  <Route path="/solicitacoes" element={<Solicitacoes />} />
                  <Route path="/itens" element={<Itens />} />
                  <Route path="/familias" element={<Familias />} />
                  <Route path="/respostas" element={<Navigate to="/cotacoes" replace />} />
                  <Route path="/comparacoes" element={<Navigate to="/cotacoes" replace />} />
                  <Route path="/relatorios" element={<Relatorios />} />
                  <Route path="/forecast" element={<Forecast />} />
                  <Route path="/forecast/item/:linha" element={<Forecast />} />
                  <Route path="/indent" element={<Navigate to="/indent/catalogo" replace />} />
                  <Route path="/indent/catalogo" element={<IndentCatalogo />} />
                  <Route path="/indent/fornecedores" element={<IndentFornecedores />} />
                  <Route path="/indent/clientes" element={<IndentClientes />} />
                  <Route path="/manual" element={<Manual />} />
                  <Route path="/ajuda" element={<Navigate to="/manual" replace />} />
                  <Route path="/auditoria" element={<Auditoria />} />
                  <Route path="/templates" element={<Templates />} />
                  <Route path="/minha-conta" element={<MinhaConta />} />
                </Route>
                </Route>
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>
          <NewVersionBanner />
        </AuthProvider>
      </ConfirmProvider>
    </QueryClientProvider>
  );
}
