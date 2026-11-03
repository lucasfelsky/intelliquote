import Destacar from './Destacar';
import type { KpiDeExemplo } from '../dados';

export default function Kpis({ itens }: { itens: readonly KpiDeExemplo[] }) {
  return (
    <div className="manual-kpis">
      {itens.map((kpi) => (
        <div key={kpi.rotulo} className="manual-kpi">
          <Destacar>
            <span className="manual-kpi__rotulo">{kpi.rotulo}</span>
            <strong className="manual-kpi__valor">{kpi.valor}</strong>
            <span className="manual-kpi__detalhe">{kpi.detalhe}</span>
          </Destacar>
        </div>
      ))}
    </div>
  );
}
