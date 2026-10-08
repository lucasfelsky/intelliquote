interface PaginationProps {
  page: number;
  totalPages: number;
  totalItems: number;
  itemLabel?: { singular: string; plural: string };
  onPrevious: () => void;
  onNext: () => void;
}

const DEFAULT_ITEM_LABEL = { singular: 'item', plural: 'itens' };

export function Pagination({
  page,
  totalPages,
  totalItems,
  itemLabel = DEFAULT_ITEM_LABEL,
  onPrevious,
  onNext,
}: PaginationProps) {
  const safeTotalPages = totalPages > 0 ? totalPages : 1;
  return (
    <nav className="pagination" aria-label="Paginação">
      <button
        type="button"
        className="ghost-button"
        onClick={onPrevious}
        disabled={page <= 1}
        aria-label="Página anterior"
      >
        Anterior
      </button>
      <span className="pagination__info">
        Página {page} de {safeTotalPages} · {totalItems} {totalItems === 1 ? itemLabel.singular : itemLabel.plural} no total
      </span>
      <button
        type="button"
        className="ghost-button"
        onClick={onNext}
        disabled={page >= safeTotalPages}
        aria-label="Próxima página"
      >
        Próxima
      </button>
    </nav>
  );
}
