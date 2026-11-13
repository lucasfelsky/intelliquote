import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ApiError } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { Icon } from '@/components/icons';
import { ForecastToast, useToastForecast } from '@/pages/Forecast/ForecastToast';
import { getIndentRequest, type IndentRequestDetail, type IndentRequestQuote } from '@/services/indentRequests';
import { formatCnpj } from './cnpj';
import {
  filaFrase,
  formatarDataHora,
  formatarKg,
  mensagemDoErro,
  primeiraPalavra,
  rotuloRegra,
  statusRotulo,
} from './indentFila';
import IndentSupplierPicker from './IndentSupplierPicker';

// IQ Indent: detalhe da solicitacao (mock viewSolDetail). Coluna da esquerda: escolha de fornecedores (NOVA), aviso de cliente pendente ou as
// cotacoes ja geradas; coluna da direita: nota (so com rawNote), itens e cliente. A linha da cotacao nao abre gaveta neste PR (PR 3).

const ESCRITA = ['admin', 'comprador', 'gestor'];

const COTACAO_STATUS: Record<IndentRequestQuote['status'], { rotulo: string; classe: string }> = {
  RASCUNHO: { rotulo: 'Rascunho', classe: 'badge badge--dot badge--muted' },
  ENVIADA: { rotulo: 'Enviada', classe: 'badge badge--dot badge--info' },
  RESPONDIDA: { rotulo: 'Respondida', classe: 'badge badge--dot badge--warning' },
  ACEITA: { rotulo: 'Aceita', classe: 'badge badge--dot badge--success' },
  RECUSADA: { rotulo: 'Recusada', classe: 'badge badge--dot badge--danger' },
  REVISADA: { rotulo: 'Revisada', classe: 'badge badge--dot badge--muted' },
};

function eyebrowDe(solicitacao: IndentRequestDetail): string {
  if (solicitacao.origin !== 'PIPEDRIVE') return 'Lançada no IQ Indent';
  const negocio = solicitacao.pipedriveDealId !== null ? ` · negócio #${solicitacao.pipedriveDealId}` : '';
  const titulo = solicitacao.dealTitle ? ` · título “${solicitacao.dealTitle}”` : '';
  return `Pipedrive${negocio}${titulo}`;
}

