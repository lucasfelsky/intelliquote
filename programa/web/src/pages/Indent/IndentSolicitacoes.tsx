import { useEffect, useState, type KeyboardEvent } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import { Icon } from '@/components/icons';
import { ForecastToast, useToastForecast } from '@/pages/Forecast/ForecastToast';
import { listIndentRequests, type IndentRequestFilter, type IndentRequestRow } from '@/services/indentRequests';
import {
  filaRotulo,
  formatarDataHora,
  formatarKg,
  mensagemDoErro,
  rotuloRegra,
  statusRotulo,
} from './indentFila';
import IndentNovaSolicitacaoModal from './IndentNovaSolicitacaoModal';
import { useSincronizarPipedrive } from './IndentSolicitacoesPipedrive';

// IQ Indent: Solicitacoes (mock viewSolicitacoes): as lancadas aqui (IQ_INDENT) e as do Pipedrive (botao "Pipedrive · funil · ha N min", alerta com
// "Abrir fila de vinculo" e "Referencia pendente" quando o titulo do negocio nao tem numero).
// "Na fila ha", KPIs e contagens dos chips vem do BACKEND (dias uteis em Sao Paulo; o prazo interno 'slaBusinessDays' tambem).

const ESCRITA = ['admin', 'comprador', 'gestor'];
const PAGE_SIZE = 20;

const CHIPS: ReadonlyArray<{ id: IndentRequestFilter; rotulo: string }> = [
  { id: 'todas', rotulo: 'Todas' },
  { id: 'pipedrive', rotulo: 'Pipedrive' },
  { id: 'iq', rotulo: 'IQ Indent' },
  { id: 'nova', rotulo: 'Novas' },
  { id: 'pendente', rotulo: 'Cliente pendente' },
];

function resumoDosItens(linha: IndentRequestRow): string {
  const { count, totalKg } = linha.itemsSummary;
  const prefixo = count > 1 ? `+ ${count - 1} ${count > 2 ? 'itens' : 'item'} · ` : '';
  return `${prefixo}${formatarKg(totalKg)} kg no total`;
}

