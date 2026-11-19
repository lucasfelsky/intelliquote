import { useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Icon } from '@/components/icons';
import { listQuoteResponses, messageOf, type ComparisonResult, type ExcludedComparisonResponse } from '@/services/quoteResponses';
import {
  calcularCelulas,
  contarMenores,
  deltaPercentual,
  emMoedaDeReferencia,
  formatarLeadTime,
  formatarNumero,
  formatarQuantidade,
  formatarUnidade,
  menorPorLinha,
  menoresTotais,
  moedaDeReferencia,
  montarColunas,
  precosDaLinha,
  rotuloMoeda,
  simularMenorPorItem,
  subtituloDoItem,
  type ItemDaCotacao,
} from './comparacaoPorItemHelpers';

// Visao "Preco por item": matriz item x fornecedor (mock-up ComparacaoPorItem). So leitura; nao recalcula score:
// o total do rodape vem do backend (offeredPrice) e os precos por item de `GET /v1/quote-responses` (cache compartilhado
// com a aba Respostas). A query so existe enquanto esta visao esta montada.
export function ComparacaoPorItem({
  quoteRequestId,
  items,
  requestCurrency,
  rankedResults,
  excludedResponses,
  excludedWinnerKey,
  winnerBadgeLabel,
}: {
  quoteRequestId: number;
  items: ItemDaCotacao[];
  requestCurrency?: string;
  rankedResults: ComparisonResult[];
  excludedResponses: ExcludedComparisonResponse[];
  excludedWinnerKey: string | null;
  winnerBadgeLabel: string;
}) {
  const [destacarMenor, setDestacarMenor] = useState(true);
  const [mostrarDiferenca, setMostrarDiferenca] = useState(true);

  const responsesQuery = useQuery({
    queryKey: ['quote-responses'],
    queryFn: () => listQuoteResponses(),
    staleTime: 30_000,
    enabled: items.length > 0,
  });

  const respostas = useMemo(
    () => (responsesQuery.data ?? []).filter((r) => r.quoteRequestId === quoteRequestId),
    [responsesQuery.data, quoteRequestId],
  );

  const { colunas, temViaParceiro } = useMemo(
    () =>
      montarColunas({
        rankedResults,
        excluded: excludedResponses,
        excludedWinnerKey,
        respostas,
        winnerBadgeLabel,
      }),
    [rankedResults, excludedResponses, excludedWinnerKey, respostas, winnerBadgeLabel],
  );

  if (items.length === 0) {
    return (
      <div className="cmp-empty">
        <div className="cmp-empty__icon" aria-hidden="true">
          <Icon name="relatorios" size={30} strokeWidth={1.5} />
        </div>
        <div className="cmp-empty__text">
          <strong>Sem itens nesta cotação.</strong>
        </div>
      </div>
    );
  }

  if (responsesQuery.isLoading) {
    return (
      <div className="cmp-carregando" role="status">
        <span className="cmp-carregando__spinner" aria-hidden="true" />
        <span>Carregando preços por item…</span>
      </div>
    );
  }

  if (responsesQuery.isError && !responsesQuery.data) {
    return (
      <div role="alert" className="cmp-erro">
        <span className="cmp-erro__corpo">
          <Icon name="alert-triangle" size={20} strokeWidth={1.9} />
          <span className="cmp-erro__texto">
            <strong>Não foi possível carregar os preços por item.</strong>
            <span>{messageOf(responsesQuery.error)}</span>
          </span>
        </span>
        <button
          type="button"
          className="ghost-button cmp-btn cmp-btn--ghost cmp-btn--sm"
          onClick={() => responsesQuery.refetch()}
        >
          <Icon name="refresh" size={14} strokeWidth={2} />
          Tentar novamente
        </button>
      </div>
    );
  }

  if (colunas.length === 0) {
    return (
      <div className="cmp-pi">
        <div className="cmp-empty">
          <div className="cmp-empty__icon" aria-hidden="true">
            <Icon name="relatorios" size={30} strokeWidth={1.5} />
          </div>
          <div className="cmp-empty__text">
            <strong>Nenhuma proposta direta para mostrar por item.</strong>
          </div>
        </div>
        {temViaParceiro && (
          <p className="cmp-pi__nota">Alternativas via parceiro (Credit Support) aparecem só no Ranking.</p>
        )}
      </div>
    );
  }

  const moedaRef = moedaDeReferencia(colunas);
  const rotuloRef = rotuloMoeda(moedaRef);
  const celulas = calcularCelulas(items, colunas);
  const menoresDasLinhas = items.map((_, i) => menorPorLinha(precosDaLinha(celulas[i] ?? [], colunas, moedaRef)));
  const contagem = contarMenores(celulas, colunas, moedaRef);
  const totaisMenores = menoresTotais(colunas);
  const menorTotal = menorPorLinha(colunas.filter((c) => !c.foraDoRanking).map((c) => c.total));
  const temFora = colunas.some((c) => c.foraDoRanking);
  const temOutraMoeda = colunas.some((c) => c.moeda !== null && !emMoedaDeReferencia(c, moedaRef));
  const colunasNaMoedaRef = colunas.filter((c) => emMoedaDeReferencia(c, moedaRef)).length;

  const unidades = Array.from(new Set(items.map((i) => formatarUnidade(i.unit)).filter(Boolean)));
  const unidadeLegenda = unidades.length === 1 ? ` por ${unidades[0]}` : '';
  const legenda =
    `Preço unitário${rotuloRef ? ` em ${rotuloRef}` : ''}${unidadeLegenda}, na moeda da proposta, sem frete nem impostos.` +
    (temOutraMoeda ? ' Colunas em outra moeda não entram no destaque.' : '');

  const alvoRotulo =
    requestCurrency && moedaRef && requestCurrency.toUpperCase() !== moedaRef
      ? `Preço-alvo (${rotuloMoeda(requestCurrency.toUpperCase())})`
      : 'Preço-alvo';

  // Faixa informativa: so com 2+ colunas na moeda de referencia.
  let faixa: ReactNode = null;
  if (colunasNaMoedaRef >= 2) {
    const sim = simularMenorPorItem(items, colunas, moedaRef);
    if (sim.itensSemPreco.length > 0 || sim.soma === null) {
      faixa = (
        <span>
          Nenhuma proposta cotou: {sim.itensSemPreco.join(', ')}. Sem o preço de todos os itens, não dá para somar o menor
          preço de cada item.
        </span>
      );
    } else {
      const vencedora = rankedResults.find((r) => r.isWinner);
      const totalVencedora =
        vencedora && Number.isFinite(vencedora.offeredPrice) && (vencedora.currency ?? moedaRef) === moedaRef
          ? vencedora.offeredPrice
          : null;
      const prefixo = rotuloRef ? `${rotuloRef} ` : '';
      const nForn = `${sim.fornecedores} ${sim.fornecedores === 1 ? 'fornecedor' : 'fornecedores'}`;
      const abaixo = totalVencedora !== null && totalVencedora > 0 ? (1 - sim.soma / totalVencedora) * 100 : null;
      // Arredondado a 1 casa (o que a tela mostra): "0,0% abaixo" nao informa nada.
      const abaixoArredondado = abaixo === null ? null : Math.round(abaixo * 10) / 10;
      // "Sem economia" = diferenca menor que 1 centavo (tolera ruido de ponto flutuante).
      if (totalVencedora !== null && Math.round(sim.soma * 100) >= Math.round(totalVencedora * 100)) {
        faixa = <span>A vencedora já tem o menor preço em todos os itens. Informativo: não entra no ranking.</span>;
      } else {
        // Economia real mas menor que 0,05%: arredondar a 1 casa daria "0,0%"; diz "menos de 0,1%".
        const economiaMinima = abaixo !== null && abaixoArredondado !== null && abaixoArredondado <= 0;
        faixa = (
          <span>
            Comprando o menor preço de cada item, o total seria{' '}
            <strong className="cmp-mono">
              {prefixo}
              {formatarNumero(sim.soma)}
            </strong>
            {totalVencedora !== null && abaixoArredondado !== null && (
              <>
                {' '}
                ({economiaMinima ? 'menos de 0,1%' : `${formatarNumero(abaixoArredondado, 1)}%`} abaixo da vencedora,{' '}
                <span className="cmp-mono">
                  {prefixo}
                  {formatarNumero(totalVencedora)}
                </span>
                )
              </>
            )}
            , dividido entre <strong>{nForn}</strong>. Informativo: não entra no ranking.
          </span>
        );
      }
    }
  }

  return (
    <div className="cmp-pi">
      <div className="cmp-pi__controles">
        <label className="cmp-pi__switch">
          <input
            type="checkbox"
            role="switch"
            className="cmp-pi__switch-input"
            checked={destacarMenor}
            onChange={(e) => setDestacarMenor(e.target.checked)}
          />
          <span className="cmp-pi__trilho" aria-hidden="true" />
          Destacar menor preço
        </label>
        <label className="cmp-pi__switch">
          <input
            type="checkbox"
            role="switch"
            className="cmp-pi__switch-input"
            checked={mostrarDiferenca}
            onChange={(e) => setMostrarDiferenca(e.target.checked)}
          />
          <span className="cmp-pi__trilho" aria-hidden="true" />
          Mostrar diferença vs. menor
        </label>
        <span className="cmp-pi__legenda">{legenda}</span>
      </div>

      {faixa && (
        <div className="cmp-pi__insight" role="status">
          <Icon name="info" size={18} strokeWidth={2} />
          {faixa}
        </div>
      )}

      <div
        className="cmp-pi__rolagem"
        tabIndex={0}
        role="region"
        aria-label="Matriz de preço unitário por item e fornecedor"
      >
        <table className="cmp-pi__matriz">
          <thead>
            <tr>
              <th className="cmp-pi__col-item" scope="col">
                <div className="cmp-pi__cab cmp-pi__cab--esq">
                  <span className="cmp-pi__rotulo">Item</span>
                </div>
              </th>
              <th className="cmp-pi__col-qtd" scope="col">
                <span className="cmp-pi__rotulo">Qtd. pedida</span>
              </th>
              <th className="cmp-pi__col-alvo" scope="col">
                <span className="cmp-pi__rotulo">{alvoRotulo}</span>
              </th>
              {colunas.map((coluna) => (
                <th
                  key={coluna.key}
                  className={coluna.foraDoRanking ? 'cmp-pi__col-forn cmp-pi__col--fora' : 'cmp-pi__col-forn'}
                  scope="col"
                >
                  <div className="cmp-pi__cab">
                    <span className="cmp-pi__cab-nome">{coluna.nome}</span>
                    <span className="cmp-pi__cab-meta">
                      {coluna.foraDoRanking ? (
                        <span className="badge badge--muted">Fora do ranking</span>
                      ) : (
                        <span
                          className={coluna.vencedora ? 'cmp-pi__posicao cmp-pi__posicao--vencedora' : 'cmp-pi__posicao'}
                          title="Posição no ranking"
                        >
                          {coluna.posicao}
                        </span>
                      )}
                      {coluna.vencedora && coluna.rotuloVencedora && (
                        <span className="badge badge--success cmp-winner-badge">
                          <Icon name="trophy" size={12} strokeWidth={2.2} />
                          {coluna.rotuloVencedora}
                        </span>
                      )}
                      {coluna.moeda && !emMoedaDeReferencia(coluna, moedaRef) && (
                        <span className="badge badge--muted">Moeda {coluna.moeda}</span>
                      )}
                    </span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => {
              const subtitulo = subtituloDoItem(item);
              const unidade = formatarUnidade(item.unit);
              const menor = menoresDasLinhas[i] ?? null;
              return (
                <tr key={item.id}>
                  <th className="cmp-pi__col-item" scope="row">
                    <div className="cmp-pi__item">
                      <span className="cmp-pi__item-nome">{item.productName}</span>
                      {subtitulo && <span className="cmp-pi__item-sub">{subtitulo}</span>}
                    </div>
                  </th>
                  <td className="cmp-pi__col-qtd">
                    <span className="cmp-pi__num">
                      {formatarQuantidade(item.quantity)}
                      {unidade && (
                        <>
                          {' '}
                          <span className="cmp-pi__un">{unidade}</span>
                        </>
                      )}
                    </span>
                  </td>
                  <td className="cmp-pi__col-alvo">
                    <span className="cmp-pi__num">{formatarNumero(item.targetPrice)}</span>
                  </td>
                  {colunas.map((coluna, c) => {
                    const celula = celulas[i]?.[c];
                    const classe = coluna.foraDoRanking ? 'cmp-pi__col-forn cmp-pi__col--fora' : 'cmp-pi__col-forn';
                    if (celula?.tipo === 'indisponivel') {
                      return (
                        <td key={coluna.key} className={classe}>
                          <span className="badge badge--warning" title="Item temporariamente indisponível neste fornecedor">
                            Indisponível
                          </span>
                        </td>
                      );
                    }
                    if (celula?.tipo !== 'preco') {
                      return (
                        <td key={coluna.key} className={classe}>
                          <span className="cmp-pi__px-nada" title="Este fornecedor não cotou o item">
                            <span aria-hidden="true">—</span>
                            <span className="sr-only">Não cotou</span>
                          </span>
                        </td>
                      );
                    }
                    const concorre = emMoedaDeReferencia(coluna, moedaRef) && menor !== null;
                    const ehMenor = concorre && celula.unitario === menor;
                    const delta = concorre && !ehMenor ? deltaPercentual(celula.unitario, menor) : null;
                    const qtd = celula.qtdCotada;
                    const un = unidade ? ` ${unidade}` : '';
                    return (
                      <td key={coluna.key} className={classe}>
                        <span className={ehMenor && destacarMenor ? 'cmp-pi__px cmp-pi__px--menor' : 'cmp-pi__px'}>
                          <span className="cmp-pi__px-valor">{formatarNumero(celula.unitario)}</span>
                          {ehMenor && <span className="cmp-pi__px-delta">menor</span>}
                          {delta !== null && mostrarDiferenca && (
                            <span className="cmp-pi__px-delta">+{formatarNumero(delta, 1)}%</span>
                          )}
                          {qtd !== null && (
                            <span
                              className="cmp-pi__px-aviso"
                              title={`Cotou ${formatarQuantidade(qtd)}${un}; pedido ${formatarQuantidade(item.quantity)}${un}. O total usa o unitário × quantidade pedida.`}
                            >
                              <Icon name="alert-triangle" size={12} strokeWidth={2.4} />
                              Qtd {formatarQuantidade(qtd)}
                            </span>
                          )}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="cmp-pi__linha-total">
              <th scope="row">Total dos itens{rotuloRef ? ` (${rotuloRef})` : ''}</th>
              <td />
              <td />
              {colunas.map((coluna) => {
                const classe = coluna.foraDoRanking ? 'cmp-pi__col-forn cmp-pi__col--fora' : 'cmp-pi__col-forn';
                if (coluna.foraDoRanking || coluna.total === null) {
                  return (
                    <td key={coluna.key} className={classe}>
                      <span className="cmp-pi__total" aria-hidden="true">
                        —
                      </span>
                      <span className="sr-only">Sem total</span>
                      <span className="cmp-pi__total-sub">incompleta</span>
                    </td>
                  );
                }
                const ehMenorTotal = totaisMenores.has(coluna.key);
                return (
                  <td key={coluna.key} className={classe}>
                    <span className={ehMenorTotal && destacarMenor ? 'cmp-pi__total cmp-pi__total--menor' : 'cmp-pi__total'}>
                      {formatarNumero(coluna.total)}
                    </span>
                    <span className="cmp-pi__total-sub">
                      {ehMenorTotal
                        ? 'menor total'
                        : menorTotal !== null
                          ? `+${formatarNumero(deltaPercentual(coluna.total, menorTotal), 1)}%`
                          : '—'}
                    </span>
                  </td>
                );
              })}
            </tr>
            <tr>
              <th scope="row">Incoterm · pagamento</th>
              <td />
              <td />
              {colunas.map((coluna) => (
                <td
                  key={coluna.key}
                  className={coluna.foraDoRanking ? 'cmp-pi__col-forn cmp-pi__col--fora' : 'cmp-pi__col-forn'}
                >
                  <span className="chip chip--static cmp-incoterm">{coluna.incoterm ?? '—'}</span>{' '}
                  <span className="cmp-pi__pagamento">
                    {coluna.pagamentoDias !== null ? `${coluna.pagamentoDias} dias` : '—'}
                  </span>
                </td>
              ))}
            </tr>
            <tr>
              <th scope="row">Lead time</th>
              <td />
              <td />
              {colunas.map((coluna) => (
                <td
                  key={coluna.key}
                  className={coluna.foraDoRanking ? 'cmp-pi__col-forn cmp-pi__col--fora' : 'cmp-pi__col-forn'}
                >
                  <span className="cmp-pi__rodape-num">{formatarLeadTime(coluna.leadTimeDias)}</span>
                </td>
              ))}
            </tr>
            <tr>
              <th scope="row">Menor preço em</th>
              <td />
              <td />
              {colunas.map((coluna) => {
                const n = contagem.get(coluna.key) ?? null;
                return (
                  <td
                    key={coluna.key}
                    className={coluna.foraDoRanking ? 'cmp-pi__col-forn cmp-pi__col--fora' : 'cmp-pi__col-forn'}
                  >
                    <span className="cmp-pi__rodape-num">{n === null ? '—' : `${n} de ${items.length}`}</span>
                  </td>
                );
              })}
            </tr>
          </tfoot>
        </table>
      </div>

      {temFora && (
        <p className="cmp-pi__nota">
          Colunas em cinza são propostas fora do ranking (item faltando ou indisponível): os preços aparecem para
          consulta, mas não entram no total nem no score.
        </p>
      )}
      {temViaParceiro && (
        <p className="cmp-pi__nota">Alternativas via parceiro (Credit Support) aparecem só no Ranking.</p>
      )}
    </div>
  );
}
