import { Fragment, useEffect, useRef, useState, type Ref } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import Spinner from '@/components/Spinner';
import {
  baixarForecastRelatorioXlsx,
  forecastErrorMessage,
  forecastKeys,
  getForecastRelatorioCompras,
  type ForecastGrupoRelatorio,
  type ForecastItemRelatorio,
  type ForecastItemSemConsumo,
  type ForecastUrgencia,
} from '@/services/forecast';
import ForecastDemandaComercialModal from './ForecastDemandaComercialModal';
import ForecastEmbalagensModal from './ForecastEmbalagensModal';
import ForecastRelatorioDemandaComercial from './ForecastRelatorioDemandaComercial';
import ForecastRelatorioGrupos, { PrincipalDoGrupo, SeloGrupo, SublinhasDoGrupo } from './ForecastRelatorioGrupos';
import ForecastRelatorioSobDemanda from './ForecastRelatorioSobDemanda';
import { d1, dataBr, inteiroBr, kgBr, mesAbrevDoAnoMes, STATUS_ROTULO } from './forecastPainel';
import {
  APOIO_SEM_CONSUMO,
  badgeDaUrgencia,
  filtrosVisiveis,
  gruposFiltrados,
  itensPorUrgencia,
  paragrafoSemConsumo,
  paragrafoUrgencia,
  resumoDeUrgencia,
  resumoSemConsumo,
  rotuloUrgencia,
  temSemConsumo,
  temUrgencia,
  textoDiasAteRuptura,
  textoMostrando,
  textoMotivos,
  tituloSemConsumo,
  type FiltroUrgencia,
  type ItemComFonte,
  type VisaoRelatorio,
} from './forecastRelatorioUrgencia';
import { forcarClaroNaImpressao } from './impressaoEmClaro';
import {
  contarComMesesForaDaMedia,
  opcoesOutrasComPallet,
  PARAGRAFO_EMBALAGEM,
  palletDoDestaque,
  paragrafoDemandaComercial,
  paragrafoGruposDeEquivalencia,
  paragrafoMesesForaDaMedia,
  paragrafoSobDemanda,
  resumoCobertosPorGrupo,
  resumoDemandaComercial,
  resumoMesesForaDaMedia,
  resumoSobDemanda,
  seloDemandaComercial,
  textoMediaSem,
  textoObservacao,
  tituloOutrasEmbalagens,
} from './forecastRelatorioTextos';

interface Props {
  snapshotId: number;
  /** admin/comprador: mostra o botao que abre o modal de embalagens do item. */
  podeEditar?: boolean;
}

const plural = (n: number, singular: string, pluralForm: string) => (n === 1 ? singular : pluralForm);

interface EmbalagemProps {
  item: ForecastItemRelatorio;
  /** Definido so quando o usuario pode editar e o item tem produto no cadastro. */
  onEditar?: () => void;
  botaoRef?: Ref<HTMLButtonElement>;
}

function Embalagem({ item, onEditar, botaoRef }: EmbalagemProps) {
  const { usada, multiplas } = item.embalagem;
  const botao = onEditar && (
    <button
      type="button"
      ref={botaoRef}
      className="ghost-button fcr-embalagem__editar"
      aria-haspopup="dialog"
      aria-label={`${usada ? 'Editar embalagens de' : 'Cadastrar embalagem de'} ${item.item}`}
      onClick={onEditar}
    >
      {usada ? 'Editar embalagens' : 'Cadastrar embalagem'}
    </button>
  );
  if (!usada) {
    if (!botao) return <span className="badge badge--muted">Embalagem não cadastrada</span>;
    return (
      <span className="fcr-embalagem">
        <span className="badge badge--muted">Embalagem não cadastrada</span>
        {botao}
      </span>
    );
  }
  const outras = opcoesOutrasComPallet(item);
  const palletUsada = palletDoDestaque(item);
  const nome = usada.rotulo ?? `${kgBr(usada.quantidade)} kg`;
  return (
    <span className="fcr-embalagem">
      <span>
        {item.quantidadeEmbalagens} × {nome} (código {usada.codigo})
      </span>
      {multiplas && (
        <span className="badge badge--info" title={tituloOutrasEmbalagens(item)}>
          Arredondado pela embalagem do código {usada.codigo}
        </span>
      )}
      {palletUsada && <span className="fcr-embalagem__pallet">{palletUsada}</span>}
      {outras.map(({ texto, pallet }) => (
        <Fragment key={texto}>
          <span className="fcr-embalagem__outras">{texto}</span>
          {pallet && <span className="fcr-embalagem__pallet">{pallet}</span>}
        </Fragment>
      ))}
      {botao}
    </span>
  );
}

