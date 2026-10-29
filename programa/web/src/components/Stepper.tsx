import { Fragment } from 'react';
import { Icon } from './icons';

interface StepperProps {
  // Nome acessivel da regiao (ex.: "Etapas da nova cotacao").
  ariaLabel: string;
  // Rotulos dos passos, em ordem.
  steps: readonly string[];
  // Indice (base 0) do passo atual; os anteriores aparecem como feitos e os seguintes como pendentes.
  current: number;
}

// Indicador de passos (mock v68: CotacaoNova / CotacaoNovaItens). Puramente visual: nao navega; as ligacoes entre os passos sao aria-hidden.
export function Stepper({ ariaLabel, steps, current }: StepperProps) {
  return (
    <section className="stepper" aria-label={ariaLabel}>
      <ol className="stepper__lista">
        {steps.map((label, index) => {
          const estado = index < current ? 'feito' : index === current ? 'atual' : 'pendente';
          return (
            <Fragment key={label}>
              {index > 0 && (
                <li
                  className={index <= current ? 'stepper__ligacao stepper__ligacao--feita' : 'stepper__ligacao'}
                  aria-hidden="true"
                />
              )}
              <li className={`stepper__passo stepper__passo--${estado}`} aria-current={estado === 'atual' ? 'step' : undefined}>
                <span className="stepper__marca">
                  {estado === 'feito' ? <Icon name="check" size={14} strokeWidth={2.6} /> : index + 1}
                </span>
                {label}
                {estado === 'feito' && <span className="sr-only"> concluído</span>}
              </li>
            </Fragment>
          );
        })}
      </ol>
    </section>
  );
}
