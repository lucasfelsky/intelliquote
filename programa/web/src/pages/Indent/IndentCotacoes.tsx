import type { KeyboardEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Icon } from '@/components/icons';
import { ForecastToast, useToastForecast } from '@/pages/Forecast/ForecastToast';
import { listIndentQuotes, type IndentQuoteRow } from '@/services/indentQuotes';
import { QUOTE_STATUS, formatDateKey, formatMoney, groupQuotes, type QuoteGroupBy } from './indentCotacao';
import IndentCotacaoGaveta from './IndentCotacaoGaveta';
import { mensagemDoErro } from './indentFila';

// IQ Indent: Cotacoes (mock viewCotacoes). A lista vem pronta do backend (ate 500, mais recentes primeiro); o agrupamento e feito aqui.
// A gaveta abre pela URL (?cotacao=<id>, que tambem serve de link direto) e o agrupamento fica em ?agrupar=fornecedor|cliente|status.

const AGRUPAMENTOS: Array<{ id: QuoteGroupBy; rotulo: string }> = [
  { id: 'fornecedor', rotulo: 'Fornecedor' },
  { id: 'cliente', rotulo: 'Cliente' },
  { id: 'status', rotulo: 'Status' },
];

function agruparDe(valor: string | null): QuoteGroupBy {
  return AGRUPAMENTOS.some((item) => item.id === valor) ? (valor as QuoteGroupBy) : 'fornecedor';
}

