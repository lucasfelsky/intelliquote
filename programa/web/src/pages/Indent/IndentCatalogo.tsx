import { FormEvent, useEffect, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { Icon } from '@/components/icons';
import { Modal } from '@/components/Modal';
import { ForecastToast, useToastForecast } from '@/pages/Forecast/ForecastToast';
import {
  createIndentProduct,
  listIndentProducts,
  promoteIndentProduct,
  type IndentProduct,
  type IndentProductOrigin,
} from '@/services/indent';
import IndentImportModal from './IndentImportModal';

// IQ Indent: Catalogo (mock v5, viewCatalogo + openSimple "Novo produto" + openImport). Cadastro PROPRIO do Indent, separado do IntelliQuote.

const ESCRITA = ['admin', 'comprador', 'gestor'];
const CAS = /^\d{2,7}-\d{2}-\d$/;
const PAGE_SIZE = 100;

type Filtro = 'todos' | IndentProductOrigin;

const FILTROS: ReadonlyArray<{ id: Filtro; rotulo: string; conta: 'total' | 'cadastrado' | 'livre' }> = [
  { id: 'todos', rotulo: 'Todos', conta: 'total' },
  { id: 'CADASTRADO', rotulo: 'Cadastrados', conta: 'cadastrado' },
  { id: 'LIVRE', rotulo: 'Digitados à mão', conta: 'livre' },
];

function messageOf(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body as { message?: unknown } | null;
    if (body && typeof body.message === 'string') return body.message;
    return err.message;
  }
  return err instanceof Error ? err.message : 'Erro desconhecido.';
}

function subLinha(produto: IndentProduct): string {
  if (produto.origin === 'LIVRE' && produto.sourceRequestNumber) {
    return `Digitado na solicitação ${produto.sourceRequestNumber}`;
  }
  return produto.notes ?? '';
}

function toNullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export default function IndentCatalogo() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const canWrite = ESCRITA.includes(user?.role ?? '');
  const { toast, mostrar, fechar } = useToastForecast();

  const [busca, setBusca] = useState('');
  const [q, setQ] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [page, setPage] = useState(1);
  const [novoAberto, setNovoAberto] = useState(false);
  const [importAberto, setImportAberto] = useState(false);
  const [erroAcao, setErroAcao] = useState<string | null>(null);

  // A busca vai ao servidor (o catalogo pode ter mais de uma pagina); o atraso evita uma chamada por tecla.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQ(busca.trim());
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [busca]);

  const produtos = useQuery({
    queryKey: ['indent', 'products', { q, filtro, page }],
    queryFn: () =>
      listIndentProducts({ q, origin: filtro === 'todos' ? undefined : filtro, page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });

  const promover = useMutation({
    mutationFn: (id: number) => promoteIndentProduct(id),
    onSuccess: (produto) => {
      setErroAcao(null);
      void qc.invalidateQueries({ queryKey: ['indent'] });
      mostrar('salvo', `“${produto.name}” agora faz parte do catálogo`, '');
    },
    onError: (err) => setErroAcao(messageOf(err)),
  });

  const linhas = produtos.data?.data ?? [];
  const contas = produtos.data?.counts;
  const totalPaginas = produtos.data?.pagination.totalPages ?? 1;

  return (
    <div className="page indent-page indent-catalogo-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Indent</p>
          <h1>Catálogo</h1>
          <p className="page-subtitle">
            Catálogo próprio do Indent, separado do IntelliQuote. Aceita item digitado à mão, sem cadastro.
          </p>
        </div>
        {canWrite && (
          <div className="page-header__actions">
            <button type="button" className="ghost-button" onClick={() => setImportAberto(true)}>
              Importar do IntelliQuote
            </button>
            <button type="button" className="primary-button" onClick={() => setNovoAberto(true)}>
              <Icon name="plus" size={18} strokeWidth={2.4} />
              Novo produto
            </button>
          </div>
        )}
      </header>

      <div className="indent-toolbar">
        <label className="indent-busca">
          <Icon name="search" size={18} />
          <span className="sr-only">Buscar produto</span>
          <input
            className="indent-busca__campo"
            type="search"
            placeholder="Buscar por nome ou CAS"
            value={busca}
            onChange={(event) => setBusca(event.target.value)}
          />
        </label>
        <div className="indent-chips" role="group" aria-label="Filtrar por origem">
          {FILTROS.map((item) => {
            const ativo = filtro === item.id;
            return (
              <button
                key={item.id}
                type="button"
                className={`chip${ativo ? ' chip--active' : ''}`}
                aria-pressed={ativo}
                onClick={() => {
                  setFiltro(item.id);
                  setPage(1);
                }}
              >
                {item.rotulo}{' '}
                <span className="indent-chip-conta">{(contas?.[item.conta] ?? 0).toLocaleString('pt-BR')}</span>
              </button>
            );
          })}
        </div>
      </div>

      {erroAcao && (
        <div role="alert" className="alert alert--error">
          {erroAcao}
        </div>
      )}

      {produtos.isError && (
        <div role="alert" className="alert alert--error">
          Não foi possível carregar o catálogo: {messageOf(produtos.error)}
        </div>
      )}

      <div className="indent-tabela-caixa">
        <div className="table-wrapper">
          <table className="table indent-tabela">
            <thead>
              <tr>
                <th>Produto</th>
                <th>CAS</th>
                <th>Un.</th>
                <th>Origem</th>
                <th className="indent-num">Fornecedores</th>
                <th>
                  <span className="sr-only">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((produto) => (
                <tr key={produto.id}>
                  <td>
                    <div className="indent-cell-main">
                      <span>{produto.name}</span>
                      <span className="indent-cell-sub">{subLinha(produto)}</span>
                    </div>
                  </td>
                  <td className="indent-num">{produto.cas ?? <span className="indent-cell-sub">sem CAS</span>}</td>
                  <td>{produto.unit}</td>
                  <td>
                    {produto.origin === 'LIVRE' ? (
                      <span className="indent-tag indent-tag--manual">Digitado à mão</span>
                    ) : (
                      <span className="indent-tag indent-tag--ok">Cadastrado</span>
                    )}
                  </td>
                  <td className="indent-num">{produto.supplierCount.toLocaleString('pt-BR')}</td>
                  <td className="indent-acao">
                    {produto.origin === 'LIVRE' && canWrite && (
                      <button
                        type="button"
                        className="ghost-button ghost-button--sm indent-promover"
                        disabled={promover.isPending}
                        onClick={() => promover.mutate(produto.id)}
                      >
                        Promover ao catálogo
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {produtos.isLoading && (
          <div className="indent-vazio" role="status">
            Carregando catálogo…
          </div>
        )}
        {!produtos.isLoading && !produtos.isError && linhas.length === 0 && (
          <div className="indent-vazio">Nenhum produto com esse filtro.</div>
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

      {novoAberto && (
        <NovoProdutoModal
          onClose={() => setNovoAberto(false)}
          onSaved={(nome) => {
            setNovoAberto(false);
            void qc.invalidateQueries({ queryKey: ['indent'] });
            mostrar('salvo', `Produto ${nome} cadastrado`, '');
          }}
        />
      )}

      {importAberto && (
        <IndentImportModal
          kind="produtos"
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

interface NovoProdutoModalProps {
  onClose: () => void;
  onSaved: (nome: string) => void;
}

// Mock: Nome do produto, CAS (opcional) e Unidade. "Ou melhor": Sigla, Fabricante e Sinonimos opcionais (decisao registrada no plano).
function NovoProdutoModal({ onClose, onSaved }: NovoProdutoModalProps) {
  const [nome, setNome] = useState('');
  const [cas, setCas] = useState('');
  const [unidade, setUnidade] = useState('kg');
  const [sigla, setSigla] = useState('');
  const [fabricante, setFabricante] = useState('');
  const [sinonimos, setSinonimos] = useState('');
  const [erroNome, setErroNome] = useState<string | null>(null);
  const [erroCas, setErroCas] = useState<string | null>(null);
  const [erroForm, setErroForm] = useState<string | null>(null);

  const salvar = useMutation({
    mutationFn: () =>
      createIndentProduct({
        name: nome.trim(),
        cas: toNullable(cas),
        unit: unidade.trim() || 'kg',
        acronym: toNullable(sigla),
        manufacturer: toNullable(fabricante),
        synonyms: sinonimos
          .split(',')
          .map((item) => item.trim())
          .filter((item) => item.length > 0),
      }),
    onSuccess: (produto) => onSaved(produto.name),
    onError: (err) => setErroForm(messageOf(err)),
  });

  function enviar(event: FormEvent) {
    event.preventDefault();
    setErroForm(null);
    const semNome = nome.trim().length === 0;
    const casInvalido = cas.trim().length > 0 && !CAS.test(cas.trim());
    setErroNome(semNome ? 'Informe o nome do produto.' : null);
    setErroCas(casInvalido ? 'CAS inválido.' : null);
    if (semNome || casInvalido) return;
    salvar.mutate();
  }

  return (
    <Modal isOpen onClose={onClose} title="Novo produto">
      <form onSubmit={enviar} noValidate className="indent-form">
        {erroForm && (
          <div role="alert" className="alert alert--error">
            {erroForm}
          </div>
        )}
        <div className="indent-campos">
          <div className="field">
            <label className="field-label" htmlFor="ip-nome">
              Nome do produto
            </label>
            <input
              id="ip-nome"
              className="input"
              data-autofocus
              value={nome}
              aria-invalid={erroNome ? true : undefined}
              onChange={(event) => setNome(event.target.value)}
            />
            {erroNome && (
              <p className="field-error" role="alert">
                {erroNome}
              </p>
            )}
          </div>
          <div className="field">
            <label className="field-label" htmlFor="ip-cas">
              CAS (opcional)
            </label>
            <input
              id="ip-cas"
              className="input"
              value={cas}
              aria-invalid={erroCas ? true : undefined}
              onChange={(event) => setCas(event.target.value)}
            />
            {erroCas && (
              <p className="field-error" role="alert">
                {erroCas}
              </p>
            )}
          </div>
          <div className="field">
            <label className="field-label" htmlFor="ip-unidade">
              Unidade
            </label>
            <input id="ip-unidade" className="input" value={unidade} onChange={(event) => setUnidade(event.target.value)} />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="ip-sigla">
              Sigla
            </label>
            <input id="ip-sigla" className="input" value={sigla} onChange={(event) => setSigla(event.target.value)} />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="ip-fabricante">
              Fabricante
            </label>
            <input id="ip-fabricante" className="input" value={fabricante} onChange={(event) => setFabricante(event.target.value)} />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="ip-sinonimos">
              Sinônimos (separados por vírgula)
            </label>
            <input id="ip-sinonimos" className="input" value={sinonimos} onChange={(event) => setSinonimos(event.target.value)} />
          </div>
        </div>
        <div className="modal-actions">
          <button type="button" className="ghost-button" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="primary-button" disabled={salvar.isPending}>
            Salvar
          </button>
        </div>
      </form>
    </Modal>
  );
}
