import TrilhoWaterfall from '../figuras/TrilhoWaterfall';
import { formatar } from '../simulador';
import { calcularWaterfall } from '../waterfall';
import { semDestaque } from './Destacar';

// Waterfall do landed cost: 9 linhas (rotulo | trilho | valor); a linha do Total landed leva a marca tracejada do gatilho de aprovacao.
function WaterfallBase() {
  const { passos, gatilho, xGatilho } = calcularWaterfall();
  return (
    <div className="manual-wf" role="list" aria-label="Composição do landed cost">
      {passos.map((passo) => {
        const ultimo = passo.chave === 'total';
        return (
          <div key={passo.chave} className={passo.total ? 'manual-wf__linha manual-wf__linha--total' : 'manual-wf__linha'} role="listitem">
            <span className="manual-wf__k">{passo.rotulo}</span>
            <span className="manual-wf__trilho">
              <TrilhoWaterfall x={passo.x} largura={passo.largura} total={passo.total} xGatilho={ultimo ? xGatilho : undefined} />
              {ultimo ? <span className="manual-wf__gatilho">gatilho R$ {formatar(gatilho, 0)}</span> : null}
            </span>
            <span className="manual-wf__v">{passo.valorTexto}</span>
          </div>
        );
      })}
    </div>
  );
}

export const Waterfall = semDestaque(WaterfallBase);

export default Waterfall;
