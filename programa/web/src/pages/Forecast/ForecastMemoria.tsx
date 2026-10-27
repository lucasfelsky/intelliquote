import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ForecastLinha } from '@/services/forecast';
import {
  FORECAST_SOB_DEMANDA_MOTIVO_MAX,
  forecastSobDemandaErrorMessage,
  patchForecastSobDemanda,
} from '@/services/forecastSobDemanda';
import ForecastDetalheItem from './ForecastDetalheItem';
import ForecastEmbalagensModal from './ForecastEmbalagensModal';
import ForecastMesesAtipicosModal from './ForecastMesesAtipicosModal';
import { OcasioesNaMemoria } from './ForecastOcasiaoSelo';
import { dataBr, mesAbrevDoAnoMes, passosDaMemoria, risco, type TomValor } from './forecastPainel';
import { textoMotivoSobDemanda, textoSeloDoGrupo } from './forecastRelatorioTextos';

interface Props {
  linha: ForecastLinha;
  half: number;
  baseDate: string;
  hoje: string;
  /** admin/comprador editam as embalagens; os demais papeis COMEX abrem o modal em leitura. */
  podeEditar: boolean;
}

const CLASSE_DO_TOM: Record<Exclude<TomValor, null>, string> = {
  neg: 'fc-valor--neg',
  falta: 'fc-valor--falta',
  atencao: 'fc-valor--atencao',
};

const classeDoTom = (tom: TomValor) => (tom ? CLASSE_DO_TOM[tom] : '');

const MOTIVO_MIN = 3;

interface CompraProps {
  productId: number;
  marcado: boolean;
  motivo: string | null;
}

// Compra sob demanda (PR 6a): marca por produto, valida para todas as quinzenas (cadastro ATUAL). Quem so le ve o
// estado em texto. O botao usa aria-disabled (nao `disabled`) para o foco nao se perder ao salvar.
function CompraSobDemanda({ productId, marcado: marcadoSalvo, motivo: motivoSalvo }: CompraProps) {
  const queryClient = useQueryClient();
  const idMotivo = useId();
  const idErro = `${idMotivo}-erro`;
  const [salvo, setSalvo] = useState({ marcado: marcadoSalvo, motivo: motivoSalvo ?? '' });
  const [marcado, setMarcado] = useState(marcadoSalvo);
  const [motivo, setMotivo] = useState(motivoSalvo ?? '');
  const [confirmado, setConfirmado] = useState(false);
  // O cadastro mudou fora desta tela (outra pessoa, recarga da quinzena): o rascunho acompanha o servidor.
  useEffect(() => {
    setSalvo({ marcado: marcadoSalvo, motivo: motivoSalvo ?? '' });
    setMarcado(marcadoSalvo);
    setMotivo(motivoSalvo ?? '');
  }, [marcadoSalvo, motivoSalvo]);

  const gravar = useMutation({
    mutationFn: (corpo: { sobDemanda: boolean; motivo: string | null }) => patchForecastSobDemanda(productId, corpo),
    onSuccess: (resposta) => {
      const texto = resposta.motivo ?? '';
      setSalvo({ marcado: resposta.sobDemanda, motivo: texto });
      setMarcado(resposta.sobDemanda);
      setMotivo(texto);
      setConfirmado(true);
      // A marca e do cadastro ATUAL: muda a lista do relatorio de todas as quinzenas e a linha da quinzena aberta.
      void queryClient.invalidateQueries({ queryKey: ['forecast', 'relatorio'] });
      void queryClient.invalidateQueries({ queryKey: ['forecast', 'snapshot'] });
    },
  });

  const texto = motivo.trim();
  const erroMotivo =
    marcado && texto.length > 0 && texto.length < MOTIVO_MIN
      ? `O motivo precisa ter ao menos ${MOTIVO_MIN} caracteres.`
      : null;
  const alterado = marcado !== salvo.marcado || (marcado && texto !== salvo.motivo.trim());
  const pendente = gravar.isPending;
  const podeSalvar = alterado && !erroMotivo && !pendente;

  const salvar = (evento: FormEvent) => {
    evento.preventDefault();
    if (!podeSalvar) return;
    setConfirmado(false);
    gravar.mutate({ sobDemanda: marcado, motivo: marcado && texto ? texto : null });
  };
  const editou = () => {
    setConfirmado(false);
    gravar.reset();
  };

  return (
    <form className="fc-compra" onSubmit={salvar} noValidate>
      <label className="checkbox-field">
        <input
          type="checkbox"
          checked={marcado}
          onChange={(e) => {
            setMarcado(e.target.checked);
            editou();
          }}
        />
        Só compra quando o cliente envia a programação
      </label>
      <label className="field-label" htmlFor={idMotivo}>
        Motivo (opcional)
      </label>
      <input
        id={idMotivo}
        type="text"
        className="input"
        value={motivo}
        maxLength={FORECAST_SOB_DEMANDA_MOTIVO_MAX}
        disabled={!marcado}
        aria-invalid={erroMotivo ? true : undefined}
        aria-describedby={erroMotivo ? idErro : undefined}
        onChange={(e) => {
          setMotivo(e.target.value);
          editou();
        }}
      />
      {erroMotivo && (
        <p id={idErro} className="fce-erro">
          {erroMotivo}
        </p>
      )}
      <button
        type="submit"
        className="ghost-button fc-compra__salvar"
        aria-disabled={!podeSalvar}
        aria-busy={pendente}
      >
        {pendente ? 'Salvando…' : 'Salvar'}
      </button>
      {gravar.isError && (
        <div className="alert alert--error" role="alert">
          {forecastSobDemandaErrorMessage(gravar.error)}
        </div>
      )}
      {confirmado && !gravar.isError && (
        <div className="alert alert--success" role="status">
          Salvo. O relatório foi atualizado.
        </div>
      )}
    </form>
  );
}

