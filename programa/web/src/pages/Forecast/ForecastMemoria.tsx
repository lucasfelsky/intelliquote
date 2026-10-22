import { useEffect, useRef, useState } from 'react';
import type { ForecastLinha } from '@/services/forecast';
import ForecastEmbalagensModal from './ForecastEmbalagensModal';
import { dataBr, passosDaMemoria, risco, type TomValor } from './forecastPainel';

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

export default function ForecastMemoria({ linha, half, baseDate, hoje, podeEditar }: Props) {
  const [embalagens, setEmbalagens] = useState(false);
  const botao = useRef<HTMLButtonElement>(null);
  const abriuAntes = useRef(false);
  // O dialogo e desmontado ao fechar (o foco cairia no BODY): devolve o foco ao botao que o abriu.
  useEffect(() => {
    if (embalagens) {
      abriuAntes.current = true;
    } else if (abriuAntes.current) {
      abriuAntes.current = false;
      botao.current?.focus();
    }
  }, [embalagens]);
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
        </dl>
        <span className="fc-lado__fraco">CHEG. calculada com hoje = {dataBr(hoje)}</span>
      </div>
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
