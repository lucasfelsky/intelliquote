import type { ReactNode } from 'react';
import { Icon } from '@/components/icons';

// Linha de selos de status ligados por setas; o texto solto entre eles e <Rotulo>.
export function FluxoStatus({ children }: { children: ReactNode }) {
  return <div className="manual-fluxo">{children}</div>;
}

export function Seta() {
  return (
    <span className="manual-fluxo__seta">
      <Icon name="arrow-right" size={14} strokeWidth={2.2} />
    </span>
  );
}

export function Rotulo({ children }: { children: ReactNode }) {
  return <span className="manual-fluxo__rotulo">{children}</span>;
}
