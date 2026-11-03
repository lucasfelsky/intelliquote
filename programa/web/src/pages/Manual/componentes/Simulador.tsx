import { useState } from 'react';
import BarraScore from '../figuras/BarraScore';
import {
  alternarCriterio,
  calcularRanking,
  CRITERIOS,
  CRITERIOS_INICIAIS,
  eixoDoRanking,
  formatar,
  segmentosDaBarra,
  type CriterioId,
} from '../simulador';
import { semDestaque } from './Destacar';

// Simulador de score do capitulo Comparacao: 4 chips (1 ou 2 ligados), mensagem de limite em aria-live e o ranking dos 4 fornecedores de exemplo.
// Fica fora do destaque da busca (os nomes viram parte das barras, que sao figuras).
function SimuladorBase() {
  const [ativos, setAtivos] = useState<readonly CriterioId[]>(CRITERIOS_INICIAIS);
  const [mensagem, setMensagem] = useState('');
  const ranking = calcularRanking(ativos);
  const eixo = eixoDoRanking(ativos.length);
  const criteriosLigados = CRITERIOS.filter((c) => ativos.includes(c.id));

  const alternar = (id: CriterioId) => {
    const resultado = alternarCriterio(ativos, id);
    setAtivos(resultado.ativos);
    setMensagem(resultado.mensagem);
  };

  return (
    <div className="manual-sim">
      <div className="manual-sim__chips" role="group" aria-label="Critérios da comparação">
        {CRITERIOS.map((c) => {
          const ligado = ativos.includes(c.id);
          return (
            <button key={c.id} type="button" className={ligado ? 'chip chip--active manual-sim__chip' : 'chip manual-sim__chip'} aria-pressed={ligado} onClick={() => alternar(c.id)}>
              <span className={`manual-sim__amostra manual-sim__amostra--${c.id}`} aria-hidden="true" />
              {c.rotulo}
            </button>
          );
        })}
      </div>
      <p className="manual-sim__msg" aria-live="polite">
        {mensagem}
      </p>
      <ol className="manual-sim__ranking" role="list">
        {ranking.map((linha, i) => (
          <li key={linha.fornecedor.nome} className={i === 0 ? 'manual-sim__linha manual-sim__linha--primeira' : 'manual-sim__linha'}>
            <span className="manual-sim__posicao">{i + 1}º</span>
            <span className="manual-sim__quem">
              <b className="manual-sim__nome">
                {linha.fornecedor.nome}
                {i === 0 ? <span className="manual-sim__selo">Vencedora</span> : null}
              </b>
              <span className="manual-sim__parcial">{criteriosLigados.map((c) => `${c.curto} ${formatar(linha.pontos[c.id], 2)}`).join(' · ')}</span>
            </span>
            <BarraScore segmentos={segmentosDaBarra(linha.pontos, ativos)} descricao={`Score ${formatar(linha.total, 2)} de ${ativos.length}`} />
            <span className="manual-sim__total">{formatar(linha.total, 2)}</span>
          </li>
        ))}
      </ol>
      <div className="manual-sim__eixo" aria-hidden="true">
        <span />
        <span />
        <div>
          <span>0</span>
          <span>{eixo.meio}</span>
          <span>{eixo.maximo}</span>
        </div>
        <span />
      </div>
    </div>
  );
}

export const Simulador = semDestaque(SimuladorBase);

export default Simulador;
