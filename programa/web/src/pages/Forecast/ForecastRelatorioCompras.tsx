import { useEffect } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import Spinner from '@/components/Spinner';
import {
  baixarForecastRelatorioXlsx,
  forecastErrorMessage,
  forecastKeys,
  getForecastRelatorioCompras,
  type ForecastGrupoRelatorio,
  type ForecastItemRelatorio,
} from '@/services/forecast';
import { d1, dataBr, inteiroBr, mesAbrevDoAnoMes, STATUS_ROTULO } from './forecastPainel';
import { forcarClaroNaImpressao } from './impressaoEmClaro';

interface Props {
  snapshotId: number;
}

const plural = (n: number, singular: string, pluralForm: string) => (n === 1 ? singular : pluralForm);

function Embalagem({ item }: { item: ForecastItemRelatorio }) {
  const { usada, cadastradas, multiplas } = item.embalagem;
  if (!usada) {
    return <span className="badge badge--muted">Embalagem não cadastrada</span>;
  }
  const outras = cadastradas.filter((e) => e.codigo !== usada.codigo);
  const nome = usada.rotulo ?? `${inteiroBr(usada.quantidade)} kg`;
  return (
    <span className="fcr-embalagem">
      <span>
        {item.quantidadeEmbalagens} × {nome} (código {usada.codigo})
      </span>
      {multiplas && (
        <span
          className="badge badge--info"
          title={`Outras embalagens: ${outras.map((e) => `${e.codigo} (${inteiroBr(e.quantidade)} kg)`).join(', ')}`}
        >
          Arredondado pela embalagem do código {usada.codigo}
        </span>
      )}
      {multiplas && (
        <span className="fcr-embalagem__outras">
          Outras: {outras.map((e) => `${e.codigo} (${inteiroBr(e.quantidade)} kg)`).join(', ')}
        </span>
      )}
    </span>
  );
}

function EmAndamento({ item }: { item: ForecastItemRelatorio }) {
  const { chegadas, programacoes } = item.emAndamento;
  if (chegadas.length === 0 && programacoes.length === 0) {
    return <span className="fcr-fraco">—</span>;
  }
  return (
    <ul className="fcr-andamento">
      {chegadas.map((c) => (
        <li key={`c-${c.anoMes}`}>
          Chegada {mesAbrevDoAnoMes(c.anoMes)}: {inteiroBr(c.quantidade)}
        </li>
      ))}
      {programacoes.map((p) => (
        <li key={`p-${p.anoMes}`}>
          Programação {mesAbrevDoAnoMes(p.anoMes)}: {inteiroBr(p.quantidade)}
        </li>
      ))}
    </ul>
  );
}

function Linha({ item }: { item: ForecastItemRelatorio }) {
  const { ruptura } = item;
  return (
    <tr className={item.vencida ? 'fcr-linha fcr-linha--vencida' : 'fcr-linha'}>
      <th scope="row">
        <div className="fcr-item">
          <span className="fcr-item__nome">{item.item}</span>
          <span className="fcr-item__codigos">{item.codigos.join(' · ')}</span>
          {item.naoFraciona && <span className="badge badge--warning">Não fraciona</span>}
        </div>
      </th>
      <td>{STATUS_ROTULO[item.status] ?? item.status}</td>
      <td className="fcr-num">{d1(item.demanda)}</td>
      <td className="fcr-num">{d1(item.quantidadeSugerida)}</td>
      <td>
        <Embalagem item={item} />
      </td>
      <td className="fcr-num fcr-forte">{d1(item.quantidadeFinal)}</td>
      <td>{ruptura ? mesAbrevDoAnoMes(ruptura.anoMes) : '—'}</td>
      <td>{ruptura ? (ruptura.jaNaDataBase ? 'já na data-base' : dataBr(ruptura.data)) : 'sem ruptura em 6 meses'}</td>
      <td>
        <span className="fcr-limite">
          <span className={item.vencida ? 'fcr-forte fcr-limite__data--vencida' : 'fcr-forte'}>
            {item.dataLimite ? dataBr(item.dataLimite) : '—'}
          </span>
          {item.vencida && <span className="badge badge--danger">Vencida</span>}
        </span>
      </td>
      <td>
        <EmAndamento item={item} />
      </td>
    </tr>
  );
}

