import type {
  ForecastGrupoRelatorio,
  ForecastItemRelatorio,
  ForecastOcasioesDoItem,
  ForecastOcasioesHoje,
  ForecastRelatorioCompras,
} from '@/services/forecast';
import { dataBr } from './forecastPainel';
import {
  AVISO_ANTES_DE_HOJE,
  AVISO_COMPONENTES_AUSENTES,
  NOTA_OSCILOU,
  ROTULO_ESTIMATIVA,
  TEXTO_OCASIOES_INDISPONIVEIS,
  ariaSeloOcasiao,
  resumoFontesSemPais,
  resumoOcasioes,
  resumoOcasioesAntesDeHoje,
  resumoSemFonteCadastrada,
  textoLeadTimeAjustado,
  textoMemoriaOcasioes,
  textoOcasiaoDaLista,
  textoOcasioesDoGrupo,
  textoSeloOcasiao,
} from './forecastOcasioesRelatorio';

// Ocasioes no lead time no relatorio de compras e na memoria de calculo (PR 3 das ocasioes). So INFORMA: tudo e estimativa e
// nenhum componente aqui muda data-limite, urgencia, ordem nem quantidades. Sem bloco, nada e renderizado.

const ICONE = '◷';

/** Selo ao lado do nome do item: texto + icone (a cor nao e o unico sinal). */
export default function ForecastOcasiaoSelo({ ocasioes }: { ocasioes?: ForecastOcasioesDoItem }) {
  if (!ocasioes) return null;
  return (
    <span className="badge badge--info fcoc-selo" role="img" aria-label={ariaSeloOcasiao(ocasioes.extraDias)}>
      <span className="fcoc-selo__icone" aria-hidden="true">
        {ICONE}
      </span>
      {textoSeloOcasiao(ocasioes.extraDias)}
    </span>
  );
}

/** Sublinha de detalhe do item: lead time e data-limite ajustados, chegada estimada, ocasioes e avisos. */
export function OcasioesDoItemDetalhe({ item }: { item: ForecastItemRelatorio }) {
  const o = item.ocasioes;
  if (!o) return null;
  return (
    <div className="fcoc-detalhe">
      <p className="fcoc-detalhe__titulo">
        <strong>Eventos estrangeiros no lead time</strong> <span className="fcoc-estimativa">{ROTULO_ESTIMATIVA}</span>
      </p>
      <dl className="fcoc-detalhe__lista">
        <div>
          <dt>Lead time ajustado</dt>
          <dd>{textoLeadTimeAjustado(item.leadTimeDias, o.extraDias)}</dd>
        </div>
        <div>
          <dt>Data-limite ajustada</dt>
          <dd>{dataBr(o.dataLimiteAjustada)}</dd>
        </div>
        <div>
          <dt>Chegada estimada</dt>
          <dd>{`${dataBr(o.chegadaEstimada)} (pedido em ${dataBr(o.emissaoAvaliada)})`}</dd>
        </div>
      </dl>
      <ul className="fcoc-detalhe__ocasioes">
        {o.ocasioes.map((x) => (
          <li key={x.id}>{textoOcasiaoDaLista(x)}</li>
        ))}
      </ul>
      {o.antesDeHoje && (
        <p className="fcoc-aviso">
          <span aria-hidden="true">⚠</span> {AVISO_ANTES_DE_HOJE}
        </p>
      )}
      {o.componentesAusentes && <p className="fcoc-aviso">{AVISO_COMPONENTES_AUSENTES}</p>}
      {o.oscilou && <p className="fcoc-nota">{NOTA_OSCILOU}</p>}
    </div>
  );
}

/** Legenda do grupo (fonte): as ocasioes que cruzam os itens e quantos itens. */
export function OcasioesDoGrupoSelo({ grupo }: { grupo: ForecastGrupoRelatorio }) {
  if (!grupo.ocasioes) return null;
  return (
    <span className="badge badge--info fcoc-grupo">
      <span className="fcoc-selo__icone" aria-hidden="true">
        {ICONE}
      </span>
      {textoOcasioesDoGrupo(grupo.ocasioes)}
    </span>
  );
}

/** Itens do resumo do relatorio (dentro de `ul.fcr-resumo__lista`). */
export function OcasioesNoResumo({ dados }: { dados: ForecastRelatorioCompras }) {
  const o = dados.ocasioes;
  if (!o) return null;
  if (o.estado === 'indisponivel') {
    return (
      <li className="fcoc-resumo" role="status">
        {TEXTO_OCASIOES_INDISPONIVEIS}
      </li>
    );
  }
  return (
    <>
      <li className="fcoc-resumo">{resumoOcasioes(o.itensAfetados)}</li>
      {o.antesDeHoje > 0 && <li className="fcoc-resumo">{resumoOcasioesAntesDeHoje(o.antesDeHoje)}</li>}
      {o.itensSemFonteCadastrada > 0 && (
        <li className="fcoc-resumo">{resumoSemFonteCadastrada(o.itensSemFonteCadastrada)}</li>
      )}
      {o.fontesSemPais > 0 && <li className="fcoc-resumo">{resumoFontesSemPais(o.fontesSemPais)}</li>}
    </>
  );
}

/** Memoria de calculo: logo abaixo do "Se a PO sair hoje, chega em", sem mexer no risco. */
export function OcasioesNaMemoria({ ocasioes }: { ocasioes?: ForecastOcasioesHoje }) {
  if (!ocasioes) return null;
  return (
    <>
      <span className="fcoc-memoria">
        {textoMemoriaOcasioes(ocasioes)} <span className="fcoc-estimativa">{ROTULO_ESTIMATIVA}</span>
      </span>
      {ocasioes.componentesAusentes && <span className="fcoc-nota">{AVISO_COMPONENTES_AUSENTES}</span>}
    </>
  );
}
