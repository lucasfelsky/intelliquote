// F12 (backlog 2026-07-12): rating por estrelas (1..5). Editavel (captura no
// concluir cotacao) ou somente-leitura (media na lista de fornecedores).
// `value` 0 = sem nota. Acessivel: radiogroup + botoes com aria-label.

interface StarRatingProps {
  value: number;
  onChange?: (value: number) => void;
  label?: string;
  readOnly?: boolean;
  /** Mostra o valor numerico ao lado (ex.: media 4.2). */
  showValue?: boolean;
}

const STARS = [1, 2, 3, 4, 5];

export default function StarRating({
  value,
  onChange,
  label,
  readOnly = false,
  showValue = false,
}: StarRatingProps) {
  const rounded = Math.round(value);

  return (
    <span
      className="star-rating"
      role={readOnly ? 'img' : 'radiogroup'}
      aria-label={label ? `${label}: ${value || 'sem nota'}` : undefined}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}
    >
      {STARS.map((star) => {
        const filled = readOnly ? star <= rounded : star <= value;
        const starChar = filled ? '★' : '☆';

        if (readOnly) {
          return (
            <span key={star} aria-hidden="true" style={{ color: filled ? '#f5a623' : '#c9c9c9' }}>
              {starChar}
            </span>
          );
        }

        return (
          <button
            key={star}
            type="button"
            role="radio"
            aria-checked={value === star}
            aria-label={`${star} de 5`}
            onClick={() => onChange?.(value === star ? 0 : star)}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
              fontSize: '1.15rem',
              lineHeight: 1,
              color: filled ? '#f5a623' : '#c9c9c9',
            }}
          >
            {starChar}
          </button>
        );
      })}
      {showValue && value > 0 ? (
        <span style={{ marginLeft: 4, fontSize: 13, color: 'var(--muted, #666)' }}>
          {value.toFixed(1)}
        </span>
      ) : null}
    </span>
  );
}