function CotacoesPanel({ solicitacao }: { solicitacao: IndentRequestDetail }) {
  const total = solicitacao.quotes.length;
  return (
    <section className="indent-painel">
      <div className="indent-painel__cabeca">
        <h2>Cotações desta solicitação</h2>
        <span className="indent-cell-sub">
          {total} {total === 1 ? 'fornecedor' : 'fornecedores'}
        </span>
      </div>
      <div className="indent-tabela-caixa">
        <div className="table-wrapper">
          <table className="table indent-tabela">
            <thead>
              <tr>
                <th>Referência</th>
                <th>Fornecedor</th>
                <th>Status</th>
                <th className="indent-num">Total</th>
              </tr>
            </thead>
            <tbody>
              {solicitacao.quotes.map((cotacao) => {
                const status = COTACAO_STATUS[cotacao.status];
                return (
                  <tr key={cotacao.id} className={cotacao.exception ? 'indent-linha-exc' : undefined}>
                    <td>
                      <div className="indent-cell-main">
                        <span className="indent-ref indent-ref--indent">{solicitacao.processNumber}</span>
                        {cotacao.exception && (
                          <span className="indent-tag indent-tag--exc">
                            <Icon name="lock" size={11} strokeWidth={2.4} />
                            Exceção
                          </span>
                        )}
                      </div>
                    </td>
                    <td>{cotacao.supplier.name}</td>
                    <td>
                      <span className={status.classe}>{status.rotulo}</span>
                    </td>
                    <td className="indent-num">—</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function RestricaoDoCliente({ client }: { client: NonNullable<IndentRequestDetail['client']> }) {
  const rotulo = rotuloRegra(client.supplierRuleMode);
  if (!rotulo) return <span className="indent-tag">Sem restrição de fornecedor</span>;

  return (
    <div className="indent-pilha indent-pilha--curta">
      <span className="indent-tag indent-tag--lock">
        <Icon name="lock" size={11} strokeWidth={2.2} />
        {rotulo}
      </span>
      {client.ruleReason && <span className="indent-restricao__motivo">{client.ruleReason}</span>}
      <span className="indent-cell-sub">
        {client.supplierRuleMode === 'APROVADOS' ? 'Aprovados: ' : 'Bloqueados: '}
        {client.supplierRules.map((regra) => primeiraPalavra(regra.name)).join(', ')}
      </span>
    </div>
  );
}

export default function IndentSolicitacaoDetalhe() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const canWrite = ESCRITA.includes(user?.role ?? '');
  const { toast, mostrar, fechar } = useToastForecast();

  const numero = Number(id);
  const idValido = Number.isInteger(numero) && numero > 0;

  const detalhe = useQuery({
    queryKey: ['indent', 'requests', numero],
    queryFn: () => getIndentRequest(numero),
    enabled: idValido,
    retry: false,
  });

  // Toast vindo da criacao ("Solicitacao NNN/AA criada..."): chega pelo state da navegacao e e limpo para nao repetir ao recarregar.
  useEffect(() => {
    const mensagem = (location.state as { toast?: string } | null)?.toast;
    if (!mensagem) return;
    mostrar('salvo', mensagem, '');
    navigate(location.pathname, { replace: true, state: null });
    // So na chegada: depois de limpar o state o efeito nao tem mais o que fazer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const voltar = (
    <div>
      <button type="button" className="ghost-button ghost-button--sm" onClick={() => navigate('/indent/solicitacoes')}>
        <Icon name="arrow-left" size={16} />
        Solicitações
      </button>
    </div>
  );

  const naoEncontrada =
    !idValido || (detalhe.isError && detalhe.error instanceof ApiError && detalhe.error.status === 404);

  if (naoEncontrada) {
    return (
      <div className="page indent-page indent-solicitacao-page">
        {voltar}
        <div className="indent-vazio">Solicitação não encontrada.</div>
      </div>
    );
  }

  if (detalhe.isError) {
    return (
      <div className="page indent-page indent-solicitacao-page">
        {voltar}
        <div role="alert" className="alert alert--error">
          Não foi possível carregar a solicitação: {mensagemDoErro(detalhe.error)}
        </div>
      </div>
    );
  }

  const solicitacao = detalhe.data;

  if (!solicitacao) {
    return (
      <div className="page indent-page indent-solicitacao-page">
        {voltar}
        <div className="indent-vazio" role="status">
          Carregando solicitação…
        </div>
      </div>
    );
  }

  const client = solicitacao.client;
  const status = statusRotulo(solicitacao.status, solicitacao.clientPending);
  const fila = filaFrase(solicitacao.queueBusinessDays);
  const temNota = solicitacao.rawNote !== null && solicitacao.rawNote !== '';

  let painelFornecedores;
  if (solicitacao.clientPending) {
    painelFornecedores = (
      <section className="indent-painel">
        <div className="indent-painel__cabeca">
          <h2>Fornecedores para cotar</h2>
        </div>
        <div className="alert alert--warning indent-alerta">
          <Icon name="lock" size={18} />
          <span>
            A organização do negócio não tem cliente cadastrado. Vincule antes de escolher fornecedores, para a restrição do cliente valer.
          </span>
        </div>
      </section>
    );
  } else if (solicitacao.status === 'NOVA') {
    const regra = client ? rotuloRegra(client.supplierRuleMode) : null;
    painelFornecedores = (
      <section className="indent-painel">
        <div className="indent-painel__cabeca">
          <h2>Fornecedores para cotar</h2>
          {regra && (
            <span className="indent-tag indent-tag--lock">
              <Icon name="lock" size={11} strokeWidth={2.2} />
              Restrição do cliente aplicada
            </span>
          )}
        </div>
        <IndentSupplierPicker request={solicitacao} canWrite={canWrite} onGenerated={(mensagem) => mostrar('salvo', mensagem, '')} />
      </section>
    );
  } else {
    painelFornecedores = <CotacoesPanel solicitacao={solicitacao} />;
  }

  return (
    <div className="page indent-page indent-solicitacao-page">
      {voltar}

      <header className="page-header">
        <div>
          <p className="eyebrow">{eyebrowDe(solicitacao)}</p>
          <h1>
            <span className="indent-ref">{solicitacao.processNumber}</span> · {client ? client.name : 'Cliente pendente'}
          </h1>
          <p className="page-subtitle">
            Criada em {formatarDataHora(solicitacao.createdAt)} · responsável {solicitacao.ownerName}
            {fila ? ` · ${fila}` : ''}
          </p>
        </div>
        <div className="page-header__actions">
          <span className={status.classe}>{status.rotulo}</span>
        </div>
      </header>

      <div className="indent-cols">
        <div className="indent-coluna">{painelFornecedores}</div>
        <div className="indent-coluna">
          {temNota && (
            <section className="indent-painel">
              <div className="indent-painel__cabeca">
                <h2>Nota do negócio no Pipedrive</h2>
                <span className="indent-tag indent-tag--pd">Texto original</span>
              </div>
              <pre className="indent-nota">{solicitacao.rawNote}</pre>
              <p className="indent-cell-sub indent-painel__nota">
                O pedido chega como texto livre. O IQ Indent propõe os itens ao lado e você confirma antes de cotar.
              </p>
            </section>
          )}

          <section className="indent-painel">
            <div className="indent-painel__cabeca">
              <h2>Itens pedidos</h2>
              {temNota && <span className="indent-tag indent-tag--manual">Lidos da nota · confirmar</span>}
            </div>
            <div>
              {solicitacao.items.map((item) => (
                <div key={item.id} className="indent-itemrow">
                  <div className="indent-cell-main">
                    <strong>{item.name}</strong>
                    <span className="indent-cell-sub">
                      {item.isFree ? (
                        <span className="indent-tag indent-tag--manual">Item livre</span>
                      ) : item.product?.cas ? (
                        `CAS ${item.product.cas}`
                      ) : (
                        'sem CAS'
                      )}
                    </span>
                  </div>
                  <span className="indent-ref indent-itemrow__qtd">{formatarKg(item.quantityKg)} kg</span>
                </div>
              ))}
            </div>
          </section>

          {client && (
            <section className="indent-painel">
              <div className="indent-painel__cabeca">
                <h2>Cliente</h2>
              </div>
              <dl className="indent-dl">
                <dt>CNPJ</dt>
                <dd className="indent-dl__mono">{formatCnpj(client.cnpj)}</dd>
                <dt>Cidade</dt>
                <dd>{client.city ?? '—'}</dd>
                <dt>Pipedrive</dt>
                <dd>{client.pipedriveOrgId !== null ? `Org #${client.pipedriveOrgId}` : '—'}</dd>
                {solicitacao.dealType && (
                  <>
                    <dt>Tipo de negócio</dt>
                    <dd>{solicitacao.dealType}</dd>
                  </>
                )}
              </dl>
              <RestricaoDoCliente client={client} />
            </section>
          )}
        </div>
      </div>

      {toast && <ForecastToast key={toast.id} dados={toast} onFechar={fechar} />}
    </div>
  );
}
