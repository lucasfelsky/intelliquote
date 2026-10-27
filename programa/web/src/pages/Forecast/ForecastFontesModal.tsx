import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/components/Modal';
import Spinner from '@/components/Spinner';
import { Tab, TabList, Tabs } from '@/components/Tabs';
import { forecastErrorMessage } from '@/services/forecast';
import {
  forecastFontesKeys,
  getForecastPrazoReal,
  listForecastSources,
  patchForecastSourceLeadTime,
  type ForecastPrazoReal,
  type ForecastPrazoRealEstatistica,
  type ForecastPrazoRealFonte,
} from '@/services/forecastFontes';
import { diferencaTexto, ordenarFontes, textoIndisponivel, textoPrazoReal } from './forecastFontes';
import { contarSemPais, opcoesDePais, paisPorFonte, textoFontesSemPais } from './forecastOcasioes';
import { LEAD_TIME_MAX_DIAS, lerLeadTime } from './forecastPendentes';
import ForecastFontePais from './ForecastFontePais';
import ForecastOcasioesPanel from './ForecastOcasioesPanel';

/** Aba aberta primeiro: o botao "Fontes e lead time" abre `fontes`; o "Eventos estrangeiros" abre `ocasioes`. */
export type AbaFontes = 'fontes' | 'ocasioes';

interface Props {
  /** admin/comprador editam o lead time (PATCH /forecast/sources/:id); os demais so leem. */
  podeEditar: boolean;
  /** Padrao `fontes`. */
  abaInicial?: AbaFontes;
  onFechar: () => void;
}

const SEM_DADO = '—';
const ERRO_LEAD_TIME = `Informe o lead time em dias (1 a ${LEAD_TIME_MAX_DIAS}).`;

function PrazoReal({ e }: { e: ForecastPrazoRealEstatistica | null | undefined }) {
  if (e?.poucasChegadas) {
    return (
      <>
        <span className="badge badge--muted">poucas chegadas</span> ({e.chegadas})
      </>
    );
  }
  return <>{textoPrazoReal(e)}</>;
}

function textoTopo(dados: ForecastPrazoReal): string {
  const quinzena = dados.quinzena ? `quinzena ${dados.quinzena.label}` : 'última quinzena DBCorp';
  return (
    `Sugestão calculada das chegadas do FUP da ${quinzena} (ETA FINAL nos últimos ${dados.janelaDias} dias). ` +
    'Nada muda sozinho: o lead time só muda quando você salvar e vale a partir da próxima quinzena importada ' +
    '(quinzenas já gravadas não mudam). O import da planilha (aba LEADTIME) sobrescreve o lead time das fontes que estão nela.'
  );
}

