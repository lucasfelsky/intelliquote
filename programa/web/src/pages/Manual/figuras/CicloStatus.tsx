import { useId } from 'react';

// Ciclo da cotacao: so 2 estados, aberta e fechada; "Reaberta" e uma cotacao aberta de novo. Cores por classe manual-sv-* (so tokens).
export default function CicloStatus() {
  const base = useId().replace(/:/g, '');
  const idTitulo = `${base}-titulo`;
  const idSeta = `${base}-seta`;
  return (
    <svg className="manual-svg manual-svg--ciclo" viewBox="0 0 660 150" width="100%" role="img" aria-labelledby={idTitulo}>
      <title id={idTitulo}>Aberta passa a Fechada ao fechar ou concluir. Fechada passa a Reaberta ao reabrir. Reaberta volta a Fechada.</title>
      <defs>
        <marker id={idSeta} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" className="manual-sv-ponta" />
        </marker>
      </defs>
      <rect x="20" y="40" width="130" height="46" rx="23" className="manual-sv-no" />
      <text x="85" y="68" textAnchor="middle" className="manual-sv-t">
        Aberta
      </text>
      <rect x="265" y="40" width="130" height="46" rx="23" className="manual-sv-no manual-sv-no--chave" />
      <text x="330" y="68" textAnchor="middle" className="manual-sv-t manual-sv-t--sobre">
        Fechada
      </text>
      <rect x="510" y="40" width="130" height="46" rx="23" className="manual-sv-no" />
      <text x="575" y="68" textAnchor="middle" className="manual-sv-t">
        Reaberta
      </text>
      <path d="M152 63 H260" className="manual-sv-seta" markerEnd={`url(#${idSeta})`} />
      <text x="206" y="32" textAnchor="middle" className="manual-sv-t manual-sv-t--leve">
        Fechar ou Concluir
      </text>
      <path d="M397 56 H505" className="manual-sv-seta" markerEnd={`url(#${idSeta})`} />
      <text x="451" y="32" textAnchor="middle" className="manual-sv-t manual-sv-t--leve">
        Reabrir
      </text>
      <path d="M560 88 C 540 128, 360 128, 340 92" className="manual-sv-seta" markerEnd={`url(#${idSeta})`} />
      <text x="451" y="136" textAnchor="middle" className="manual-sv-t manual-sv-t--leve">
        Fechar de novo
      </text>
    </svg>
  );
}
