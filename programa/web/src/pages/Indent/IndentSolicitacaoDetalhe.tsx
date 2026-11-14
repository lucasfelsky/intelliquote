import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ApiError } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { Icon } from '@/components/icons';
import { ForecastToast, useToastForecast } from '@/pages/Forecast/ForecastToast';
import { getIndentRequest, type IndentRequestDetail, type IndentRequestQuote } from '@/services/indentRequests';
import { formatCnpj } from './cnpj';
import { QUOTE_STATUS, formatMoney } from './indentCotacao';
import IndentCotacaoGaveta from './IndentCotacaoGaveta';
import {
  filaFrase,
  formatarDataHora,
  formatarKg,
  mensagemDoErro,
  primeiraPalavra,
  rotuloRegra,
  statusRotulo,
} from './indentFila';
import IndentNotaItensModal from './IndentNotaItensModal';
import {
  AlertasDaSincronizacao,
  AvisoClientePendente,
  DetalhesDaNota,
  PainelClientePendente,
  ReferenciaPendente,
  nomeDoClientePendente,
} from './IndentSolicitacaoDetalhePipedrive';
import IndentSupplierPicker from './IndentSupplierPicker';

// IQ Indent: detalhe da solicitacao (mock viewSolDetail). Coluna da esquerda: escolha de fornecedores (NOVA), os avisos que a barram (cliente
// pendente, referencia pendente, itens da nota a confirmar) ou as cotacoes ja geradas (cada linha abre a gaveta da cotacao, PR 3); coluna da
// direita: nota (so com rawNote), itens e cliente (ou a organizacao da fila de vinculo enquanto o cliente esta pendente).

const ESCRITA = ['admin', 'comprador', 'gestor'];

function eyebrowDe(solicitacao: IndentRequestDetail): string {
  if (solicitacao.origin !== 'PIPEDRIVE') return 'Lançada no IQ Indent';
  const negocio = solicitacao.pipedriveDealId !== null ? ` · negócio #${solicitacao.pipedriveDealId}` : '';
  const titulo = solicitacao.dealTitle ? ` · título “${solicitacao.dealTitle}”` : '';
  return `Pipedrive${negocio}${titulo}`;
}

