import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/components/Modal';
import Spinner from '@/components/Spinner';
import { forecastErrorMessage } from '@/services/forecast';
import {
  forecastFontesKeys,
  getForecastPrazoReal,
  patchForecastSourceLeadTime,
  type ForecastPrazoReal,
  type ForecastPrazoRealEstatistica,
  type ForecastPrazoRealFonte,
} from '@/services/forecastFontes';
import { diferencaTexto, ordenarFontes, textoIndisponivel, textoPrazoReal } from './forecastFontes';
import { LEAD_TIME_MAX_DIAS, lerLeadTime } from './forecastPendentes';

interface Props {
  /** admin/comprador editam o lead time (PATCH /forecast/sources/:id); os demais so leem. */
  podeEditar: boolean;
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

export default function ForecastFontesModal({ podeEditar, onFechar }: Props) {
  const prazoReal = useQuery({ queryKey: forecastFontesKeys.prazoReal, queryFn: getForecastPrazoReal });

  return (
    <Modal isOpen onClose={onFechar} title="Fontes e lead time" size="wide">
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
    </Modal>
  );
}