export default function ForecastMemoria({ linha, half, baseDate, hoje, podeEditar }: Props) {
  const [embalagens, setEmbalagens] = useState(false);
  const [atipicos, setAtipicos] = useState(false);
  const botao = useRef<HTMLButtonElement>(null);
  const botaoAtipicos = useRef<HTMLButtonElement>(null);
  const abriuAntes = useRef(false);
  const abriuAtipicosAntes = useRef(false);
  // O dialogo e desmontado ao fechar (o foco cairia no BODY): devolve o foco ao botao que o abriu.
  useEffect(() => {
    if (embalagens) {
      abriuAntes.current = true;
    } else if (abriuAntes.current) {
      abriuAntes.current = false;
      botao.current?.focus();
    }
  }, [embalagens]);
  useEffect(() => {
    if (atipicos) {
      abriuAtipicosAntes.current = true;
    } else if (abriuAtipicosAntes.current) {
      abriuAtipicosAntes.current = false;
      botaoAtipicos.current?.focus();
    }
  }, [atipicos]);
  const passos = passosDaMemoria(linha, half, baseDate);
  const situacao = risco(linha, baseDate);
  const codigos = linha.codigos.join(' · ');
  return (
    <section className="fc-memoria" aria-label="Memória de cálculo">
      <div className="card">
        <p className="eyebrow">MEMÓRIA DE CÁLCULO · LINHA {linha.linha} DA PLANILHA</p>
        <h2>{linha.item}</h2>
        <ol className="fc-passos">
          {passos.map((passo, i) => (
            <li key={passo.titulo} className="fc-passo">
              <span className="fc-passo__num">{i + 1}</span>
              <span className="fc-passo__corpo">
                <strong>
                  {passo.titulo} <span className="fc-passo__coluna">{passo.coluna}</span>
                </strong>
                <span className="fc-passo__conta">{passo.conta}</span>
                {passo.nota && <span className="fc-passo__nota">{passo.nota}</span>}
                {passo.meses && (
                  <span className="fc-meses">
                    {passo.meses.map((mes) => (
                      <span key={mes.rotulo} className={`fc-mes ${classeDoTom(mes.tom)}`.trim()}>
                        {mes.rotulo} <b>{mes.valor}</b>
                      </span>
                    ))}
                  </span>
                )}
              </span>
              <span className={`fc-passo__resultado ${classeDoTom(passo.tom)}`.trim()}>{passo.resultado}</span>
            </li>
          ))}
        </ol>
      </div>
      <div className="card fc-lado">
        <p className="eyebrow">LEAD TIME · {linha.fonte || 'sem fonte'}</p>
        <div className="fc-lado__grande">
          {linha.AQ ?? '—'} <small>dias</small>
        </div>
        <span className="fc-lado__fraco">Se a PO sair hoje, chega em</span>
        <div className="fc-lado__medio">{dataBr(linha.AP)}</div>
        <OcasioesNaMemoria ocasioes={linha.ocasioesHoje} />
        <div className={`fc-risco fc-risco--${situacao.tom}`} role="status">
          {situacao.texto}
        </div>
        <dl className="fc-lado__lista">
          <div>
            <dt>Códigos</dt>
            <dd>{codigos || '—'}</dd>
          </div>
          <div>
            <dt>Embalagens</dt>
            <dd>
              {linha.productId != null ? (
                <button
                  type="button"
                  ref={botao}
                  className="ghost-button"
                  aria-haspopup="dialog"
                  onClick={() => setEmbalagens(true)}
                >
                  Embalagens do item
                </button>
              ) : (
                'Produto fora do cadastro'
              )}
            </dd>
          </div>
          {/* Backend antigo nao manda `sobDemanda`: sem a marca no dado, o controle nao aparece. */}
          <div className={podeEditar && linha.productId != null && linha.sobDemanda !== undefined ? 'fc-compra-item' : undefined}>
            <dt>Compra</dt>
            <dd>
              {linha.productId == null || linha.sobDemanda === undefined ? (
                '—'
              ) : podeEditar ? (
                <CompraSobDemanda
                  key={linha.productId}
                  productId={linha.productId}
                  marcado={linha.sobDemanda}
                  motivo={linha.sobDemandaMotivo ?? null}
                />
              ) : linha.sobDemanda ? (
                textoMotivoSobDemanda(linha.sobDemandaMotivo)
              ) : (
                'Compra regular'
              )}
            </dd>
          </div>
          {/* Grupo de equivalencia (PR 6b): so o selo; a memoria continua POR PRODUTO. Backend antigo nao manda `grupo`. */}
          {linha.grupo && (
            <div>
              <dt>Grupo</dt>
              <dd>
                <span className="badge badge--info fcg-selo">{textoSeloDoGrupo(linha.grupo.nome)}</span>
                <span className="fcg-selo__nota">
                  Estoque avaliado somado com os outros produtos do grupo no relatório de compras. Os números acima são só
                  deste produto.
                </span>
              </dd>
            </div>
          )}
          {/* Backend antigo nao manda `mesesForaDaMedia`: sem o campo, a linha nao mostra o controle. */}
          <div className={linha.productId != null && linha.mesesForaDaMedia !== undefined ? 'fc-compra-item' : undefined}>
            <dt>Meses atípicos</dt>
            <dd>
              {linha.productId == null || linha.mesesForaDaMedia === undefined ? (
                '—'
              ) : (
                <>
                  {linha.mesesForaDaMedia.length === 0 ? (
                    <span>Nenhum mês fora da média</span>
                  ) : (
                    <ul className="fc-atipicos">
                      {linha.mesesForaDaMedia.map((m) => (
                        <li key={m.anoMes}>
                          <strong>{mesAbrevDoAnoMes(m.anoMes)}</strong> · {m.motivo}
                        </li>
                      ))}
                    </ul>
                  )}
                  {podeEditar && (
                    <button
                      type="button"
                      ref={botaoAtipicos}
                      className="ghost-button fc-atipicos__editar"
                      aria-haspopup="dialog"
                      onClick={() => setAtipicos(true)}
                    >
                      Meses fora da média
                    </button>
                  )}
                </>
              )}
            </dd>
          </div>
        </dl>
        <ForecastDetalheItem key={linha.productId ?? `sem-${linha.linha}`} linha={linha} />
        <span className="fc-lado__fraco">CHEG. calculada com hoje = {dataBr(hoje)}</span>
      </div>
      {atipicos && linha.productId != null && (
        <ForecastMesesAtipicosModal
          productId={linha.productId}
          baseDate={baseDate}
          linha={linha}
          onFechar={() => setAtipicos(false)}
        />
      )}
      {embalagens && linha.productId != null && (
        <ForecastEmbalagensModal
          productId={linha.productId}
          podeEditar={podeEditar}
          onFechar={() => setEmbalagens(false)}
        />
      )}
    </section>
  );
}
