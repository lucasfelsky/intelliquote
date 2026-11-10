import { Fragment, useEffect, useId, useRef, useState, type ReactNode, type Ref } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import Spinner from '@/components/Spinner';
import { Icon } from '@/components/icons';
import { InfoPopover } from '@/components/InfoPopover';
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
import { ForecastDecisaoLeitura, ProvedorDecisoesCompra } from './ForecastDecisaoCompra';
import ForecastEmbalagensModal from './ForecastEmbalagensModal';
import ForecastCotar from './ForecastCotar';
import { ProvedorCriarCotacao, textoRascunhoDaLinha, useCriarCotacao } from './ForecastCriarCotacao';
import type { ItemSelecionado } from './forecastCriarCotacaoRegras';
import ForecastOcasiaoSelo, { OcasioesDoGrupoSelo, OcasioesDoItemDetalhe, OcasioesNoResumo } from './ForecastOcasiaoSelo';
import { AlternarGrupo } from './ForecastAlternarGrupo';
import ForecastRelatorioDemandaComercial from './ForecastRelatorioDemandaComercial';
import ForecastRelatorioGrupos, { PrincipalDoGrupo, SeloGrupo, SublinhasDoGrupo } from './ForecastRelatorioGrupos';
import ForecastRelatorioSobDemanda from './ForecastRelatorioSobDemanda';
import { APOIO_OCASIOES, PARAGRAFO_OCASIOES } from './forecastOcasioesRelatorio';
import { d1, dataBr, inteiroBr, kgBr, mesAbrevDoAnoMes, STATUS_ROTULO } from './forecastPainel';
import { useBaixarPlanilhaMacro } from './useBaixarPlanilhaMacro';
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
  palletsDoDestaque,
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

/**
 * Indicador do resumo (refino visual, etapa 3). Recebe a frase de sempre ("88 com data-limite vencida",
 * "6 demandas do comercial abertas (2.225 kg sugeridos)") e a desenha como numero grande + rotulo (+ detalhe entre
 * parenteses). A frase inteira continua no DOM, so para o leitor de tela e para o papel; a parte visual e aria-hidden.
 */
function Indicador({ frase, tom, extras = [] }: { frase: string; tom?: 'danger' | 'warning'; extras?: string[] }) {
  const partes = /^(\S+)\s+(.*)$/.exec(frase);
  const numero = partes?.[1] ?? '';
  const resto = partes?.[2] ?? frase;
  const detalhe = /^(.*?)\s*\((.*)\)$/.exec(resto);
  const rotulo = detalhe?.[1] ?? resto;
  return (
    <li className={`fcr-ind${tom ? ` fcr-ind--${tom}` : ''}`}>
      <span className="fcr-so-leitor">{frase}</span>
      <span className="fcr-ind__n" aria-hidden="true">
        {numero}
      </span>
      <span className="fcr-ind__k" aria-hidden="true">
        {rotulo}
      </span>
      {detalhe?.[2] && (
        <span className="fcr-ind__s" aria-hidden="true">
          {detalhe[2]}
        </span>
      )}
      {/* Frases secundarias do mesmo tema (ex.: "7 com mais de uma embalagem"): texto de verdade, sem aria-hidden. */}
      {extras.map((texto) => (
        <span key={texto} className="fcr-ind__s fcr-ind__extra">
          {texto}
        </span>
      ))}
    </li>
  );
}

/**
 * Quinto indicador: ajustes de calculo (media sem meses atipicos, cobertos por grupo de equivalencia). Mostra a soma de
 * itens e abre o detalhe num balao; as frases de sempre ficam no DOM para o leitor de tela e para o papel.
 */
