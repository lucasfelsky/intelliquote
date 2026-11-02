import { EIXO } from '../waterfall';

interface TrilhoWaterfallProps {
  // Posicao e largura da barra no eixo 0-1000 (atributos SVG; nada de estilo inline).
  x: number;
  largura: number;
  // CIF e Total landed: barra cheia na cor de acao.
  total?: boolean;
  // Posicao da linha tracejada do gatilho (so na linha do Total landed).
  xGatilho?: number;
}

// Trilho de uma linha do waterfall. Decorativo (aria-hidden): o rotulo e o valor da linha ja dizem tudo em texto.
export default function TrilhoWaterfall({ x, largura, total = false, xGatilho }: TrilhoWaterfallProps) {
  return (
    <svg className="manual-wf__svg" viewBox={`0 0 ${EIXO} 18`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <rect x={x} y={0} width={largura} height={18} className={total ? 'manual-wf__barra manual-wf__barra--total' : 'manual-wf__barra'} />
      {xGatilho !== undefined ? <line x1={xGatilho} x2={xGatilho} y1={-6} y2={24} className="manual-wf__linha-gatilho" vectorEffect="non-scaling-stroke" /> : null}
    </svg>
  );
}
