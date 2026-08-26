interface PaginationProps {
  page: number;
  totalPages: number;
  totalItems: number;
  onPrevious: () => void;
  onNext: () => void;
}

export function Pagination({ page, totalPages, totalItems, onPrevious, onNext }: PaginationProps) {
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
        Página {page} de {safeTotalPages} · {totalItems} {totalItems === 1 ? 'item' : 'itens'} no total
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