// Observacao da quinzena: linha extra na celula Item, so quando ha texto (a maioria dos itens nao tem).
function Observacao({ obs }: { obs?: string }) {
  const texto = textoObservacao(obs);
  return texto ? <span className="fcr-item__obs">{texto}</span> : null;
}

// Meses atipicos (PR 6c): selo discreto na celula Item quando a media do item nao conta algum mes marcado.
function MediaSem({ meses }: { meses?: string[] }) {
  const texto = textoMediaSem(meses);
  return texto ? (
    <span className="fcr-item__media" title="A média deste item não conta o mês marcado como venda atípica.">
      {texto}
    </span>
  ) : null;
}

// Demanda do comercial (PR 6d): selo discreto no item da lista que tem pedido aberto a somar alem do horizonte.
function SeloDemanda({ kg }: { kg?: number }) {
  return kg && kg > 0 ? (
    <span
      className="fcr-item__demanda"
      title="Pedido do comercial para programação fora do horizonte: soma ao Forecast, veja a seção Demanda do comercial."
    >
      {seloDemandaComercial(kg)}
    </span>
  ) : null;
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

interface LinhaProps {
  item: ForecastItemRelatorio;
  podeEditar: boolean;
  /** Mostra a coluna Urgencia (backend novo). */
  comUrgencia?: boolean;
  diasCritico?: number;
  /** Definido so na visao por urgencia: mostra a coluna Fonte. */
  fonte?: string;
}

function Linha({ item, podeEditar, comUrgencia = false, diasCritico = 0, fonte }: LinhaProps) {
  const { ruptura } = item;
  const urgencia = item.urgencia;
  const productId = item.productId ?? null;
  const [editando, setEditando] = useState(false);
  // Colunas da linha (Item, Urgencia, Fonte e as 9 comuns): a sublinha do grupo ocupa todas.
  const colunas = 1 + (comUrgencia && urgencia ? 1 : 0) + (fonte !== undefined ? 1 : 0) + 9;
  const botao = useRef<HTMLButtonElement>(null);
  const abriuAntes = useRef(false);
  // O dialogo e desmontado ao fechar (o foco cairia no BODY): devolve o foco ao botao que o abriu.
  useEffect(() => {
    if (editando) {
      abriuAntes.current = true;
    } else if (abriuAntes.current) {
      abriuAntes.current = false;
      botao.current?.focus();
    }
  }, [editando]);
  return (
    <>
      <tr
        className={
          urgencia ? `fcr-linha fcr-linha--${urgencia}` : item.vencida ? 'fcr-linha fcr-linha--vencida' : 'fcr-linha'
        }
      >
        <th scope="row">
          <div className="fcr-item">
            <span className="fcr-item__nome">{item.item}</span>
            <SeloGrupo grupo={item.grupo} />
            <span className="fcr-item__codigos">{item.codigos.join(' · ')}</span>
            {item.grupo && <PrincipalDoGrupo grupo={item.grupo} />}
            {item.naoFraciona && <span className="badge badge--warning">Não fraciona</span>}
            <MediaSem meses={item.mesesForaDaMedia} />
            <SeloDemanda kg={item.demandaComercialKg} />
            <Observacao obs={item.obs} />
          </div>
        </th>
        {comUrgencia && urgencia && (
          <td>
            <span className="fcr-urgencia">
              <span className={badgeDaUrgencia(urgencia)}>{rotuloUrgencia(urgencia, diasCritico)}</span>
              <span className="fcr-urgencia__dias">{textoDiasAteRuptura(item.diasAteRuptura)}</span>
            </span>
          </td>
        )}
        {fonte !== undefined && (
          <td>
            {fonte || 'Sem fonte'} · {item.leadTimeDias} dias
          </td>
        )}
        <td>{STATUS_ROTULO[item.status] ?? item.status}</td>
        <td className="fcr-num">{d1(item.demanda)}</td>
        <td className="fcr-num">{d1(item.quantidadeSugerida)}</td>
        <td>
          <Embalagem
            item={item}
            botaoRef={botao}
            onEditar={podeEditar && productId !== null ? () => setEditando(true) : undefined}
          />
          {/* Fora da tabela (portal): o CSS .fcr-tabela td/th nao pode vazar para o dialogo. */}
          {editando &&
            productId !== null &&
            createPortal(
              <ForecastEmbalagensModal productId={productId} podeEditar onFechar={() => setEditando(false)} />,
              document.body,
            )}
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
      {item.grupo && (
        <tr className="fcr-linha-grupo">
          <td colSpan={colunas}>
            <SublinhasDoGrupo grupo={item.grupo} />
          </td>
        </tr>
      )}
    </>
  );
}

const COLUNAS_COMUNS = (
  <>
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
  </>
);

interface GrupoProps {
  grupo: ForecastGrupoRelatorio;
  podeEditar: boolean;
  comUrgencia?: boolean;
  diasCritico?: number;
}

function Grupo({ grupo, podeEditar, comUrgencia = false, diasCritico = 0 }: GrupoProps) {
  // Legenda: no maximo 1 selo de contagem critica (sem estoque agora ou, se nao houver, ruptura em ate N dias).
  const semEstoque = grupo.porUrgencia?.['sem-estoque'] ?? 0;
  const critico = diasCritico > 0 ? (grupo.porUrgencia?.critico ?? 0) : 0;
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
              {semEstoque > 0 && <span className="badge badge--danger">{semEstoque} sem estoque agora</span>}
              {semEstoque === 0 && critico > 0 && (
                <span className="badge badge--danger">
                  {critico} com ruptura em até {diasCritico} dias
                </span>
              )}
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
              {comUrgencia && <th scope="col">Urgência</th>}
              {COLUNAS_COMUNS}
            </tr>
          </thead>
          <tbody>
            {grupo.itens.map((item) => (
              <Linha
                key={item.linha}
                item={item}
                podeEditar={podeEditar}
                comUrgencia={comUrgencia}
                diasCritico={diasCritico}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

interface SecaoUrgenciaProps {
  urgencia: ForecastUrgencia;
  itens: ItemComFonte[];
  diasCritico: number;
  podeEditar: boolean;
}

// Visao "Por urgencia": uma secao por faixa, com a fonte em coluna propria.
function SecaoUrgencia({ urgencia, itens, diasCritico, podeEditar }: SecaoUrgenciaProps) {
  const rotulo = rotuloUrgencia(urgencia, diasCritico);
  return (
    <section className="fc-card fcr-grupo" aria-label={rotulo}>
      <div className="fcr-scroll" role="region" tabIndex={0} aria-label={`Itens: ${rotulo}`}>
        <table className="fcr-tabela">
          <caption className="fcr-caption">
            <div className="fcr-caption__corpo">
              <span>
                {rotulo} · {itens.length} {plural(itens.length, 'item', 'itens')}
              </span>
            </div>
          </caption>
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col">Urgência</th>
              <th scope="col">Fonte</th>
              {COLUNAS_COMUNS}
            </tr>
          </thead>
          <tbody>
            {itens.map(({ item, fonte }) => (
              <Linha
                key={item.linha}
                item={item}
                podeEditar={podeEditar}
                comUrgencia
                diasCritico={diasCritico}
                fonte={fonte}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ListaDeMeses({ prefixo, meses }: { prefixo: string; meses: Array<{ anoMes: string; quantidade: number }> }) {
  if (meses.length === 0) {
    return <span className="fcr-fraco">—</span>;
  }
  return (
    <ul className="fcr-andamento">
      {meses.map((m) => (
        <li key={m.anoMes}>
          {prefixo} {mesAbrevDoAnoMes(m.anoMes)}: {inteiroBr(m.quantidade)}
        </li>
      ))}
    </ul>
  );
}

// Fim do relatorio: itens fora da lista de compra (media zero) que tem estoque ou programacao. So conferencia.
function SecaoSemConsumo({ itens }: { itens: ForecastItemSemConsumo[] }) {
  return (
    <section className="fc-card fcr-grupo fcr-sem-consumo" aria-label="Atenção: sem consumo">
      <div className="fcr-scroll" role="region" tabIndex={0} aria-label="Itens sem consumo">
        <table className="fcr-tabela fcr-tabela--compacta">
          <caption className="fcr-caption">{tituloSemConsumo(itens.length)}</caption>
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col">Fonte</th>
              <th scope="col">Status</th>
              <th scope="col">Motivo</th>
              <th scope="col" className="fcr-num">
                Estoque
              </th>
              <th scope="col">Programações</th>
              <th scope="col">Chegadas</th>
            </tr>
          </thead>
          <tbody>
            {itens.map((i) => (
              <tr key={i.linha} className="fcr-linha">
                <th scope="row">
                  <div className="fcr-item">
                    <span className="fcr-item__nome">{i.item}</span>
                    <SeloGrupo grupo={i.grupo} />
                    <span className="fcr-item__codigos">{i.codigos.join(' · ')}</span>
                    <MediaSem meses={i.mesesForaDaMedia} />
                    <Observacao obs={i.obs} />
                  </div>
                </th>
                <td>
                  {i.fonte || 'Sem fonte'}
                  {i.semLeadTime ? ' (sem lead time)' : ''}
                </td>
                <td>{STATUS_ROTULO[i.status] ?? i.status}</td>
                <td>{textoMotivos(i.motivos, i.sobDemanda === true)}</td>
                <td className="fcr-num">{d1(i.estoque)}</td>
                <td>
                  <ListaDeMeses prefixo="Programação" meses={i.programacoes} />
                </td>
                <td>
                  <ListaDeMeses prefixo="Chegada" meses={i.chegadas} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="fcr-sem-consumo__nota">{APOIO_SEM_CONSUMO}</p>
    </section>
  );
}

export default function ForecastRelatorioCompras({ snapshotId, podeEditar = false }: Props) {
  const relatorio = useQuery({
    queryKey: forecastKeys.relatorio(snapshotId),
    queryFn: () => getForecastRelatorioCompras(snapshotId),
  });
  // Impressao sempre em tema claro (cobre o botao e o Ctrl+P).
  useEffect(() => forcarClaroNaImpressao(), []);
  const xlsx = useMutation({
    mutationFn: (hoje: string) => baixarForecastRelatorioXlsx(snapshotId, hoje),
  });
  // Estado so desta tela (sem URL); o `key` da quinzena reinicia a visao e o filtro.
  const [visao, setVisao] = useState<VisaoRelatorio>('urgencia');
  const [filtro, setFiltro] = useState<FiltroUrgencia>('todas');
  // Demanda do comercial (PR 6d): dialogo de lancamento e aviso de status (fica aqui: a secao some com o ultimo pedido).
  const [lancando, setLancando] = useState(false);
  const [avisoDemanda, setAvisoDemanda] = useState('');
  const botaoLancar = useRef<HTMLButtonElement>(null);

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
  const comUrgencia = temUrgencia(dados);
  const porUrgencia = totais.porUrgencia;
  const diasCritico = dados.urgencia?.diasCritico ?? 0;
  const semConsumo = temSemConsumo(dados) ? dados.semConsumo : undefined;
  // Compra sob demanda (PR 6a): backend antigo nao manda `sobDemanda`; sem item marcado a secao nao aparece.
  const sobDemanda = dados.sobDemanda && dados.sobDemanda.itens.length > 0 ? dados.sobDemanda : undefined;
  // Meses atipicos (PR 6c): so aparece quando algum item usa media sem meses excluidos (backend antigo: nada).
  const comMesesForaDaMedia = contarComMesesForaDaMedia(dados);
  // Demanda do comercial (PR 6d): backend antigo nao manda; sem pedido aberto a secao nao aparece.
  const demandaComercial =
    dados.demandaComercial && dados.demandaComercial.itens.length > 0 ? dados.demandaComercial : undefined;
  // Grupos de equivalencia (PR 6b): backend antigo nao manda; sem membro coberto a secao nao aparece.
  const cobertosPorGrupo =
    dados.cobertosPorGrupo && dados.cobertosPorGrupo.itens.length > 0 ? dados.cobertosPorGrupo : undefined;
  const comGrupos = (dados.gruposDeEquivalencia?.length ?? 0) > 0;
  const fecharLancamento = () => {
    setLancando(false);
    window.setTimeout(() => botaoLancar.current?.focus(), 0);
  };
  const itensDaFaixa = comUrgencia ? itensPorUrgencia(dados, filtro) : [];
  const gruposDaFaixa = comUrgencia ? gruposFiltrados(dados, filtro) : dados.grupos;
  const totalMostrado = visao === 'urgencia' ? itensDaFaixa.length : gruposDaFaixa.reduce((n, g) => n + g.itens.length, 0);

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
          {podeEditar && dados.demandaComercial !== undefined && (
            <button
              type="button"
              ref={botaoLancar}
              className="ghost-button"
              aria-haspopup="dialog"
              onClick={() => {
                setAvisoDemanda('');
                setLancando(true);
              }}
            >
              Lançar demanda do comercial
            </button>
          )}
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
          {avisoDemanda && (
            <p role="status" className="fcr-acoes__ok">
              {avisoDemanda}
            </p>
          )}
        </div>
        <ul className="fcr-resumo__lista">
          <li className={totais.vencidas > 0 ? 'fcr-forte fcr-resumo__alerta' : undefined}>
            {totais.vencidas} com data-limite vencida
          </li>
          {comUrgencia && porUrgencia && <li>{resumoDeUrgencia(porUrgencia, diasCritico)}</li>}
          <li>{totais.semEmbalagem} sem embalagem cadastrada</li>
          {totais.multiplasEmbalagens > 0 && <li>{totais.multiplasEmbalagens} com mais de uma embalagem</li>}
          {(totais.comPallet ?? 0) > 0 && <li>{totais.comPallet} com pallet cadastrado</li>}
          {sobDemanda && <li>{resumoSobDemanda(fora.sobDemanda ?? sobDemanda.itens.length)}</li>}
          {comMesesForaDaMedia > 0 && <li>{resumoMesesForaDaMedia(comMesesForaDaMedia)}</li>}
          {demandaComercial && (
            <li>{resumoDemandaComercial(demandaComercial.totais.abertas, demandaComercial.totais.sugeridoKg)}</li>
          )}
          {cobertosPorGrupo && <li>{resumoCobertosPorGrupo(cobertosPorGrupo.itens.length)}</li>}
        </ul>
        {comUrgencia && porUrgencia && (
          <div className="fcr-controles">
            <div className="fc-filtros" role="group" aria-label="Organizar relatório">
              <button type="button" className="fc-filtro" aria-pressed={visao === 'urgencia'} onClick={() => setVisao('urgencia')}>
                Por urgência
              </button>
              <button type="button" className="fc-filtro" aria-pressed={visao === 'fonte'} onClick={() => setVisao('fonte')}>
                Por fonte
              </button>
            </div>
            <div className="fc-filtros" role="group" aria-label="Filtrar por urgência">
              <button type="button" className="fc-filtro" aria-pressed={filtro === 'todas'} onClick={() => setFiltro('todas')}>
                Todas <span className="fc-filtro__conta">{totais.itens}</span>
              </button>
              {filtrosVisiveis(diasCritico).map((u) => (
                <button
                  key={u}
                  type="button"
                  className="fc-filtro"
                  aria-pressed={filtro === u}
                  onClick={() => setFiltro(u)}
                >
                  {rotuloUrgencia(u, diasCritico)} <span className="fc-filtro__conta">{porUrgencia[u]}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {comUrgencia && (
          <p className="fcr-mostrando" aria-live="polite">
            {textoMostrando(totalMostrado, totais.itens, filtro, visao, diasCritico)}
          </p>
        )}
        <p className="fcr-resumo__fora">
          Fora do relatório: {fora.semLeadTime} sem lead time, {fora.semConsumoSemFalta} sem consumo e sem falta
        </p>
        {semConsumo && (
          <p className="fcr-resumo__fora">
            {resumoSemConsumo(semConsumo.itens.length, fora.semConsumoSemMovimento ?? 0)}
          </p>
        )}
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
          <p>{PARAGRAFO_EMBALAGEM}</p>
          {comUrgencia && <p>{paragrafoUrgencia(diasCritico)}</p>}
          {semConsumo && <p>{paragrafoSemConsumo()}</p>}
          {sobDemanda && <p>{paragrafoSobDemanda()}</p>}
          {comMesesForaDaMedia > 0 && <p>{paragrafoMesesForaDaMedia()}</p>}
          {demandaComercial && <p>{paragrafoDemandaComercial()}</p>}
          {comGrupos && <p>{paragrafoGruposDeEquivalencia()}</p>}
        </details>
      </section>
      {dados.grupos.length === 0 ? (
        <div className="empty-state">Nenhum item com demanda ≤ 0 nesta quinzena.</div>
      ) : !comUrgencia ? (
        dados.grupos.map((grupo) => <Grupo key={grupo.fonte} grupo={grupo} podeEditar={podeEditar} />)
      ) : totalMostrado === 0 ? (
        <div className="empty-state">Nenhum item nesta faixa.</div>
      ) : visao === 'urgencia' ? (
        filtrosVisiveis(diasCritico).map((u) => {
          const itens = itensDaFaixa.filter(({ item }) => item.urgencia === u);
          return itens.length > 0 ? (
            <SecaoUrgencia key={u} urgencia={u} itens={itens} diasCritico={diasCritico} podeEditar={podeEditar} />
          ) : null;
        })
      ) : (
        gruposDaFaixa.map((grupo) => (
          <Grupo key={grupo.fonte} grupo={grupo} podeEditar={podeEditar} comUrgencia diasCritico={diasCritico} />
        ))
      )}
      {demandaComercial && (
        <ForecastRelatorioDemandaComercial
          dados={demandaComercial}
          podeEditar={podeEditar}
          hoje={quinzena.hoje}
          onConcluido={setAvisoDemanda}
        />
      )}
      {cobertosPorGrupo && <ForecastRelatorioGrupos itens={cobertosPorGrupo.itens} />}
      {semConsumo && semConsumo.itens.length > 0 && <SecaoSemConsumo itens={semConsumo.itens} />}
      {sobDemanda && <ForecastRelatorioSobDemanda itens={sobDemanda.itens} />}
      {lancando &&
        createPortal(
          <ForecastDemandaComercialModal hoje={quinzena.hoje} onFechar={fecharLancamento} onSalvo={setAvisoDemanda} />,
          document.body,
        )}
    </>
  );
}
