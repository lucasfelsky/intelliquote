import { useState, type KeyboardEvent } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { Icon } from '@/components/icons';
import { ForecastToast, useToastForecast } from '@/pages/Forecast/ForecastToast';
import { listIndentSuppliers, type IndentSupplier, type IndentSupplierType } from '@/services/indent';
import IndentFornecedorModal from './IndentFornecedorModal';
import IndentImportModal from './IndentImportModal';

// IQ Indent: Fornecedores (mock v5, viewFornecedores). Cadastro PROPRIO do Indent. A coluna "Em aberto" do mock depende das cotacoes (PR 3) e fica de fora.

const ESCRITA = ['admin', 'comprador', 'gestor'];
const PAGE_SIZE = 100;

const TIPO: Record<IndentSupplierType, string> = {
  FABRICANTE: 'Fabricante',
  TRADING: 'Trading',
  IMPORTADO: 'Importado',
};

function messageOf(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body as { message?: unknown } | null;
    if (body && typeof body.message === 'string') return body.message;
    return err.message;
  }
  return err instanceof Error ? err.message : 'Erro desconhecido.';
}

// Tag do produto: as 2 primeiras palavras do nome (mock).
function nomeCurto(nome: string): string {
  return nome.split(' ').slice(0, 2).join(' ');
}

export default function IndentFornecedores() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const canWrite = ESCRITA.includes(user?.role ?? '');
  const { toast, mostrar, fechar } = useToastForecast();

  const [page, setPage] = useState(1);
  // undefined = fechado; null = novo fornecedor; objeto = editar.
  const [modal, setModal] = useState<IndentSupplier | null | undefined>(undefined);
  const [importAberto, setImportAberto] = useState(false);

  const fornecedores = useQuery({
    queryKey: ['indent', 'suppliers', { page }],
    queryFn: () => listIndentSuppliers({ page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });

  const linhas = fornecedores.data?.data ?? [];
  const totalPaginas = fornecedores.data?.pagination.totalPages ?? 1;

  function abrir(fornecedor: IndentSupplier) {
    if (canWrite) setModal(fornecedor);
  }

  function aoTeclar(event: KeyboardEvent<HTMLTableRowElement>, fornecedor: IndentSupplier) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      abrir(fornecedor);
    }
  }

  return (
    <div className="page indent-page indent-fornecedores-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Indent</p>
          <h1>Fornecedores</h1>
          <p className="page-subtitle">
            Cadastro próprio do Indent. Mostra quais clientes aprovam ou bloqueiam cada fornecedor.
          </p>
        </div>
        {canWrite && (
          <div className="page-header__actions">
            <button type="button" className="ghost-button" onClick={() => setImportAberto(true)}>
              Importar do IntelliQuote
            </button>
            <button type="button" className="primary-button" onClick={() => setModal(null)}>
              <Icon name="plus" size={18} strokeWidth={2.4} />
              Novo fornecedor
            </button>
          </div>
        )}
      </header>

      {canWrite && <p className="indent-cell-sub indent-dica">Clique em um fornecedor para editar os dados e a parceria.</p>}

      {fornecedores.isError && (
        <div role="alert" className="alert alert--error">
          Não foi possível carregar os fornecedores: {messageOf(fornecedores.error)}
        </div>
      )}

      <div className="indent-tabela-caixa">
        <div className="table-wrapper">
          <table className="table indent-tabela">
            <thead>
              <tr>
                <th>Fornecedor</th>
                <th>Parceria</th>
                <th>Contato</th>
                <th>Produtos</th>
                <th className="indent-num">Moeda · incoterm</th>
                <th>Clientes</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((fornecedor) => {
                const aprovado = fornecedor.approvedBy ?? 0;
                const bloqueado = fornecedor.blockedBy ?? 0;
                const produtos = fornecedor.products;
                return (
                  <tr
                    key={fornecedor.id}
                    className={canWrite ? 'indent-linha-clicavel' : undefined}
                    tabIndex={canWrite ? 0 : undefined}
                    onClick={canWrite ? () => abrir(fornecedor) : undefined}
                    onKeyDown={canWrite ? (event) => aoTeclar(event, fornecedor) : undefined}
                  >
                    <td>
                      <div className="indent-cell-main">
                        <span>{fornecedor.name}</span>
                        <span className="indent-cell-sub">
                          {fornecedor.country ?? '—'} · {TIPO[fornecedor.type]}
                        </span>
                      </div>
                    </td>
                    <td>
                      {fornecedor.hasPartnership ? (
                        <span className="indent-tag indent-tag--ok">
                          <Icon name="check" size={11} strokeWidth={2.6} />
                          Parceria firmada
                        </span>
                      ) : (
                        <span className="indent-tag">
                          <Icon name="lock" size={11} strokeWidth={2.2} />
                          Sem parceria
                        </span>
                      )}
                    </td>
                    <td>{fornecedor.contactName ?? '—'}</td>
                    <td>
                      {produtos.length === 0 ? (
                        <span className="indent-cell-sub">—</span>
                      ) : (
                        <div className="indent-tag-row">
                          {produtos.slice(0, 3).map((produto) => (
                            <span key={produto.id} className="indent-tag">
                              {nomeCurto(produto.name)}
                            </span>
                          ))}
                          {produtos.length > 3 && <span className="indent-tag">+{produtos.length - 3}</span>}
                        </div>
                      )}
                    </td>
                    <td className="indent-num">
                      {fornecedor.defaultCurrency} · {fornecedor.defaultIncoterm}
                    </td>
                    <td>
                      {aprovado === 0 && bloqueado === 0 ? (
                        <span className="indent-cell-sub">—</span>
                      ) : (
                        <div className="indent-tag-row">
                          {aprovado > 0 && <span className="indent-tag indent-tag--ok">Aprovado por {aprovado}</span>}
                          {bloqueado > 0 && <span className="indent-tag indent-tag--lock">Bloqueado por {bloqueado}</span>}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {fornecedores.isLoading && (
          <div className="indent-vazio" role="status">
            Carregando fornecedores…
          </div>
        )}
        {!fornecedores.isLoading && !fornecedores.isError && linhas.length === 0 && (
          <div className="indent-vazio">Nenhum fornecedor cadastrado.</div>
        )}
      </div>

      {totalPaginas > 1 && (
        <nav className="indent-paginacao" aria-label="Paginação">
          <button type="button" className="ghost-button ghost-button--sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Anterior
          </button>
          <span className="indent-cell-sub">
            Página {page} de {totalPaginas}
          </span>
          <button
            type="button"
            className="ghost-button ghost-button--sm"
            disabled={page >= totalPaginas}
            onClick={() => setPage(page + 1)}
          >
            Próxima
          </button>
        </nav>
      )}

      {modal !== undefined && (
        <IndentFornecedorModal
          supplier={modal}
          onClose={() => setModal(undefined)}
          onSaved={(mensagem) => {
            setModal(undefined);
            void qc.invalidateQueries({ queryKey: ['indent'] });
            mostrar('salvo', mensagem, '');
          }}
        />
      )}

      {importAberto && (
        <IndentImportModal
          kind="fornecedores"
          onClose={() => setImportAberto(false)}
          onImported={(mensagem) => {
            setImportAberto(false);
            void qc.invalidateQueries({ queryKey: ['indent'] });
            mostrar('salvo', mensagem, '');
          }}
        />
      )}

      {toast && <ForecastToast key={toast.id} dados={toast} onFechar={fechar} />}
    </div>
  );
}
