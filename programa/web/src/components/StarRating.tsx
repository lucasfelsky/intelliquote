// F12 (backlog 2026-07-12): rating por estrelas (1..5). Editavel (captura no
// concluir cotacao) ou somente-leitura (media na lista de fornecedores).
// `value` 0 = sem nota. Acessivel: radiogroup + botoes com aria-label.
// F3d: estrelas em SVG (path do icone `star`), estilizadas so por classe (star-rating__*); o valor sai com virgula decimal (pt-BR).
import { ICONS } from './icons';

interface StarRatingProps {
  value: number;
  onChange?: (value: number) => void;
  label?: string;
  readOnly?: boolean;
  /** Mostra o valor numerico ao lado (ex.: media 4,2). */
  showValue?: boolean;
}

const STARS = [1, 2, 3, 4, 5];

const formatValue = (value: number) => value.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function Star({ filled }: { filled: boolean }) {
  return (
    <svg
      className={`star-rating__star ${filled ? 'star-rating__star--on' : 'star-rating__star--off'}`}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path d={ICONS.star} />
    </svg>
  );
}

export default function StarRating({
  value,
  onChange,
  label,
  readOnly = false,
  showValue = false,
}: StarRatingProps) {
  const rounded = Math.round(value);
  const ariaLabel = label
    ? `${label}: ${value || 'sem nota'}`
    : readOnly
      ? value > 0
        ? `Avaliação média ${formatValue(value)} de 5`
        : 'Avaliação média: sem nota'
      : undefined;

  return (
    <span
      className="star-rating"
      role={readOnly ? 'img' : 'radiogroup'}
      aria-label={ariaLabel}
    >
      {STARS.map((star) => {
        const filled = readOnly ? star <= rounded : star <= value;

        if (readOnly) {
          return <Star key={star} filled={filled} />;
        }

        return (
          <button
            key={star}
            type="button"
            role="radio"
            aria-checked={value === star}
            aria-label={`${star} de 5`}
            className="star-rating__button"
            onClick={() => onChange?.(value === star ? 0 : star)}
          >
            <Star filled={filled} />
          </button>
        );
      })}
      {showValue && value > 0 ? <span className="star-rating__value">{formatValue(value)}</span> : null}
    </span>
  );
}