export default function IndentCotacoes() {
  const [params, setParams] = useSearchParams();
  const { toast, mostrar, fechar } = useToastForecast();

  const agrupar = agruparDe(params.get('agrupar'));
  const cotacaoParam = params.get('cotacao');
  const cotacaoNumero = Number(cotacaoParam);
  const cotacaoId = Number.isInteger(cotacaoNumero) && cotacaoNumero > 0 ? cotacaoNumero : null;

  const cotacoes = useQuery({
    queryKey: ['indent', 'quotes', 'list', {}],
    queryFn: listIndentQuotes,
  });

  const linhas = cotacoes.data?.data ?? [];
  const grupos = groupQuotes(linhas, agrupar);

  function mudarAgrupamento(novo: QuoteGroupBy) {
    setParams(
      (atual) => {
        const proximo = new URLSearchParams(atual);
        proximo.set('agrupar', novo);
        return proximo;
      },
      { replace: true },
    );
  }

  function abrir(linha: IndentQuoteRow) {
    setParams((atual) => {
      const proximo = new URLSearchParams(atual);
      proximo.set('cotacao', String(linha.id));
      return proximo;
    });
  }

  function fecharGaveta(mensagem?: string) {
    setParams(
      (atual) => {
        const proximo = new URLSearchParams(atual);
        proximo.delete('cotacao');
        return proximo;
      },
      { replace: true },
    );
    if (mensagem) mostrar('salvo', mensagem, '');
  }

  function aoTeclar(event: KeyboardEvent<HTMLTableRowElement>, linha: IndentQuoteRow) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      abrir(linha);
    }
  }

  return (
    <div className="page indent-page indent-cotacoes-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Indent</p>
          <h1>Cotações</h1>
          <p className="page-subtitle">Cada fornecedor tem a sua cotação e cada cotação tem a sua referência de processo indent.</p>
        </div>
        <div className="page-header__actions">
          <span className="indent-seg-rotulo">Agrupar por</span>
          <div className="indent-seg" role="group" aria-label="Agrupar por">
            {AGRUPAMENTOS.map((item) => (
              <button key={item.id} type="button" aria-pressed={agrupar === item.id} onClick={() => mudarAgrupamento(item.id)}>
                {item.rotulo}
              </button>
            ))}
          </div>
        </div>
      </header>

      {cotacoes.isError && (
        <div role="alert" className="alert alert--warning">
          Não foi possível carregar as cotações: {mensagemDoErro(cotacoes.error)}
        </div>
      )}

      {cotacoes.isLoading && (
        <div className="indent-vazio" role="status">
          Carregando cotações…
        </div>
      )}

      {cotacoes.data && grupos.length === 0 && (
        <div className="indent-vazio">Nenhuma cotação ainda. As cotações nascem na solicitação, ao escolher os fornecedores.</div>
      )}

      <div className="indent-grupos">
        {grupos.map((grupo) => (
          <details key={`${agrupar}:${grupo.chave}`} className="indent-grupo" open>
            <summary>
              {grupo.avatar && (
                <span className="indent-grupo__avatar" aria-hidden="true">
                  {grupo.avatar}
                </span>
              )}
              <span className="indent-grupo__titulo">
                <strong>{grupo.titulo}</strong>
                {grupo.sub && <span className="indent-cell-sub">{grupo.sub}</span>}
              </span>
              <span className="indent-grupo__meta">
                <span>
                  {grupo.linhas.length} {grupo.linhas.length === 1 ? 'cotação' : 'cotações'}
                </span>
                {grupo.semParceria && (
                  <span className="indent-tag">
                    <Icon name="lock" size={11} strokeWidth={2.2} />
                    Sem parceria
                  </span>
                )}
                {grupo.comExcecao > 0 && (
                  <span className="indent-tag indent-tag--exc">
                    <Icon name="lock" size={11} strokeWidth={2.4} />
                    {grupo.comExcecao} com exceção
                  </span>
                )}
                {grupo.emAberto > 0 && <span className="indent-tag indent-tag--manual">{grupo.emAberto} em aberto</span>}
              </span>
              <span className="indent-grupo__seta">
                <Icon name="chevron-down" size={18} />
              </span>
            </summary>
            <div className="indent-tabela-caixa">
              <div className="table-wrapper">
                <table className="table indent-tabela">
                  <thead>
                    <tr>
                      <th>Referência</th>
                      {agrupar !== 'cliente' && <th>Cliente</th>}
                      {agrupar !== 'fornecedor' && <th>Fornecedor</th>}
                      <th>Itens</th>
                      <th>Status</th>
                      <th className="indent-num">Total</th>
                      <th className="indent-num">Validade</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grupo.linhas.map((linha) => {
                      const status = QUOTE_STATUS[linha.status];
                      return (
                        <tr
                          key={linha.id}
                          className={`indent-linha-clicavel${linha.exception ? ' indent-linha-exc' : ''}`}
                          tabIndex={0}
                          onClick={() => abrir(linha)}
                          onKeyDown={(event) => aoTeclar(event, linha)}
                        >
                          <td>
                            <div className="indent-cell-main">
                              <span className="indent-ref indent-ref--indent">{linha.ref}</span>
                              {linha.exception && (
                                <span className="indent-tag indent-tag--exc">
                                  <Icon name="lock" size={11} strokeWidth={2.4} />
                                  Exceção
                                </span>
                              )}
                            </div>
                          </td>
                          {agrupar !== 'cliente' && <td>{linha.client?.name ?? '—'}</td>}
                          {agrupar !== 'fornecedor' && <td>{linha.supplier.name}</td>}
                          <td>
                            <div className="indent-cell-main">
                              <span>{linha.itemsSummary.firstName ?? '—'}</span>
                              <span className="indent-cell-sub">
                                {linha.itemsSummary.count > 1 ? `+ ${linha.itemsSummary.count - 1} · ` : ''}
                                {linha.processNumber}
                              </span>
                            </div>
                          </td>
                          <td>
                            <span className={status.classe}>{status.rotulo}</span>
                          </td>
                          <td className="indent-num">{formatMoney(linha.total, linha.currency)}</td>
                          <td className="indent-num">{formatDateKey(linha.validUntil, 'curta')}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </details>
        ))}
      </div>

      {cotacoes.data?.truncated && <p className="indent-cell-sub">Mostrando as 500 cotações mais recentes.</p>}

      {cotacaoParam !== null && <IndentCotacaoGaveta quoteId={cotacaoId} onClose={fecharGaveta} />}

      {toast && <ForecastToast key={toast.id} dados={toast} onFechar={fechar} />}
    </div>
  );
}