function Ajustes({
  meses,
  grupos,
}: {
  meses: { n: number; frase: string } | null;
  grupos: { n: number; frase: string } | null;
}) {
  if (!meses && !grupos) return null;
  const frases = [meses?.frase, grupos?.frase].filter((f): f is string => Boolean(f));
  const origens = [meses ? 'média atípica' : null, grupos ? 'grupo' : null].filter((o): o is string => o !== null);
  return (
    <li className="fcr-ind">
      {frases.map((frase) => (
        <span key={frase} className="fcr-so-leitor">
          {frase}
        </span>
      ))}
      <span className="fcr-ind__n" aria-hidden="true">
        {(meses?.n ?? 0) + (grupos?.n ?? 0)}
      </span>
      <span className="fcr-ind__k fcr-ind__k--com-info" aria-hidden="true">
        Ajustes de cálculo
      </span>
      <span className="fcr-ind__s" aria-hidden="true">
        {origens.join(' · ')}
      </span>
      <InfoPopover label="Ajustes de cálculo: ver detalhes" tone="info" className="fcr-ind__info" trigger={<Icon name="info" size={14} />}>
        <ul className="cmp-popover__lista">
          {frases.map((frase) => (
            <li key={frase}>{frase}</li>
          ))}
        </ul>
      </InfoPopover>
    </li>
  );
}

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
      title={usada ? 'Editar embalagens' : 'Cadastrar embalagem'}
      onClick={onEditar}
    >
      {/* So icone na tela (refino visual, etapa 4); o texto segue no botao para o leitor de tela. */}
      <Icon name={usada ? 'edit' : 'plus'} size={14} />
      <span className="fcr-so-leitor">{usada ? 'Editar embalagens' : 'Cadastrar embalagem'}</span>
    </button>
  );
  if (!usada) {
    if (!botao) return <span className="badge badge--muted">Embalagem não cadastrada</span>;
    return (
      <span className="fcr-embalagem fcr-embalagem--vazia">
        <span className="badge badge--muted">Embalagem não cadastrada</span>
        {botao}
      </span>
    );
  }
  const outras = opcoesOutrasComPallet(item);
  const palletsUsada = palletsDoDestaque(item);
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
      {palletsUsada.map((texto) => (
        <span key={texto} className="fcr-embalagem__pallet">
          {texto}
        </span>
      ))}
      {outras.map(({ texto, pallet, outrosPallets }) => (
        <Fragment key={texto}>
          <span className="fcr-embalagem__outras">{texto}</span>
          {pallet && <span className="fcr-embalagem__pallet">{pallet}</span>}
          {outrosPallets.map((p) => (
            <span key={p} className="fcr-embalagem__pallet">
              {p}
            </span>
          ))}
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
  /** Fonte do grupo em que o item aparece (sempre definida; o pop-up Cotar agrupa por ela). */
  fonteDoItem: string;
}

/** Selecao da linha para o pop-up "Criar cotacao" (E6): so aparece para quem pode criar cotacao. */
function SelecaoDaLinha({ item, fonte }: { item: ForecastItemRelatorio; fonte: string }) {
  const ctx = useCriarCotacao();
  if (!ctx) return null;
  const id = item.productId ?? null;
  const motivo = ctx.motivoSemSelecao(item);
  return (
    <td className="fcr-sel">
      {id !== null && (
        <input
          type="checkbox"
          className="fcr-sel__caixa"
          aria-label={`Selecionar ${item.item}`}
          title={motivo ?? undefined}
          checked={ctx.selecionados.has(id)}
          disabled={motivo !== null}
          onChange={() => ctx.alternar({ item, fonte })}
        />
      )}
    </td>
  );
}

/** "Selecionar todos" do cabecalho da tabela (so os itens que podem ser marcados); parcial = indeterminado. */
function SelecionarTodos({ itens, rotulo }: { itens: ItemSelecionado[]; rotulo: string }) {
  const ctx = useCriarCotacao();
  const caixa = useRef<HTMLInputElement>(null);
  const marcaveis = ctx ? itens.filter((s) => s.item.productId != null && ctx.podeSelecionar(s.item)) : [];
  const marcados = ctx ? marcaveis.filter((s) => ctx.selecionados.has(s.item.productId as number)).length : 0;
  const todos = marcaveis.length > 0 && marcados === marcaveis.length;
  useEffect(() => {
    if (caixa.current) caixa.current.indeterminate = marcados > 0 && !todos;
  }, [marcados, todos]);
  if (!ctx) return null;
  return (
    <th scope="col" className="fcr-sel">
      <input
        ref={caixa}
        type="checkbox"
        className="fcr-sel__caixa"
        aria-label={`Selecionar todos os itens ${rotulo}`}
        checked={todos}
        disabled={marcaveis.length === 0}
        onChange={() => ctx.marcar(marcaveis, !todos)}
      />
    </th>
  );
}

/** Marca "Rascunho" na celula do status quando o item esta no rascunho da pessoa (E6). */
function RascunhoDaLinha({ item }: { item: ForecastItemRelatorio }) {
  const ctx = useCriarCotacao();
  const noRascunho = ctx && item.productId != null ? ctx.noRascunho(item.productId) : undefined;
  if (!ctx || !noRascunho) return null;
  return (
    <span className="fcl-rascunho">
      <span className="badge badge--muted">Rascunho</span>
      <span className="fcr-fraco">{textoRascunhoDaLinha(ctx.rascunho, noRascunho)}</span>
    </span>
  );
}

/** Um bloco do expansor "Detalhes": rotulo pequeno + conteudo. */
function Detalhe({ rotulo, children, largo = false }: { rotulo: string; children: ReactNode; largo?: boolean }) {
  return (
    <div className={largo ? 'fcr-det fcr-det--largo' : 'fcr-det'}>
      <div className="fcr-det__rotulo">{rotulo}</div>
      <div className="fcr-det__valor">{children}</div>
    </div>
  );
}

function Linha({ item, podeEditar, comUrgencia = false, diasCritico = 0, fonte, fonteDoItem }: LinhaProps) {
  const { ruptura } = item;
  const urgencia = item.urgencia;
  const productId = item.productId ?? null;
  const [editando, setEditando] = useState(false);
  // Detalhes (refino do relatorio, etapa E1): o que saiu da linha (demanda, embalagem, andamento, saldo, media, obs.) e a
  // decisao de compra ficam num expansor sob o item. Fechado por padrao; no papel sai aberto.
  const [aberto, setAberto] = useState(false);
  const idDetalhes = useId();
  // Colunas da linha (Item, Urgencia, Fonte e as 4 comuns): a sublinha do grupo e o expansor ocupam todas.
  const comSelecao = useCriarCotacao() !== null;
  const colunas = (comSelecao ? 1 : 0) + 1 + (comUrgencia && urgencia ? 1 : 0) + (fonte !== undefined ? 1 : 0) + 4;
  const botao = useRef<HTMLButtonElement>(null);
  const abriuAntes = useRef(false);
  const focoPendente = useRef(false);
  // O dialogo e desmontado ao fechar (o foco cairia no BODY): devolve o foco ao botao que o abriu. Se o expansor foi
  // fechado enquanto o dialogo estava aberto, reabre antes (o botao fica numa linha oculta e nao recebe foco).
  useEffect(() => {
    if (editando) {
      abriuAntes.current = true;
    } else if (abriuAntes.current) {
      abriuAntes.current = false;
      if (aberto) {
        botao.current?.focus();
      } else {
        focoPendente.current = true;
        setAberto(true);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editando]);
  useEffect(() => {
    if (aberto && focoPendente.current) {
      focoPendente.current = false;
      botao.current?.focus();
    }
  }, [aberto]);
  const mediaSem = textoMediaSem(item.mesesForaDaMedia);
  const obs = textoObservacao(item.obs);
  return (
    <>
      <tr
        className={
          urgencia ? `fcr-linha fcr-linha--${urgencia}` : item.vencida ? 'fcr-linha fcr-linha--vencida' : 'fcr-linha'
        }
      >
        <SelecaoDaLinha item={item} fonte={fonteDoItem} />
        <th scope="row">
          <div className="fcr-item">
            <span className="fcr-item__nome">{item.item}</span>
            <SeloGrupo grupo={item.grupo} />
            <span className="fcr-item__codigos" title={item.codigos.join(' · ')}>
              {item.codigos.join(' · ')}
            </span>
            {item.grupo && <PrincipalDoGrupo grupo={item.grupo} />}
            <SeloDemanda kg={item.demandaComercialKg} />
            <ForecastOcasiaoSelo ocasioes={item.ocasioes} />
            <button
              type="button"
              className="fcr-detalhes__alternar"
              aria-expanded={aberto}
              aria-controls={idDetalhes}
              aria-label={`${aberto ? 'Recolher' : 'Ver'} detalhes de ${item.item}`}
              onClick={() => setAberto((a) => !a)}
            >
              Detalhes
              <Icon name={aberto ? 'chevron-up' : 'chevron-down'} size={14} />
            </button>
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
          <td className="fcr-fonte">
            {fonte || 'Sem fonte'} · {item.leadTimeDias} dias
          </td>
        )}
        <td className="fcr-num fcr-forte">{d1(item.quantidadeSugerida)}</td>
        <td className="fcr-col-limite">
          <span className="fcr-limite">
            <span className={item.vencida ? 'fcr-forte fcr-limite__data--vencida' : 'fcr-forte'}>
              {item.dataLimite ? dataBr(item.dataLimite) : '—'}
            </span>
            {item.vencida && <span className="badge badge--danger">Vencida</span>}
          </span>
        </td>
        <td className="fcr-status">
          {STATUS_ROTULO[item.status] ?? item.status}
          <RascunhoDaLinha item={item} />
        </td>
        <td className="fcr-acao">
          <ForecastCotar item={item} fonte={fonteDoItem} />
        </td>
      </tr>
      <tr id={idDetalhes} className="fcr-detalhes" hidden={!aberto}>
        <td colSpan={colunas}>
          <div className="fcr-detalhes__grade">
            <Detalhe rotulo="Demanda">
              <span className="fcr-mono">{d1(item.demanda)}</span>
            </Detalhe>
            <Detalhe rotulo="Qtd. final">
              <span className="fcr-mono">{d1(item.quantidadeFinal)}</span>
            </Detalhe>
            <Detalhe rotulo="Saldo e ruptura">
              <span className="fcr-limite__prazos">
                <span>
                  <span className="fcr-fraco">Saldo zera</span> <span className="fcr-mono">{ruptura ? mesAbrevDoAnoMes(ruptura.anoMes) : '—'}</span>
                </span>
                <span>
                  <span className="fcr-fraco">Ruptura</span>{' '}
                  <span>{ruptura ? (ruptura.jaNaDataBase ? 'já na data-base' : dataBr(ruptura.data)) : 'sem ruptura em 6 meses'}</span>
                </span>
              </span>
            </Detalhe>
            <Detalhe rotulo="Em andamento">
              <EmAndamento item={item} />
            </Detalhe>
            <Detalhe rotulo="Embalagem" largo>
              {item.naoFraciona && <span className="badge badge--warning">Não fraciona</span>}
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
            </Detalhe>
            {mediaSem && (
              <Detalhe rotulo="Média">
                <MediaSem meses={item.mesesForaDaMedia} />
              </Detalhe>
            )}
            {obs && (
              <Detalhe rotulo="Observação" largo>
                <Observacao obs={item.obs} />
              </Detalhe>
            )}
            <Detalhe rotulo="Decisão de compra" largo>
              <div className="fdec-celula">
                <ForecastDecisaoLeitura item={item} />
              </div>
            </Detalhe>
          </div>
        </td>
      </tr>
      {item.grupo && (
        <tr className="fcr-linha-grupo">
          <td colSpan={colunas}>
            <SublinhasDoGrupo grupo={item.grupo} />
          </td>
        </tr>
      )}
      {item.ocasioes && (
        <tr className="fcoc-linha">
          <td colSpan={colunas}>
            <OcasioesDoItemDetalhe item={item} />
          </td>
        </tr>
      )}
    </>
  );
}

const COLUNAS_COMUNS = (
  <>
    <th scope="col" className="fcr-num">
      Qtd. sugerida
    </th>
    <th scope="col">Data-limite</th>
    <th scope="col">Status</th>
    <th scope="col" className="fcr-acao">
      <span className="fcr-so-leitor">Ação</span>
    </th>
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
  const [aberto, setAberto] = useState(true);
  return (
    <section className="fc-card fcr-grupo" aria-label={`Fonte ${grupo.fonte || 'sem nome'}`}>
      <div className="fcr-scroll" role="region" tabIndex={0} aria-label={`Itens da fonte ${grupo.fonte || 'sem nome'}`}>
        <table className="fcr-tabela">
          <caption className="fcr-caption">
            <div className="fcr-caption__corpo">
              <AlternarGrupo aberto={aberto} aoAlternar={() => setAberto((a) => !a)} nome={`a fonte ${grupo.fonte || 'sem nome'}`} />
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
              <OcasioesDoGrupoSelo grupo={grupo} />
            </div>
          </caption>
          <thead hidden={!aberto}>
            <tr>
              <SelecionarTodos
                itens={grupo.itens.map((item) => ({ item, fonte: grupo.fonte }))}
                rotulo={`da fonte ${grupo.fonte || 'sem nome'}`}
              />
              <th scope="col">Item</th>
              {comUrgencia && <th scope="col">Urgência</th>}
              {COLUNAS_COMUNS}
            </tr>
          </thead>
          <tbody hidden={!aberto}>
            {grupo.itens.map((item) => (
              <Linha
                key={item.linha}
                item={item}
                podeEditar={podeEditar}
                comUrgencia={comUrgencia}
                diasCritico={diasCritico}
                fonteDoItem={grupo.fonte}
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
  const [aberto, setAberto] = useState(true);
  return (
    <section className="fc-card fcr-grupo" aria-label={rotulo}>
      <div className="fcr-scroll" role="region" tabIndex={0} aria-label={`Itens: ${rotulo}`}>
        <table className="fcr-tabela">
          <caption className="fcr-caption">
            <div className="fcr-caption__corpo">
              <AlternarGrupo aberto={aberto} aoAlternar={() => setAberto((a) => !a)} nome={`a faixa ${rotulo}`} />
              <span>
                {rotulo} · {itens.length} {plural(itens.length, 'item', 'itens')}
              </span>
            </div>
          </caption>
          <thead hidden={!aberto}>
            <tr>
              <SelecionarTodos itens={itens.map(({ item, fonte }) => ({ item, fonte }))} rotulo={`da faixa ${rotulo}`} />
              <th scope="col">Item</th>
              <th scope="col">Urgência</th>
              <th scope="col">Fonte</th>
              {COLUNAS_COMUNS}
            </tr>
          </thead>
          <tbody hidden={!aberto}>
            {itens.map(({ item, fonte }) => (
              <Linha
                key={item.linha}
                item={item}
                podeEditar={podeEditar}
                comUrgencia
                diasCritico={diasCritico}
                fonte={fonte}
                fonteDoItem={fonte}
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
  const [aberto, setAberto] = useState(false);
  return (
    <section className="fc-card fcr-grupo fcr-sem-consumo" aria-label="Atenção: sem consumo">
      <div className="fcr-scroll" role="region" tabIndex={0} aria-label="Itens sem consumo">
        <table className="fcr-tabela fcr-tabela--compacta">
          <caption className="fcr-caption">
            <div className="fcr-caption__corpo">
              <AlternarGrupo aberto={aberto} aoAlternar={() => setAberto((a) => !a)} nome="a seção Sem consumo" />
              <span>{tituloSemConsumo(itens.length)}</span>
            </div>
          </caption>
          <thead hidden={!aberto}>
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
          <tbody hidden={!aberto}>
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
      <p className="fcr-sem-consumo__nota" hidden={!aberto}>{APOIO_SEM_CONSUMO}</p>
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
  // Planilha no layout da aba FORECAST (MACRO) do PO.COMP.01 (mesma rota, ?layout=macro).
  const macro = useBaixarPlanilhaMacro(snapshotId);
  // Estado so desta tela (sem URL); o `key` da quinzena reinicia a visao e o filtro.
  const [visao, setVisao] = useState<VisaoRelatorio>('urgencia');
  const [filtro, setFiltro] = useState<FiltroUrgencia>('todas');
  // Demanda do comercial (PR 6d): dialogo de lancamento e aviso de status (fica aqui: a secao some com o ultimo pedido).
  const [lancando, setLancando] = useState(false);
  const [avisoDemanda, setAvisoDemanda] = useState('');
  const botaoLancar = useRef<HTMLButtonElement>(null);
  // "Fora da lista de compra": as notas de apoio ficam recolhidas na tela e abertas no papel.
  const [foraAberto, setForaAberto] = useState(false);

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
          {plural(totais.fontes, 'fonte', 'fontes')}{' '}
          <InfoPopover
            label="Como as datas são calculadas"
            tone="info"
            largo
            className="fcr-regra-info"
            trigger={<Icon name="ajuda" size={14} />}
          >
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
            {dados.ocasioes?.estado === 'ok' && <p>{PARAGRAFO_OCASIOES}</p>}
          </InfoPopover>
        </p>
        <p className="fcr-resumo__fora fcr-resumo__quinzena">
          Quinzena {quinzena.label} (base {dataBr(quinzena.baseDate)}) · datas conferidas em {dataBr(quinzena.hoje)}
        </p>
        <div className="fcr-acoes" role="group" aria-label="Exportar relatório">
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
              <Icon name="plus" size={16} />
              Lançar demanda do comercial
            </button>
          )}
          {/* Baixar XLSX com texto; MACRO e Imprimir so com icone (nome acessivel por aria-label, dica ao passar o mouse). */}
          <span className="fcr-botoes">
            <button
              type="button"
              className="ghost-button"
              onClick={() => xlsx.mutate(quinzena.hoje)}
              disabled={xlsx.isPending}
              aria-busy={xlsx.isPending}
            >
              <Icon name="download" size={16} />
              {xlsx.isPending ? 'Gerando XLSX…' : 'Baixar XLSX'}
            </button>
            <button
              type="button"
              className="ghost-button fcr-botoes__icone"
              onClick={() => macro.mutate(quinzena.hoje)}
              disabled={macro.isPending}
              aria-busy={macro.isPending}
              aria-label={macro.isPending ? 'Gerando planilha MACRO…' : 'Baixar planilha MACRO (XLSX)'}
              data-dica={macro.isPending ? 'Gerando planilha MACRO…' : 'Baixar planilha MACRO (XLSX)'}
            >
              <Icon name="file" size={16} />
            </button>
            <button
              type="button"
              className="ghost-button fcr-botoes__icone"
              onClick={() => window.print()}
              aria-label="Imprimir / Salvar como PDF"
              aria-describedby="fcr-dica-impressao"
              data-dica="Imprimir / Salvar como PDF"
            >
              <Icon name="printer" size={16} />
            </button>
          </span>
          <p id="fcr-dica-impressao" className="fcr-acoes__dica fcr-so-leitor">
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
          {macro.isError && (
            <p role="alert" className="fcr-acoes__erro">
              {forecastErrorMessage(macro.error)}
            </p>
          )}
          {macro.isSuccess && (
            <p role="status" className="fcr-acoes__ok">
              Planilha MACRO gerada: {macro.data.fileName}
            </p>
          )}
          {avisoDemanda && (
            <p role="status" className="fcr-acoes__ok">
              {avisoDemanda}
            </p>
          )}
        </div>
        {/* Indicadores (refino visual, etapa 3): cada frase vira numero + rotulo na tela; a frase inteira segue no DOM (leitor de tela e papel). */}
        <ul className="fcr-resumo__lista fcr-ind-grade">
          <Indicador frase={`${totais.vencidas} com data-limite vencida`} tom={totais.vencidas > 0 ? 'danger' : undefined} />
          <Indicador
            frase={`${totais.semEmbalagem} sem embalagem cadastrada`}
            tom={totais.semEmbalagem > 0 ? 'warning' : undefined}
            extras={[
              ...(totais.multiplasEmbalagens > 0 ? [`${totais.multiplasEmbalagens} com mais de uma embalagem`] : []),
              ...((totais.comPallet ?? 0) > 0 ? [`${totais.comPallet} com pallet cadastrado`] : []),
            ]}
          />
          {sobDemanda && <Indicador frase={resumoSobDemanda(fora.sobDemanda ?? sobDemanda.itens.length)} />}
          {demandaComercial && (
            <Indicador frase={resumoDemandaComercial(demandaComercial.totais.abertas, demandaComercial.totais.sugeridoKg)} />
          )}
          <Ajustes
            meses={comMesesForaDaMedia > 0 ? { n: comMesesForaDaMedia, frase: resumoMesesForaDaMedia(comMesesForaDaMedia) } : null}
            grupos={
              cobertosPorGrupo
                ? { n: cobertosPorGrupo.itens.length, frase: resumoCobertosPorGrupo(cobertosPorGrupo.itens.length) }
                : null
            }
          />
          <OcasioesNoResumo dados={dados} />
        </ul>
        {comUrgencia && porUrgencia && (
          <>
            <p className="fcr-so-leitor">{resumoDeUrgencia(porUrgencia, diasCritico)}</p>
            <div className="fcr-urg" aria-hidden="true">
              {filtrosVisiveis(diasCritico).map(
                (u) => porUrgencia[u] > 0 && <span key={u} className={`fcr-urg__seg fcr-urg__seg--${u}`} style={{ flexGrow: porUrgencia[u] }} />,
              )}
            </div>
          </>
        )}
        {comUrgencia && porUrgencia && (
          <div className="fcr-controles">
            <div className="fc-filtros fcr-seg" role="group" aria-label="Organizar relatório">
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
                  <span className={`fcr-ponto fcr-ponto--${u}`} aria-hidden="true" />
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
        <button
          type="button"
          className="fcr-fora__botao"
          aria-expanded={foraAberto}
          aria-controls="fcr-fora"
          onClick={() => setForaAberto((aberto) => !aberto)}
        >
          <Icon name={foraAberto ? 'chevron-down' : 'chevron-right'} size={14} />
          Fora da lista de compra
        </button>
        {/* Recolhido na tela; no papel as notas saem abertas (hidden nao imprime sem o override do @media print). */}
        <div id="fcr-fora" className="fcr-fora" hidden={!foraAberto}>
          <p className="fcr-resumo__fora">
            Fora do relatório: {fora.semLeadTime} sem lead time, {fora.semConsumoSemFalta} sem consumo e sem falta
            {(fora.semCadastro ?? 0) > 0 && `, ${fora.semCadastro} sem cadastro`}
          </p>
          {(fora.semCadastro ?? 0) > 0 && (
            <p className="fcr-resumo__fora">
              {fora.semCadastro} sem cadastro: código do DBCorp ainda não cadastrado, sem fonte, sem lead time e sem sugestão de compra.
            </p>
          )}
          {semConsumo && (
            <p className="fcr-resumo__fora">
              {resumoSemConsumo(semConsumo.itens.length, fora.semConsumoSemMovimento ?? 0)}
            </p>
          )}
          {dados.ocasioes?.estado === 'ok' && <p className="fcr-resumo__fora fcoc-apoio">{APOIO_OCASIOES}</p>}
        </div>
      </section>
      <ProvedorDecisoesCompra snapshotId={snapshotId} podeEditar={podeEditar}>
        <ProvedorCriarCotacao
          snapshotId={snapshotId}
          quinzena={quinzena.label}
          diasCritico={diasCritico}
          itensDaLista={dados.grupos.flatMap((g) => g.itens.map((item) => ({ item, fonte: g.fonte })))}
        >
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
        </ProvedorCriarCotacao>
      </ProvedorDecisoesCompra>
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
