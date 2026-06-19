import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from '@/auth/AuthProvider';
import LoginGate from '@/pages/LoginGate';
import AppShell from '@/components/AppShell';
import Home from '@/pages/Home';
import Fornecedores from '@/pages/Fornecedores';
import Usuarios from '@/pages/Usuarios';
import Empresa from '@/pages/Empresa';
import Cotacoes from '@/pages/Cotacoes';
import CotacaoNova from '@/pages/CotacaoNova';
import CotacaoDetalhe from '@/pages/CotacaoDetalhe';
import Itens from '@/pages/Itens';
import Respostas from '@/pages/Respostas';
import Comparacoes from '@/pages/Comparacoes';
import Relatorios from '@/pages/Relatorios';
import Ajuda from '@/pages/Ajuda';
import Auditoria from '@/pages/Auditoria';

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

function LoadingShell() {
  return (
    <div className="spinner spinner--fullscreen">
      <div className="spinner" />
    </div>
  );
}

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

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<RedirectIfAuthed />}>
              <Route path="/login" element={<LoginGate />} />
            </Route>
            <Route element={<RequireAuth />}>
              <Route element={<AppShell />}>
                <Route path="/" element={<Home />} />
                <Route path="/fornecedores" element={<Fornecedores />} />
                <Route path="/usuarios" element={<Usuarios />} />
                <Route path="/empresa" element={<Empresa />} />
                <Route path="/cotacoes" element={<Cotacoes />} />
                                <Route path="/cotacoes/nova" element={<CotacaoNova />} />
                                <Route path="/cotacoes/:id" element={<CotacaoDetalhe />} />
                <Route path="/itens" element={<Itens />} />
                <Route path="/respostas" element={<Respostas />} />
                <Route path="/comparacoes" element={<Comparacoes />} />
                <Route path="/relatorios" element={<Relatorios />} />
                <Route path="/ajuda" element={<Ajuda />} />
                <Route path="/auditoria" element={<Auditoria />} />
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