function CotacoesPanel({ solicitacao, onAbrir }: { solicitacao: IndentRequestDetail; onAbrir: (cotacao: IndentRequestQuote) => void }) {
  const total = solicitacao.quotes.length;

  function aoTeclar(event: KeyboardEvent<HTMLTableRowElement>, cotacao: IndentRequestQuote) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onAbrir(cotacao);
    }
  }

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
                const status = QUOTE_STATUS[cotacao.status];
                return (
                  <tr
                    key={cotacao.id}
                    className={`indent-linha-clicavel${cotacao.exception ? ' indent-linha-exc' : ''}`}
                    tabIndex={0}
                    onClick={() => onAbrir(cotacao)}
                    onKeyDown={(event) => aoTeclar(event, cotacao)}
                  >
                    <td>
                      <div className="indent-cell-main">
                        <span className="indent-ref indent-ref--indent">{cotacao.ref}</span>
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
                    <td className="indent-num">{formatMoney(cotacao.total, cotacao.currency)}</td>
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
  // Gaveta da cotacao aberta a partir da linha de "Cotacoes desta solicitacao" (so por estado: sem link proprio nesta tela).
  const [cotacaoAberta, setCotacaoAberta] = useState<number | null>(null);
  // Modal "Revisar itens da nota": `chave` remonta o modal com a lista nova quando os itens mudaram no servidor com ele aberto.
  const [notaItens, setNotaItens] = useState<{ chave: number; aviso: string | null } | null>(null);
  // Salvar a referencia ou confirmar os itens tira o botao/formulario que abriu a acao do DOM: o foco vai para o titulo da area afetada.
  const tituloRef = useRef<HTMLHeadingElement>(null);
  const itensTituloRef = useRef<HTMLHeadingElement>(null);
  const [devolverFoco, setDevolverFoco] = useState<{ alvo: 'titulo' | 'itens'; n: number } | null>(null);
  useEffect(() => {
    if (!devolverFoco) return;
    (devolverFoco.alvo === 'titulo' ? tituloRef : itensTituloRef).current?.focus();
  }, [devolverFoco]);

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
  const pendencia = solicitacao.pendingOrg;
  const referenciaPendente = solicitacao.processNumber === null;
  const semItens = solicitacao.items.length === 0;
  const itensNaoConfirmados = solicitacao.items.some((item) => !item.confirmed);
  // Itens ainda sem confirmacao humana (ou sem item nenhum) barram a geracao: o backend responde 400 "Confirme os itens antes de gerar cotacoes.".
  const itensPendentes = solicitacao.status === 'NOVA' && (semItens || itensNaoConfirmados);
  // So NOVA e sem cotacao edita os itens (senao 409); depois do alerta "a nota mudou" a pessoa pode revisar de novo.
  const podeRevisarItens =
    canWrite && solicitacao.status === 'NOVA' && solicitacao.quotes.length === 0 && (itensPendentes || solicitacao.noteChangedAt !== null);
  const nomeNoTitulo = client ? client.name : nomeDoClientePendente(pendencia);

  let painelFornecedores;
  if (solicitacao.clientPending || referenciaPendente || itensPendentes) {
    painelFornecedores = (
      <section className="indent-painel">
        <div className="indent-painel__cabeca">
          <h2>Fornecedores para cotar</h2>
        </div>
        {solicitacao.clientPending && <AvisoClientePendente pendencia={pendencia} onAbrirFila={() => navigate('/indent/integracao')} />}
        {referenciaPendente && (
          <ReferenciaPendente
            solicitacao={solicitacao}
            canWrite={canWrite}
            onSalva={(numero) => {
              mostrar('salvo', `Referência ${numero} salva`, '');
              setDevolverFoco((atual) => ({ alvo: 'titulo', n: (atual?.n ?? 0) + 1 }));
            }}
          />
        )}
        {itensPendentes && (
          <div className="alert alert--warning indent-alerta">
            <Icon name="lock" size={18} />
            <span className="indent-alerta__texto">
              {semItens ? 'Esta solicitação ainda não tem itens.' : 'Os itens lidos da nota ainda não foram confirmados.'}{' '}
              {canWrite
                ? `Use “${semItens ? 'Digitar itens' : 'Revisar e confirmar itens'}” antes de escolher fornecedores.`
                : 'Quem cota precisa confirmá-los antes de escolher fornecedores.'}
            </span>
          </div>
        )}
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
    painelFornecedores = <CotacoesPanel solicitacao={solicitacao} onAbrir={(cotacao) => setCotacaoAberta(cotacao.id)} />;
  }

  return (
    <div className="page indent-page indent-solicitacao-page">
      {voltar}

      <header className="page-header">
        <div>
          <p className="eyebrow">{eyebrowDe(solicitacao)}</p>
          <h1 ref={tituloRef} tabIndex={-1}>
            <span className="indent-ref">{solicitacao.processNumber ?? 'Referência pendente'}</span> · {nomeNoTitulo}
          </h1>
          <p className="page-subtitle">
            Criada em {formatarDataHora(solicitacao.createdAt)} · responsável {solicitacao.ownerName}
            {fila ? ` · ${fila}` : ''}
          </p>
        </div>
        <div className="page-header__actions">
          {solicitacao.currentRevision !== null && (
            <span className="indent-tag indent-tag--pd" title={`Revisão ${solicitacao.currentRevision} recebida do Pipedrive`}>
              R{solicitacao.currentRevision}
            </span>
          )}
          <span className={status.classe}>{status.rotulo}</span>
        </div>
      </header>

      <AlertasDaSincronizacao solicitacao={solicitacao} />

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
              <DetalhesDaNota solicitacao={solicitacao} />
              <p className="indent-cell-sub indent-painel__nota">
                O pedido chega como texto livre. O IQ Indent propõe os itens ao lado e você confirma antes de cotar.
              </p>
            </section>
          )}

          <section className="indent-painel">
            <div className="indent-painel__cabeca">
              <h2 ref={itensTituloRef} tabIndex={-1}>
                Itens pedidos
              </h2>
              {semItens ? (
                <span className="indent-tag indent-tag--manual">Itens a digitar</span>
              ) : itensNaoConfirmados ? (
                <span className="indent-tag indent-tag--manual">Lidos da nota · confirmar</span>
              ) : (
                temNota && <span className="indent-tag indent-tag--ok">Itens confirmados</span>
              )}
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
                  <span className="indent-ref indent-itemrow__qtd">{item.quantityKg > 0 ? `${formatarKg(item.quantityKg)} kg` : '— kg'}</span>
                </div>
              ))}
            </div>
            {podeRevisarItens && (
              <div>
                <button type="button" className="ghost-button" onClick={() => setNotaItens({ chave: 1, aviso: null })}>
                  {semItens ? 'Digitar itens' : 'Revisar e confirmar itens'}
                </button>
              </div>
            )}
          </section>

          {!client && pendencia && <PainelClientePendente pendencia={pendencia} dealType={solicitacao.dealType} />}

          {client && (
            <section className="indent-painel">
              <div className="indent-painel__cabeca">
                <h2>Cliente</h2>
              </div>
              <dl className="indent-dl">
                <dt>CNPJ</dt>
                {client.cnpj === null ? (
                  <dd>
                    <span className="indent-tag indent-tag--manual">CNPJ pendente</span>
                  </dd>
                ) : (
                  <dd className="indent-dl__mono">{formatCnpj(client.cnpj)}</dd>
                )}
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

      {cotacaoAberta !== null && (
        <IndentCotacaoGaveta
          quoteId={cotacaoAberta}
          onClose={(mensagem) => {
            setCotacaoAberta(null);
            if (mensagem) mostrar('salvo', mensagem, '');
          }}
        />
      )}

      {notaItens && (
        <IndentNotaItensModal
          key={notaItens.chave}
          solicitacao={solicitacao}
          avisoInicial={notaItens.aviso}
          onClose={() => setNotaItens(null)}
          onConfirmed={() => {
            setNotaItens(null);
            mostrar('salvo', 'Itens confirmados', '');
            setDevolverFoco((atual) => ({ alvo: 'itens', n: (atual?.n ?? 0) + 1 }));
          }}
          onStale={(mensagem) => setNotaItens((atual) => (atual ? { chave: atual.chave + 1, aviso: mensagem } : atual))}
        />
      )}

      {toast && <ForecastToast key={toast.id} dados={toast} onFechar={fechar} />}
    </div>
  );
}
