// Assinatura "sq química" (canvas v72, board SQLogo, variante minusc, tom dark): simbolo + palavras em Sora.
// Geometria e fatores identicos ao board: gap simbolo/texto 0,18 x size, gap entre palavras 0,12 x size, fonte 0,4 x size
// (todos com Math.round). As cores vem do CSS (.sq-logo*), nunca de atributos; o estilo inline leva so gap e tamanho de fonte.
// Reaproveitavel (a F4 usa no login com size 36); so o tom dark existe por enquanto (o claro entra com o login).
interface SqLogoProps {
  /** Lado do simbolo em px (a fonte e o espacamento derivam dele). */
  size?: number;
  /** Nome acessivel da assinatura (role="img" na raiz; o svg interno e decorativo). */
  label?: string;
  className?: string;
}

export default function SqLogo({ size = 32, label = 'SQ Química', className }: SqLogoProps) {
  const px = (k: number) => `${Math.round(size * k)}px`;
  const classes = ['sq-logo', 'sq-logo--minusc', 'sq-logo--dark', className].filter(Boolean).join(' ');
  return (
    <span className={classes} role="img" aria-label={label} style={{ gap: px(0.18) }}>
      <svg
        className="sq-logo__symbol"
        viewBox="0 0 100 100"
        width={size}
        height={size}
        aria-hidden="true"
        focusable="false"
      >
        <path className="sq-logo__ring" d="M64 19.5 A38 38 0 1 1 36 19.5" fill="none" strokeWidth={8} strokeLinecap="round" />
        <path className="sq-logo__green" d="M44 30.5 L56 23.5 L56 44 L44 44 Z" />
        <circle className="sq-logo__green" cx={50} cy={58.5} r={19.5} />
      </svg>
      <span className="sq-logo__words" style={{ gap: px(0.12), fontSize: px(0.4) }}>
        <span className="sq-logo__sq">sq</span>
        <span className="sq-logo__chem">química</span>
      </span>
    </span>
  );
}
