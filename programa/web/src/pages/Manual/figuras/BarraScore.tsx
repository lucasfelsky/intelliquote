import { useId } from 'react';
import { LARGURA_DA_BARRA, type Segmento } from '../simulador';

interface BarraScoreProps {
  segmentos: readonly Segmento[];
  // Texto lido pelo leitor de tela, ex.: "Score 1,92 de 2".
  descricao: string;
}

// Barra empilhada do score de uma proposta: cada criterio e um retangulo cuja posicao e largura vem do dado (atributos x/width no viewBox 0-1000, sem estilo inline);
// a cor da serie vem da classe manual-sim__seg--<criterio>. Nenhum texto dentro do SVG (ele estica na horizontal).
export default function BarraScore({ segmentos, descricao }: BarraScoreProps) {
  const idTitulo = `${useId().replace(/:/g, '')}-titulo`;
  return (
    <svg
      className="manual-sim__trilho"
      viewBox={`0 0 ${LARGURA_DA_BARRA} 18`}
      preserveAspectRatio="none"
      role="img"
      aria-label={descricao}
      aria-labelledby={idTitulo}
    >
      <title id={idTitulo}>{descricao}</title>
      {segmentos.map((s) => (
        <rect key={s.criterio} x={s.x} y={0} width={s.largura} height={18} className={`manual-sim__seg manual-sim__seg--${s.criterio}`} />
      ))}
      {segmentos.slice(1).map((s) => (
        <line key={`${s.criterio}-sep`} x1={s.x} x2={s.x} y1={0} y2={18} className="manual-sim__sep" vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
  );
}
