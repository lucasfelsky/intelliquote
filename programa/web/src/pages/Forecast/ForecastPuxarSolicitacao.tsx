import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import Spinner from '@/components/Spinner';
import { ApiError } from '@/api/client';
import { forecastDemandaKeys, listForecastProdutosParaDemanda } from '@/services/forecastDemandaComercial';
import {
  forecastSolicitacoesErrorMessage,
  forecastSolicitacoesKeys,
  listSolicitacoesParaDemanda,
} from '@/services/forecastSolicitacoes';
import {
  avisoTruncamento,
  casarSolicitacoes,
  preenchimentoDoItem,
  resumoDoPreenchimento,
  type ItemCasado,
  type PreenchimentoSolicitacao,
  type SolicitacaoCasada,
} from './forecastDemandaSolicitacao';
import { kgBr } from './forecastPainel';

// Demanda do comercial (piloto PR5): botao + painel inline que puxa produto, kg, cliente e no da Solicitacao.
// So no lancamento. Data de necessidade e motivo continuam manuais.

const MSG_PRODUTOS = 'Não foi possível carregar os produtos do Forecast para casar os itens.';

interface Props {
  disabled: boolean;
  onEscolher: (preenchimento: PreenchimentoSolicitacao) => void;
}

function quantidadeDoItem(item: ItemCasado): string {
  const base = `${kgBr(item.quantidade)} ${item.unidade}`;
  return item.unidade === 'TON' && item.kg !== null ? `${base} = ${kgBr(item.kg)} kg` : base;
}

export default function ForecastPuxarSolicitacao({ disabled, onEscolher }: Props) {
  const baseId = useId();
  const idPainel = `${baseId}-painel`;
  const idTitulo = `${baseId}-titulo`;
  const [aberto, setAberto] = useState(false);
  const [resumo, setResumo] = useState('');
  const botao = useRef<HTMLButtonElement>(null);
  const titulo = useRef<HTMLHeadingElement>(null);

  // Mesma key e queryFn do modal: o cache de produtos e compartilhado.
  const produtos = useQuery({ queryKey: forecastDemandaKeys.produtos, queryFn: listForecastProdutosParaDemanda });
  const solicitacoes = useQuery({
    queryKey: forecastSolicitacoesKeys.lista,
    queryFn: listSolicitacoesParaDemanda,
    enabled: aberto,
  });

  const casadas = useMemo(
    () => casarSolicitacoes(solicitacoes.data?.solicitacoes ?? [], produtos.data ?? []),
    [solicitacoes.data, produtos.data],
  );
  const aviso = solicitacoes.data ? avisoTruncamento(solicitacoes.data.totais) : null;

  useEffect(() => {
    if (aberto) titulo.current?.focus();
  }, [aberto]);

  const fechar = () => {
    setAberto(false);
    window.setTimeout(() => botao.current?.focus(), 0);
  };

  const aoTeclar = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      // Sem isto o Esc dispara o `cancel` do dialogo e fecha o modal inteiro.
      e.preventDefault();
      e.stopPropagation();
      fechar();
    }
  };

  const usar = (s: SolicitacaoCasada, item: ItemCasado) => {
    const p = preenchimentoDoItem(s, item);
    if (!p) return;
    setResumo(resumoDoPreenchimento(p));
    setAberto(false);
    onEscolher(p);
  };

  const falhaSolicitacoes = solicitacoes.isError && !solicitacoes.isFetching;
  const falhaProdutos = produtos.isError && !produtos.isFetching;
  const semPermissao = falhaSolicitacoes && solicitacoes.error instanceof ApiError && solicitacoes.error.status === 403;

  const tentarDeNovo = () => {
    if (falhaSolicitacoes) void solicitacoes.refetch();
    if (falhaProdutos) void produtos.refetch();
    titulo.current?.focus();
  };

  return (
    <div className="fcsl">
      <button
        ref={botao}
        type="button"
        className="ghost-button fcsl-botao"
        aria-expanded={aberto}
        aria-controls={aberto ? idPainel : undefined}
        disabled={disabled}
        onClick={() => (aberto ? fechar() : setAberto(true))}
      >
        Puxar de uma Solicitação
      </button>
      <p className="fcsl-resumo" role="status">
        {resumo}
      </p>

      {aberto && (
        <div id={idPainel} className="fcsl-painel" role="region" aria-labelledby={idTitulo} onKeyDown={aoTeclar}>
          <h3 id={idTitulo} ref={titulo} tabIndex={-1} className="fcsl-titulo">
            Solicitações pendentes e em cotação
          </h3>
          <button type="button" className="ghost-button" onClick={fechar}>
            Fechar lista de Solicitações
          </button>

          {falhaSolicitacoes || falhaProdutos ? (
            <div className="alert alert--error" role="alert">
              <p className="fcd-alert__texto">
                {falhaSolicitacoes ? forecastSolicitacoesErrorMessage(solicitacoes.error) : MSG_PRODUTOS}
              </p>
              {!semPermissao && (
                <button
                  type="button"
                  className="ghost-button"
                  aria-label="Tentar de novo: carregar as Solicitações"
                  onClick={tentarDeNovo}
                >
                  Tentar de novo
                </button>
              )}
            </div>
          ) : !solicitacoes.isSuccess || !produtos.isSuccess ? (
            <div className="fcd-carregando" role="status">
              <Spinner /> Carregando Solicitações…
            </div>
          ) : casadas.length === 0 ? (
            <p className="fcd-dica" role="status">
              Nenhuma Solicitação pendente ou em cotação.
            </p>
          ) : (
            <>
              {aviso && (
                <p className="fcd-dica" role="status">
                  {aviso}
                </p>
              )}
              <ul className="fcsl-lista">
                {casadas.map((s) => (
                  <li key={s.id} className="fcsl-solicitacao">
                    <p className="fcsl-cabecalho">
                      {`Solicitação nº ${s.id} · ${s.statusTexto} · criada em ${s.criadaEm} · ${s.cliente ? `Cliente: ${s.cliente}` : 'Sem cliente'}`}
                    </p>
                    <ul className="fcsl-itens">
                      {s.itens.map((item) => {
                        const idMotivo = `${baseId}-motivo-${s.id}-${item.itemId}`;
                        const nome = item.bloqueio ? item.commercialName : (item.produto?.name ?? item.commercialName);
                        return (
                          <li key={item.itemId} className="fcsl-item">
                            <div className="fcsl-item__dados">
                              <p className="fcsl-item__nome">{item.commercialName}</p>
                              <p className="fcsl-item__qtd">{quantidadeDoItem(item)}</p>
                              {item.bloqueio ? (
                                <p id={idMotivo} className="fcsl-motivo">
                                  {item.bloqueio.texto}
                                </p>
                              ) : (
                                <p className="fcsl-motivo">Produto do Forecast: {item.produto?.name}</p>
                              )}
                              {item.pedeKg && !item.bloqueio && (
                                <p className="fcsl-motivo">
                                  Unidade {item.unidade}: informe a quantidade em kg depois de usar o item.
                                </p>
                              )}
                            </div>
                            <button
                              type="button"
                              className="ghost-button"
                              disabled={disabled || item.bloqueio !== null}
                              aria-describedby={item.bloqueio ? idMotivo : undefined}
                              aria-label={`Usar este item: ${nome} da Solicitação nº ${s.id}`}
                              onClick={() => usar(s, item)}
                            >
                              Usar este item
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
