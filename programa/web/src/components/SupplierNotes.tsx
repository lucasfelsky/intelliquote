import { useId, useState } from 'react';

export const NOTES_PREVIEW_CHARS = 140;
export const NOTES_PREVIEW_LINES = 2;

/** Prévia: 2 primeiras linhas, até 140 caracteres. Truncada termina em "…". */
export function notesPreview(text: string): { preview: string; truncated: boolean } {
  const byLines = text.split(/\r?\n/).slice(0, NOTES_PREVIEW_LINES).join('\n');
  const cut = byLines.length > NOTES_PREVIEW_CHARS ? byLines.slice(0, NOTES_PREVIEW_CHARS) : byLines;
  const trimmed = cut.trimEnd();
  const truncated = trimmed !== text.trimEnd();
  return { preview: truncated ? `${trimmed}…` : trimmed, truncated };
}

/**
 * Observações livres da resposta do fornecedor (portal ou form manual).
 * Texto sempre via JSX (escapado); nunca HTML.
 */
export function SupplierNotes({
  notes,
  label = 'Observações',
  collapsible = true,
  testId = 'supplier-notes',
}: {
  notes: string | null | undefined;
  label?: string | null;
  collapsible?: boolean;
  testId?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  if (!notes?.trim()) return null;

  const { preview, truncated } = notesPreview(notes);
  const canCollapse = collapsible && truncated;
  const text = canCollapse && !expanded ? preview : notes;

  return (
    <div data-testid={testId} style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 4 }}>
      {label && <strong>{label}: </strong>}
      <span id={id} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
        {text}
      </span>
      {canCollapse && (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => setExpanded((value) => !value)}
          style={{
            color: 'var(--primary-700)',
            background: 'none',
            border: 'none',
            padding: 0,
            marginLeft: 4,
            cursor: 'pointer',
            textDecoration: 'underline',
            font: 'inherit',
          }}
        >
          {expanded ? 'ver menos' : 'ver mais'}
        </button>
      )}
    </div>
  );
}