function Grupo({ grupo }: { grupo: ForecastGrupoRelatorio }) {
  const urgente = grupo.dataLimiteMaisUrgente
    ? `mais urgente ${dataBr(grupo.dataLimiteMaisUrgente)}`
    : 'sem data-limite';
  const titulo = `${grupo.fonte || 'Sem fonte'} · lead time ${grupo.leadTimeDias} dias · ${urgente}`;
  return (
    <section className="fc-card fcr-grupo" aria-label={`Fonte ${grupo.fonte || 'sem nome'}`}>
      <div className="fcr-scroll" role="region" tabIndex={0} aria-label={`Itens da fonte ${grupo.fonte || 'sem nome'}`}>
        <table className="fcr-tabela">
          <caption className="fcr-caption">
            <div className="fcr-caption__corpo">
              <span>{titulo}</span>
              {grupo.vencidas > 0 && (
                <span className="badge badge--danger">
                  {grupo.vencidas} {plural(grupo.vencidas, 'vencida', 'vencidas')}
                </span>
              )}
            </div>
          </caption>
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col">Status</th>
              <th scope="col" className="fcr-num">
                Demanda
              </th>
              <th scope="col" className="fcr-num">
                Qtd. sugerida
              </th>
              <th scope="col">Embalagem</th>
              <th scope="col" className="fcr-num">
                Qtd. final
              </th>
              <th scope="col">Saldo zera</th>
              <th scope="col">Ruptura</th>
              <th scope="col">Data-limite</th>
              <th scope="col">Em andamento</th>
            </tr>
          </thead>
          <tbody>
            {grupo.itens.map((item) => (
              <Linha key={item.linha} item={item} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function ForecastRelatorioCompras({ snapshotId }: Props) {
  const relatorio = useQuery({
    queryKey: forecastKeys.relatorio(snapshotId),
    queryFn: () => getForecastRelatorioCompras(snapshotId),
  });
  // Impressao sempre em tema claro (cobre o botao e o Ctrl+P).
  useEffect(() => forcarClaroNaImpressao(), []);
  const xlsx = useMutation({
    mutationFn: (hoje: string) => baixarForecastRelatorioXlsx(snapshotId, hoje),
  });

  if (relatorio.isLoading) {
    return <Spinner />;
  }
  if (relatorio.isError) {
    return (
      <div className="alert alert--error" role="alert">
        {forecastErrorMessage(relatorio.error)}
      </div>
    );
  }
  const dados = relatorio.data;
  if (!dados) {
    return null;
  }
  const { totais, fora, quinzena } = dados;

  return (
    <>
      <section className="fc-card fcr-resumo" aria-label="Resumo do relatório de compras">
        <p className="fcr-resumo__titulo">
          {totais.itens} {plural(totais.itens, 'item', 'itens')} em {totais.fontes}{' '}
          {plural(totais.fontes, 'fonte', 'fontes')}
        </p>
        <div className="fcr-acoes" role="group" aria-label="Exportar relatório">
          <button
            type="button"
            className="ghost-button"
            onClick={() => xlsx.mutate(quinzena.hoje)}
            disabled={xlsx.isPending}
            aria-busy={xlsx.isPending}
          >
            {xlsx.isPending ? 'Gerando XLSX…' : 'Baixar XLSX'}
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={() => window.print()}
            aria-describedby="fcr-dica-impressao"
          >
            Imprimir / Salvar como PDF
          </button>
          <p id="fcr-dica-impressao" className="fcr-acoes__dica">
            Abre a impressão do navegador; para PDF, escolha “Salvar como PDF” no destino.
          </p>
          {xlsx.isError && (
            <p role="alert" className="fcr-acoes__erro">
              {forecastErrorMessage(xlsx.error)}
            </p>
          )}
          {xlsx.isSuccess && (
            <p role="status" className="fcr-acoes__ok">
              XLSX gerado: {xlsx.data.fileName}
            </p>
          )}
        </div>
        <ul className="fcr-resumo__lista">
          <li className={totais.vencidas > 0 ? 'fcr-forte fcr-resumo__alerta' : undefined}>
            {totais.vencidas} com data-limite vencida
          </li>
          <li>{totais.semEmbalagem} sem embalagem cadastrada</li>
          {totais.multiplasEmbalagens > 0 && <li>{totais.multiplasEmbalagens} com mais de uma embalagem</li>}
        </ul>
        <p className="fcr-resumo__fora">
          Fora do relatório: {fora.semLeadTime} sem lead time, {fora.semConsumoSemFalta} sem consumo e sem falta
        </p>
        <p className="fcr-resumo__fora">
          Quinzena {quinzena.label} (base {dataBr(quinzena.baseDate)}) · datas conferidas em {dataBr(quinzena.hoje)}
        </p>
        <details className="fcr-regra">
          <summary>Como as datas são calculadas</summary>
          <p>
            O saldo zera no primeiro mês em que a projeção do estoque fica negativa. O dia da ruptura é uma
            estimativa: o consumo do mês é distribuído de forma linear (no mês base, a partir da data-base).
          </p>
          <p>
            Data-limite do pedido = ruptura − lead time da fonte, em dias corridos e sem folga. Vencida: a data-limite
            já passou na data de hoje.
          </p>
          <p>
            Quantidade sugerida = demanda em módulo. Com embalagem cadastrada, arredonda para cima em múltiplos da
            embalagem (a principal; sem principal, a do primeiro código).
          </p>
        </details>
      </section>
      {dados.grupos.length === 0 ? (
        <div className="empty-state">Nenhum item com demanda ≤ 0 nesta quinzena.</div>
      ) : (
        dados.grupos.map((grupo) => <Grupo key={grupo.fonte} grupo={grupo} />)
      )}
    </>
  );
}
