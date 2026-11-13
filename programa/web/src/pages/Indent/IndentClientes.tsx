import { FormEvent, useMemo, useState, type KeyboardEvent } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { Icon } from '@/components/icons';
import { Modal } from '@/components/Modal';
import { ForecastToast, useToastForecast } from '@/pages/Forecast/ForecastToast';
import {
  createIndentClient,
  listIndentClients,
  listIndentSupplierOptions,
  setIndentClientRule,
  type IndentClient,
  type IndentRuleMode,
} from '@/services/indent';
import { formatCnpj, isValidCnpj, maskCnpjInput, normalizeCnpj } from './cnpj';

// IQ Indent: Clientes (mock v5, viewClientes + openCli + openSimple "Novo cliente"). Cada cliente define de quais fornecedores aceita receber cotacao.

const ESCRITA = ['admin', 'comprador', 'gestor'];
const PAGE_SIZE = 100;

const MODOS: ReadonlyArray<{ valor: IndentRuleMode; titulo: string; texto: string }> = [
  { valor: 'LIVRE', titulo: 'Sem restrição', texto: 'Pode receber cotação de qualquer fornecedor.' },
  { valor: 'APROVADOS', titulo: 'Somente fornecedores aprovados', texto: 'Só os fornecedores da lista abaixo aparecem para este cliente.' },
  { valor: 'BLOQUEIO', titulo: 'Todos, exceto bloqueados', texto: 'Qualquer fornecedor, menos os da lista abaixo.' },
];

const ROTULO_MODO: Record<IndentRuleMode, { texto: string; tom: 'muted' | 'warning' | 'danger' }> = {
  LIVRE: { texto: 'Sem restrição', tom: 'muted' },
  APROVADOS: { texto: 'Só aprovados', tom: 'warning' },
  BLOQUEIO: { texto: 'Bloqueios', tom: 'danger' },
};

function messageOf(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body as { message?: unknown } | null;
    if (body && typeof body.message === 'string') return body.message;
    return err.message;
  }
  return err instanceof Error ? err.message : 'Erro desconhecido.';
}

function toNullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export default function IndentClientes() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const canWrite = ESCRITA.includes(user?.role ?? '');
  const { toast, mostrar, fechar } = useToastForecast();

  const [page, setPage] = useState(1);
  const [restricao, setRestricao] = useState<IndentClient | null>(null);
  const [novoAberto, setNovoAberto] = useState(false);

  const clientes = useQuery({
    queryKey: ['indent', 'clients', { page }],
    queryFn: () => listIndentClients({ page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });

  const linhas = clientes.data?.data ?? [];
  const totalPaginas = clientes.data?.pagination.totalPages ?? 1;

  function abrir(cliente: IndentClient) {
    if (canWrite) setRestricao(cliente);
  }

  function aoTeclar(event: KeyboardEvent<HTMLTableRowElement>, cliente: IndentClient) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      abrir(cliente);
    }
  }

  return (
    <div className="page indent-page indent-clientes-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Indent</p>
          <h1>Clientes</h1>
          <p className="page-subtitle">Cadastro próprio. Cada cliente define de quais fornecedores aceita receber cotação.</p>
        </div>
        {canWrite && (
          <div className="page-header__actions">
            <button type="button" className="primary-button" onClick={() => setNovoAberto(true)}>
              <Icon name="plus" size={18} strokeWidth={2.4} />
              Novo cliente
            </button>
          </div>
        )}
      </header>

      {canWrite && <p className="indent-cell-sub indent-dica">Clique em um cliente para editar a restrição.</p>}

      {clientes.isError && (
        <div role="alert" className="alert alert--error">
          Não foi possível carregar os clientes: {messageOf(clientes.error)}
        </div>
      )}

      <div className="indent-tabela-caixa">
        <div className="table-wrapper">
          <table className="table indent-tabela">
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Restrição</th>
                <th>Fornecedores</th>
                <th>Responsável</th>
                <th>Pipedrive</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((cliente) => {
                const modo = ROTULO_MODO[cliente.supplierRuleMode];
                const restrito = cliente.supplierRuleMode !== 'LIVRE';
                return (
                  <tr
                    key={cliente.id}
                    className={canWrite ? 'indent-linha-clicavel' : undefined}
                    tabIndex={canWrite ? 0 : undefined}
                    onClick={canWrite ? () => abrir(cliente) : undefined}
                    onKeyDown={canWrite ? (event) => aoTeclar(event, cliente) : undefined}
                  >
                    <td>
                      <div className="indent-cell-main">
                        <span>{cliente.name}</span>
                        <span className="indent-cell-sub">{[formatCnpj(cliente.cnpj), cliente.city].filter(Boolean).join(' · ')}</span>
                      </div>
                    </td>
                    <td>
                      <span className={`badge badge--${modo.tom}`}>
                        {restrito && <Icon name="lock" size={12} strokeWidth={2.2} />}
                        {modo.texto}
                      </span>
                    </td>
                    <td>
                      {restrito ? (
                        <div className="indent-tag-row">
                          {cliente.supplierRules.map((regra) => (
                            <span
                              key={regra.supplierId}
                              className={`indent-tag ${cliente.supplierRuleMode === 'APROVADOS' ? 'indent-tag--ok' : 'indent-tag--lock'}`}
                            >
                              {regra.supplier.name.split(' ')[0]}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="indent-cell-sub">Qualquer fornecedor</span>
                      )}
                    </td>
                    <td>{cliente.ownerName ?? '—'}</td>
                    <td>
                      {cliente.pipedriveOrgId !== null ? (
                        <span className="indent-tag indent-tag--pd">Org #{cliente.pipedriveOrgId}</span>
                      ) : (
                        <span className="indent-cell-sub">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {clientes.isLoading && (
          <div className="indent-vazio" role="status">
            Carregando clientes…
          </div>
        )}
        {!clientes.isLoading && !clientes.isError && linhas.length === 0 && (
          <div className="indent-vazio">Nenhum cliente cadastrado.</div>
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

      {restricao && (
        <RestricaoModal
          cliente={restricao}
          onClose={() => setRestricao(null)}
          onSaved={(nome) => {
            setRestricao(null);
            void qc.invalidateQueries({ queryKey: ['indent'] });
            mostrar('salvo', `Restrição de ${nome.split(' ').slice(0, 3).join(' ')} atualizada`, '');
          }}
        />
      )}

      {novoAberto && (
        <NovoClienteModal
          onClose={() => setNovoAberto(false)}
          onSaved={(nome) => {
            setNovoAberto(false);
            void qc.invalidateQueries({ queryKey: ['indent'] });
            mostrar('salvo', `Cliente ${nome} cadastrado`, '');
          }}
        />
      )}

      {toast && <ForecastToast key={toast.id} dados={toast} onFechar={fechar} />}
    </div>
  );
}

interface RestricaoModalProps {
  cliente: IndentClient;
  onClose: () => void;
  onSaved: (nome: string) => void;
}

// openCli: modo + lista de fornecedores + motivo. Trocar de modo preserva o motivo digitado e a lista marcada.
function RestricaoModal({ cliente, onClose, onSaved }: RestricaoModalProps) {
  const [modo, setModo] = useState<IndentRuleMode>(cliente.supplierRuleMode);
  const [escolhidos, setEscolhidos] = useState<Set<number>>(() => new Set(cliente.supplierRules.map((regra) => regra.supplierId)));
  const [motivo, setMotivo] = useState(cliente.ruleReason ?? '');
  const [erroLista, setErroLista] = useState<string | null>(null);
  const [erroMotivo, setErroMotivo] = useState<string | null>(null);
  const [erroForm, setErroForm] = useState<string | null>(null);

  const opcoes = useQuery({ queryKey: ['indent', 'suppliers', 'options'], queryFn: listIndentSupplierOptions });

  // Ativos (options) + os que ja estao marcados na regra (inclusive inativos: a regra continua valida).
  const fornecedores = useMemo(() => {
    const porId = new Map<number, { id: number; nome: string; pais: string | null }>();
    for (const fornecedor of opcoes.data ?? []) porId.set(fornecedor.id, { id: fornecedor.id, nome: fornecedor.name, pais: fornecedor.country });
    for (const regra of cliente.supplierRules) {
      if (!porId.has(regra.supplierId)) porId.set(regra.supplierId, { id: regra.supplierId, nome: regra.supplier.name, pais: null });
    }
    return Array.from(porId.values()).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }, [opcoes.data, cliente.supplierRules]);

  const salvar = useMutation({
    mutationFn: () =>
      setIndentClientRule(
        cliente.id,
        modo === 'LIVRE'
          ? { mode: 'LIVRE', supplierIds: [] }
          : { mode: modo, supplierIds: Array.from(escolhidos), reason: motivo.trim() },
      ),
    onSuccess: () => onSaved(cliente.name),
    onError: (err) => setErroForm(messageOf(err)),
  });

  function alternar(id: number, marcado: boolean) {
    setEscolhidos((atual) => {
      const proximo = new Set(atual);
      if (marcado) proximo.add(id);
      else proximo.delete(id);
      return proximo;
    });
    setErroLista(null);
  }

  function enviar(event: FormEvent) {
    event.preventDefault();
    setErroForm(null);
    if (modo !== 'LIVRE') {
      const semLista = escolhidos.size === 0;
      const semMotivo = motivo.trim().length === 0;
      setErroLista(semLista ? 'Escolha ao menos um fornecedor na lista' : null);
      setErroMotivo(semMotivo ? 'Informe o motivo da restrição.' : null);
      if (semLista || semMotivo) return;
    }
    salvar.mutate();
  }

  return (
    <Modal isOpen onClose={onClose} title={cliente.name} eyebrow="Restrição de fornecedores">
      <form onSubmit={enviar} noValidate className="indent-form">
        {erroForm && (
          <div role="alert" className="alert alert--error">
            {erroForm}
          </div>
        )}

        <div className="indent-opcoes" role="radiogroup" aria-label="Modo de restrição">
          {MODOS.map((opcao) => (
            <label key={opcao.valor} className={`indent-opcao${modo === opcao.valor ? ' is-selected' : ''}`}>
              <input
                type="radio"
                name="modo"
                value={opcao.valor}
                checked={modo === opcao.valor}
                data-autofocus={modo === opcao.valor ? '' : undefined}
                onChange={() => setModo(opcao.valor)}
              />
              <strong>{opcao.titulo}</strong>
              <span>{opcao.texto}</span>
            </label>
          ))}
        </div>

        {modo !== 'LIVRE' && (
          <>
            <div className="indent-lista-fornecedores" role="group" aria-labelledby="ic-lista-rotulo">
              <span className="field-label" id="ic-lista-rotulo">
                {modo === 'APROVADOS' ? 'Fornecedores aprovados' : 'Fornecedores bloqueados'}
              </span>
              {opcoes.isLoading && (
                <div className="indent-vazio" role="status">
                  Carregando fornecedores…
                </div>
              )}
              {opcoes.isError && (
                <div className="indent-vazio" role="alert">
                  Não foi possível carregar os fornecedores: {messageOf(opcoes.error)}
                </div>
              )}
              {fornecedores.map((fornecedor) => (
                <div key={fornecedor.id} className="indent-check">
                  <label>
                    <input
                      type="checkbox"
                      checked={escolhidos.has(fornecedor.id)}
                      onChange={(event) => alternar(fornecedor.id, event.target.checked)}
                    />
                    <span>{fornecedor.nome}</span>
                    {fornecedor.pais && <span className="indent-cell-sub">{fornecedor.pais}</span>}
                  </label>
                </div>
              ))}
              {erroLista && (
                <p className="field-error" role="alert">
                  {erroLista}
                </p>
              )}
            </div>

            <div className="field">
              <label className="field-label" htmlFor="ic-motivo">
                Motivo da restrição
              </label>
              <textarea
                id="ic-motivo"
                className="input"
                rows={3}
                placeholder="Por que este cliente restringe fornecedores?"
                value={motivo}
                aria-invalid={erroMotivo ? true : undefined}
                onChange={(event) => {
                  setMotivo(event.target.value);
                  setErroMotivo(null);
                }}
              />
              <span className="field-hint">Aparece para quem montar a cotação.</span>
              {erroMotivo && (
                <p className="field-error" role="alert">
                  {erroMotivo}
                </p>
              )}
            </div>
          </>
        )}

        <div className="alert alert--info">A regra vale para solicitações do Pipedrive e do IQ Indent.</div>

        <div className="modal-actions">
          <button type="button" className="ghost-button" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="primary-button" disabled={salvar.isPending}>
            Salvar restrição
          </button>
        </div>
      </form>
    </Modal>
  );
}

interface NovoClienteModalProps {
  onClose: () => void;
  onSaved: (nome: string) => void;
}

// openSimple('Novo cliente'): Razao social, CNPJ e Cidade. CNPJ com mascara ao digitar e a mesma validacao do backend antes de enviar.
function NovoClienteModal({ onClose, onSaved }: NovoClienteModalProps) {
  const [nome, setNome] = useState('');
  const [cnpj, setCnpj] = useState('');
  const [cidade, setCidade] = useState('');
  const [erroNome, setErroNome] = useState<string | null>(null);
  const [erroCnpj, setErroCnpj] = useState<string | null>(null);
  const [erroForm, setErroForm] = useState<string | null>(null);

  const salvar = useMutation({
    mutationFn: () => createIndentClient({ name: nome.trim(), cnpj: normalizeCnpj(cnpj), city: toNullable(cidade) }),
    onSuccess: (cliente) => onSaved(cliente.name),
    onError: (err) => setErroForm(messageOf(err)),
  });

  function enviar(event: FormEvent) {
    event.preventDefault();
    setErroForm(null);
    const semNome = nome.trim().length === 0;
    const cnpjInvalido = !isValidCnpj(cnpj);
    setErroNome(semNome ? 'Informe a razão social.' : null);
    setErroCnpj(cnpjInvalido ? 'CNPJ inválido.' : null);
    if (semNome || cnpjInvalido) return;
    salvar.mutate();
  }

  return (
    <Modal isOpen onClose={onClose} title="Novo cliente">
      <form onSubmit={enviar} noValidate className="indent-form">
        {erroForm && (
          <div role="alert" className="alert alert--error">
            {erroForm}
          </div>
        )}
        <div className="indent-campos">
          <div className="field">
            <label className="field-label" htmlFor="nc-nome">
              Razão social
            </label>
            <input
              id="nc-nome"
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
            <label className="field-label" htmlFor="nc-cnpj">
              CNPJ
            </label>
            <input
              id="nc-cnpj"
              className="input"
              inputMode="numeric"
              autoComplete="off"
              value={cnpj}
              aria-invalid={erroCnpj ? true : undefined}
              onChange={(event) => setCnpj(maskCnpjInput(event.target.value))}
            />
            {erroCnpj && (
              <p className="field-error" role="alert">
                {erroCnpj}
              </p>
            )}
          </div>
          <div className="field">
            <label className="field-label" htmlFor="nc-cidade">
              Cidade
            </label>
            <input id="nc-cidade" className="input" value={cidade} onChange={(event) => setCidade(event.target.value)} />
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
