// Marca IntelliQuote "Rota e chegada" (mock v68, direcao A, produto iq): lupa-rota com o ponto de chegada.
// Geometria identica ao board Marca (viewBox 48). As cores vem do CSS (.brand-mark*), nunca de atributos.
// `tone="dark"` = sobre o navy da sidebar; `tone="light"` = tile navy (favicon, login futuro).
interface BrandMarkProps {
  tone?: 'dark' | 'light';
  size?: number;
  /** Decorativa (padrao): o nome "IntelliQuote" vem ao lado. `false` expoe role="img" com nome acessivel. */
  decorative?: boolean;
  className?: string;
}

export default function BrandMark({ tone = 'dark', size = 40, decorative = true, className }: BrandMarkProps) {
  const classes = ['brand-mark', `brand-mark--${tone}`, className].filter(Boolean).join(' ');
  const a11y = decorative
    ? ({ 'aria-hidden': true, focusable: 'false' } as const)
    : ({ role: 'img', 'aria-label': 'IntelliQuote' } as const);
  return (
    <svg className={classes} viewBox="0 0 48 48" width={size} height={size} {...a11y}>
      <rect className="brand-mark__tile" width="48" height="48" rx="13" />
      <circle className="brand-mark__glyph" cx="22.5" cy="22.5" r="10" fill="none" strokeWidth="4.5" />
      <path className="brand-mark__glyph" d="M29.8 29.8 L31.2 31.2" strokeWidth="4.5" strokeLinecap="round" />
      <circle className="brand-mark__dot" cx="35.4" cy="35.4" r="3.1" />
    </svg>
  );
}
