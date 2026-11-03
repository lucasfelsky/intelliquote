import type { ReactNode } from 'react';
import { Icon, type IconName } from '@/components/icons';

export type TipoDeAviso = 'dica' | 'atencao' | 'info';

// Nao usa a classe `.alert` (a guarda do componentesF3b conta os .alert com icone filho por arquivo): o aviso do Manual e a propria caixa `manual-aviso`.
const TIPOS: Record<TipoDeAviso, { classe: string; icone: IconName; rotulo: string }> = {
  dica: { classe: 'manual-aviso manual-aviso--dica', icone: 'check', rotulo: 'Dica' },
  atencao: { classe: 'manual-aviso manual-aviso--atencao', icone: 'alert-triangle', rotulo: 'Atenção' },
  info: { classe: 'manual-aviso manual-aviso--info', icone: 'info', rotulo: 'Informação' },
};

export default function Aviso({ tipo, children }: { tipo: TipoDeAviso; children: ReactNode }) {
  const { classe, icone, rotulo } = TIPOS[tipo];
  return (
    <div className={classe} role="note" aria-label={rotulo}>
      <span className="manual-aviso__icone">
        <Icon name={icone} size={14} strokeWidth={2.2} />
      </span>
      <div>{children}</div>
    </div>
  );
}