export default function IndentSolicitacoes() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const canWrite = ESCRITA.includes(user?.role ?? '');

  const [busca, setBusca] = useState('');
  const [q, setQ] = useState('');
  const [filtro, setFiltro] = useState<IndentRequestFilter>('todas');
  const [page, setPage] = useState(1);
  const [novaAberta, setNovaAberta] = useState(false);
  const { toast, mostrar, fechar } = useToastForecast();
  // Viewer le a lista mas nao sincroniza: sem botao (e sem consulta do estado).
  const pipedrive = useSincronizarPipedrive(canWrite, mostrar);

  // A busca vai ao servidor; o atraso evita uma chamada por tecla.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQ(busca.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [busca]);

  const solicitacoes = useQuery({
    queryKey: ['indent', 'requests', { q, filtro, page }],
    queryFn: () => listIndentRequests({ q, filter: filtro, page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });

  const linhas = solicitacoes.data?.data ?? [];
  const contas = solicitacoes.data?.counts;
  const kpis = solicitacoes.data?.kpis;
  const totalPaginas = solicitacoes.data?.pagination.totalPages ?? 1;
  const pendentes = contas?.pendente ?? 0;
  const prazoInterno = solicitacoes.data?.slaBusinessDays ?? 2;

  const cartoes: ReadonlyArray<{ rotulo: string; valor: number; sub: string }> = [
    { rotulo: 'Novas', valor: kpis?.novas ?? 0, sub: 'Aguardando escolha de fornecedores' },
    { rotulo: 'Em cotação', valor: kpis?.emCotacao ?? 0, sub: 'Com cotações abertas' },
    { rotulo: 'Respondidas', valor: kpis?.respondidas ?? 0, sub: 'Aguardando retorno ao cliente' },
    { rotulo: 'Convertidas no mês', valor: kpis?.convertidasNoMes ?? 0, sub: 'Viraram processo indent' },
  ];

  function abrir(linha: IndentRequestRow) {
    navigate(`/indent/solicitacoes/${linha.id}`);
  }

  function aoTeclar(event: KeyboardEvent<HTMLTableRowElement>, linha: IndentRequestRow) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      abrir(linha);
    }
  }

  return (
    <div className="page indent-page indent-solicitacoes-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Indent</p>
          <h1>Solicitações</h1>
          <p className="page-subtitle">
            Negócios do Funil de Vendas Indent (Pipedrive) e solicitações lançadas aqui, no mesmo lugar.
          </p>
        </div>
        {canWrite && (
          <div className="page-header__actions">
            <button
              type="button"
              className="ghost-button"
              disabled={!pipedrive.configurado}
              aria-disabled={pipedrive.sincronizando ? true : undefined}
              aria-busy={pipedrive.sincronizando ? true : undefined}
              onClick={() => void pipedrive.sincronizar()}
            >
              <Icon name="refresh" size={16} />
              {pipedrive.sincronizando ? 'Sincronizando…' : pipedrive.rotulo}
            </button>
            <button type="button" className="primary-button" onClick={() => setNovaAberta(true)}>
              <Icon name="plus" size={18} strokeWidth={2.4} />
              Nova solicitação
            </button>
          </div>
        )}
      </header>

      {pipedrive.aviso && (
        <div
          role={pipedrive.aviso.tom === 'info' ? 'status' : 'alert'}
          className={`alert alert--${pipedrive.aviso.tom === 'erro' ? 'error' : pipedrive.aviso.tom === 'aviso' ? 'warning' : 'info'}`}
        >
          {pipedrive.aviso.texto}
        </div>
      )}

      {pendentes > 0 && (
        <div className="alert alert--warning indent-alerta">
          <Icon name="lock" size={18} />
          <span className="indent-alerta__texto">
            {pendentes} {pendentes === 1 ? 'solicitação aguarda' : 'solicitações aguardam'} vínculo de cliente antes de cotar.
          </span>
          <button type="button" className="ghost-button" onClick={() => navigate('/indent/integracao')}>
            Abrir fila de vínculo
          </button>
        </div>
      )}

      <div className="indent-kpis">
        {cartoes.map((cartao) => (
          <div key={cartao.rotulo} className="indent-kpi">
            <span className="eyebrow">{cartao.rotulo}</span>
            <span className="indent-kpi__valor">{cartao.valor}</span>
            <span className="indent-kpi__sub">{cartao.sub}</span>
          </div>
        ))}
      </div>

      <div className="indent-toolbar">
        <label className="indent-busca">
          <Icon name="search" size={18} />
          <span className="sr-only">Buscar solicitação</span>
          <input
            className="indent-busca__campo"
            type="search"
            placeholder="Buscar por cliente, item ou número"
            value={busca}
            onChange={(event) => setBusca(event.target.value)}
          />
        </label>
        <div className="indent-chips" role="group" aria-label="Filtrar solicitações">
          {CHIPS.map((chip) => {
            const ativo = filtro === chip.id;
            return (
              <button
                key={chip.id}
                type="button"
                className={`chip${ativo ? ' chip--active' : ''}`}
                aria-pressed={ativo}
                onClick={() => {
                  setFiltro(chip.id);
                  setPage(1);
                }}
              >
                {chip.rotulo} <span className="indent-chip-conta">{(contas?.[chip.id] ?? 0).toLocaleString('pt-BR')}</span>
              </button>
            );
          })}
        </div>
      </div>

      {solicitacoes.isError && (
        <div role="alert" className="alert alert--error">
          Não foi possível carregar as solicitações: {mensagemDoErro(solicitacoes.error)}
        </div>
      )}

      <div className="indent-tabela-caixa">
        <div className="table-wrapper">
          <table className="table indent-tabela">
            <thead>
              <tr>
                <th>Solicitação</th>
                <th>Cliente</th>
                <th>Itens</th>
                <th>Origem</th>
                <th>Responsável</th>
                <th>Na fila há</th>
                <th>Respostas</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((linha) => {
                const fila = filaRotulo(linha.queueBusinessDays, prazoInterno);
                const status = statusRotulo(linha.status, linha.clientPending);
                const regra = linha.client ? rotuloRegra(linha.client.supplierRuleMode) : null;
                return (
                  <tr
                    key={linha.id}
                    className="indent-linha-clicavel"
                    tabIndex={0}
                    onClick={() => abrir(linha)}
                    onKeyDown={(event) => aoTeclar(event, linha)}
                  >
                    <td>
                      <div className="indent-cell-main">
                        {linha.processNumber === null ? (
                          <span className="badge badge--warning">Referência pendente</span>
                        ) : (
                          <span className="indent-ref">{linha.processNumber}</span>
                        )}
                        <span className="indent-cell-sub">{formatarDataHora(linha.createdAt)}</span>
                      </div>
                    </td>
                    <td>
                      <div className="indent-cell-main">
                        {linha.client ? (
                          <>
                            <span>{linha.client.name}</span>
                            <span className="indent-cell-sub">
                              {regra ? (
                                <span className="indent-tag indent-tag--lock">
                                  <Icon name="lock" size={11} strokeWidth={2.2} />
                                  {regra}
                                </span>
                              ) : (
                                (linha.client.city ?? '—')
                              )}
                            </span>
                          </>
                        ) : (
                          <span>Cliente pendente</span>
                        )}
                      </div>
                    </td>
                    <td>
                      <div className="indent-cell-main">
                        {linha.itemsSummary.count === 0 ? (
                          <span className="indent-cell-sub">
                            <span className="indent-tag indent-tag--manual">Itens a digitar</span>
                          </span>
                        ) : (
                          <>
                            <span>{linha.itemsSummary.firstName ?? '—'}</span>
                            <span className="indent-cell-sub">{resumoDosItens(linha)}</span>
                          </>
                        )}
                      </div>
                    </td>
                    <td>
                      {linha.origin === 'PIPEDRIVE' ? (
                        <span className="indent-tag indent-tag--pd">
                          Pipedrive{linha.pipedriveDealId !== null ? ` #${linha.pipedriveDealId}` : ''}
                        </span>
                      ) : (
                        <span className="indent-tag">IQ Indent</span>
                      )}
                    </td>
                    <td>{linha.ownerName}</td>
                    <td>{fila ? <span className={fila.classe}>{fila.texto}</span> : <span className="indent-cell-sub">—</span>}</td>
                    <td>
                      {linha.quotes.total > 0 ? (
                        <span className="indent-ref">{`${linha.quotes.answered}/${linha.quotes.total}`}</span>
                      ) : (
                        <span className="indent-cell-sub">—</span>
                      )}
                    </td>
                    <td>
                      <span className={status.classe}>{status.rotulo}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {solicitacoes.isLoading && (
          <div className="indent-vazio" role="status">
            Carregando solicitações…
          </div>
        )}
        {!solicitacoes.isLoading && !solicitacoes.isError && linhas.length === 0 && (
          <div className="indent-vazio">Nenhuma solicitação com esse filtro.</div>
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

      {novaAberta && <IndentNovaSolicitacaoModal onClose={() => setNovaAberta(false)} />}

      {toast && <ForecastToast key={toast.id} dados={toast} onFechar={fechar} />}
    </div>
  );
}
