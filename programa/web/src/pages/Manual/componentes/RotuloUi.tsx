import type { ReactNode } from 'react';
import { Icon, type IconName } from '@/components/icons';

interface RotuloUiProps {
  // Botao primario da interface (fundo da cor de acao da marca).
  primario?: boolean;
  // Icone do botao real (ex.: `plus` em "Novo item"): o rotulo do texto nunca leva "+ " (D-1011-04).
  icone?: IconName;
  children: ReactNode;
}

// Pilula que reproduz o rotulo de um botao ou campo da interface dentro do texto do manual.
export default function RotuloUi({ primario = false, icone, children }: RotuloUiProps) {
  return (
    <span className={primario ? 'manual-ui manual-ui--primario' : 'manual-ui'}>
      {icone ? <Icon name={icone} size={12} strokeWidth={2.2} /> : null}
      {children}
    </span>
  );
}