function Conteudo({ dados, podeEditar }: { dados: ForecastPrazoReal; podeEditar: boolean }) {
  const queryClient = useQueryClient();
  const baseId = useId();
  const fontes = useMemo(() => ordenarFontes(dados.fontes), [dados.fontes]);
  const [editando, setEditando] = useState<number | null>(null);
  const [rascunho, setRascunho] = useState('');
  const [erroCampo, setErroCampo] = useState('');
  const [aviso, setAviso] = useState('');
  const [focoPara, setFocoPara] = useState<number | null>(null);
  const botoes = useRef(new Map<number, HTMLButtonElement>());
  const campo = useRef<HTMLInputElement>(null);

  // Pais de cada fonte: o prazo-real nao o traz, entao junta com GET /forecast/sources (mesma chave do cadastro de produto).
  const lista = useQuery({ queryKey: forecastFontesKeys.todas, queryFn: listForecastSources });
  const paises = useMemo(() => paisPorFonte(lista.data), [lista.data]);
  const opcoesPais = useMemo(
    () => opcoesDePais(paises ? [...paises.values()].filter((c): c is string => c !== null) : []),
    [paises],
  );
  const avisoSemPais = paises
    ? textoFontesSemPais(
        contarSemPais(
          fontes.map((f) => f.sourceId),
          paises,
        ),
      )
    : null;

  const salvar = useMutation({
    mutationFn: ({ id, dias }: { id: number; dias: number; nome: string }) => patchForecastSourceLeadTime(id, dias),
    onSuccess: async (_salva, { id, dias, nome }) => {
      await queryClient.invalidateQueries({ queryKey: ['forecast', 'fontes'] });
      setAviso(`Lead time de ${nome} salvo: ${dias} dias.`);
      setEditando(null);
      setFocoPara(id);
    },
  });
  const pendente = salvar.isPending;

  // A linha em edicao troca o botao por um formulario: devolve o foco ao botao "Editar" ao sair
  // (so depois do salvamento terminar: com a mutacao pendente o botao ainda esta desabilitado).
  useEffect(() => {
    if (focoPara !== null && editando === null && !pendente) {
      botoes.current.get(focoPara)?.focus();
      setFocoPara(null);
    }
  }, [focoPara, editando, pendente]);

  useEffect(() => {
    if (editando !== null) campo.current?.focus();
  }, [editando]);

  const iniciar = (f: ForecastPrazoRealFonte) => {
    salvar.reset();
    setAviso('');
    setErroCampo('');
    setRascunho(f.leadTimeDays === null ? '' : String(f.leadTimeDays));
    setEditando(f.sourceId);
  };
  const cancelar = (id: number) => {
    salvar.reset();
    setErroCampo('');
    setEditando(null);
    setFocoPara(id);
  };
  const enviar = (evento: FormEvent, f: ForecastPrazoRealFonte) => {
    evento.preventDefault();
    if (pendente) return;
    const dias = lerLeadTime(rascunho);
    if (dias === null) {
      setErroCampo(ERRO_LEAD_TIME);
      campo.current?.focus();
      return;
    }
    setErroCampo('');
    salvar.mutate({ id: f.sourceId, dias, nome: f.nome });
  };

  return (
    <>
      <p className="fcd-dica">{textoTopo(dados)}</p>
      {avisoSemPais && <p className="fcd-dica">{avisoSemPais}</p>}
      {lista.isError && <p className="fcd-dica">Não foi possível carregar o país das fontes.</p>}
      {!dados.disponivel && (
        <p className="fcd-dica" role="status">
          {textoIndisponivel(dados.motivo, dados.quinzena?.label ?? null)}
        </p>
      )}
      {aviso && (
        <div className="alert alert--success" role="status">
          {aviso}
        </div>
      )}
      {salvar.isError && (
        <div className="alert alert--error" role="alert">
          {forecastErrorMessage(salvar.error)}
        </div>
      )}
      <div className="table-wrapper">
        <table className="table">
          <caption className="sr-only">Lead time cadastrado e prazo real por fonte</caption>
          <thead>
            <tr>
              <th scope="col">Fonte</th>
              <th scope="col">País</th>
              <th scope="col">Lead time cadastrado</th>
              <th scope="col">Desembaraço</th>
              <th scope="col">Prazo real PO → ETA FINAL</th>
              <th scope="col">Diferença</th>
              <th scope="col">ETD → ETA FINAL (real)</th>
              <th scope="col">ETD + dias usado no FUP</th>
              {podeEditar && <th scope="col">Ação</th>}
            </tr>
          </thead>
          <tbody>
            {fontes.map((f) => {
              const emEdicao = editando === f.sourceId;
              const erroId = `${baseId}-erro-${f.sourceId}`;
              return (
                <tr key={f.sourceId}>
                  <th scope="row">{f.nome}</th>
                  <td>
                    <ForecastFontePais
                      sourceId={f.sourceId}
                      nome={f.nome}
                      countryCode={paises ? (paises.get(f.sourceId) ?? null) : undefined}
                      podeEditar={podeEditar}
                      opcoes={opcoesPais}
                      onSalvo={setAviso}
                    />
                  </td>
                  <td>
                    {emEdicao ? (
                      <form onSubmit={(e) => enviar(e, f)} noValidate>
                        <input
                          ref={campo}
                          className="input"
                          inputMode="numeric"
                          autoComplete="off"
                          aria-label={`Lead time de ${f.nome} (dias)`}
                          value={rascunho}
                          onChange={(e) => {
                            salvar.reset();
                            setErroCampo('');
                            setRascunho(e.target.value);
                          }}
                          aria-invalid={erroCampo ? true : undefined}
                          aria-describedby={erroCampo ? erroId : undefined}
                          disabled={pendente}
                        />
                        {erroCampo && (
                          <p className="fcd-erro" id={erroId}>
                            {erroCampo}
                          </p>
                        )}
                        <div className="modal-actions">
                          <button type="submit" className="primary-button" disabled={pendente} aria-busy={pendente}>
                            {pendente ? 'Salvando…' : 'Salvar'}
                          </button>
                          <button type="button" className="ghost-button" onClick={() => cancelar(f.sourceId)} disabled={pendente}>
                            Cancelar
                          </button>
                        </div>
                      </form>
                    ) : f.leadTimeDays === null ? (
                      SEM_DADO
                    ) : (
                      `${f.leadTimeDays} dias`
                    )}
                  </td>
                  <td>{f.clearanceDays === null ? SEM_DADO : `${f.clearanceDays} dias`}</td>
                  <td>
                    <PrazoReal e={f.real?.po} />
                  </td>
                  <td>{diferencaTexto(f.real?.po, f.leadTimeDays)}</td>
                  <td>
                    <PrazoReal e={f.real?.etd} />
                  </td>
                  <td>{f.etdDiasUsado} dias</td>
                  {podeEditar && (
                    <td>
                      {!emEdicao && (
                        <button
                          ref={(el) => {
                            if (el) botoes.current.set(f.sourceId, el);
                            else botoes.current.delete(f.sourceId);
                          }}
                          type="button"
                          className="ghost-button"
                          aria-label={`Editar lead time de ${f.nome}`}
                          onClick={() => iniciar(f)}
                          disabled={pendente}
                        >
                          Editar
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {dados.semFonte.chegadas > 0 && (
        <p className="fcd-dica">Chegadas sem fonte no cadastro: {dados.semFonte.chegadas}</p>
      )}
    </>
  );
}

const ABAS_BASE_ID = 'fcf-abas';

/**
 * Painel de aba que continua MONTADO quando inativo (o TabPanel compartilhado desmonta e o rascunho do formulario de
 * evento se perderia ao trocar de aba). Mesmos ids/aria que o Tabs.tsx espera (aria-controls/aria-labelledby).
 */
function PainelDaAba({ valor, ativo, children }: { valor: string; ativo: boolean; children: ReactNode }) {
  return (
    <div
      role="tabpanel"
      id={`${ABAS_BASE_ID}-panel-${valor}`}
      aria-labelledby={`${ABAS_BASE_ID}-tab-${valor}`}
      tabIndex={0}
      className="tabs-panel"
      style={{ outline: 'none' }}
      hidden={!ativo}
    >
      {children}
    </div>
  );
}

export default function ForecastFontesModal({ podeEditar, abaInicial, onFechar }: Props) {
  const prazoReal = useQuery({ queryKey: forecastFontesKeys.prazoReal, queryFn: getForecastPrazoReal });
  const [aba, setAba] = useState<string>(abaInicial ?? 'fontes');
  // A aba Eventos estrangeiros so monta (e so busca dados) na primeira vez em que e aberta; depois fica montada.
  const [abriuOcasioes, setAbriuOcasioes] = useState(abaInicial === 'ocasioes');
  const titulo = abaInicial === 'ocasioes' ? 'Eventos estrangeiros' : 'Fontes e lead time';
  const mudarAba = (valor: string) => {
    if (valor === 'ocasioes') setAbriuOcasioes(true);
    setAba(valor);
  };

  return (
    <Modal isOpen onClose={onFechar} title={titulo} size="xl">
      <div className="fco-abas">
        <Tabs value={aba} onValueChange={mudarAba} baseId={ABAS_BASE_ID}>
          <TabList aria-label={`Seções do diálogo ${titulo}`}>
            <Tab value="fontes">Lead time por fonte</Tab>
            <Tab value="ocasioes">Eventos estrangeiros</Tab>
          </TabList>
          <PainelDaAba valor="fontes" ativo={aba === 'fontes'}>
            {prazoReal.isLoading && (
              <div className="fcd-carregando" role="status">
                <Spinner /> Carregando fontes…
              </div>
            )}
            {prazoReal.isError && (
              <div className="alert alert--error" role="alert">
                <p className="fcd-alert__texto">{forecastErrorMessage(prazoReal.error)}</p>
                <button type="button" className="ghost-button" onClick={() => void prazoReal.refetch()}>
                  Tentar de novo
                </button>
              </div>
            )}
            {prazoReal.isSuccess && <Conteudo dados={prazoReal.data} podeEditar={podeEditar} />}
          </PainelDaAba>
          <PainelDaAba valor="ocasioes" ativo={aba === 'ocasioes'}>
            {abriuOcasioes && <ForecastOcasioesPanel podeEditar={podeEditar} />}
          </PainelDaAba>
        </Tabs>
      </div>
    </Modal>
  );
}
