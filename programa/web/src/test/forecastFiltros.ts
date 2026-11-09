import { fireEvent, screen } from '@testing-library/react';

/**
 * As chaves do Painel ("Colunas ocultas da planilha", "Mostrar produtos sem venda...") moram no balao do botao
 * "Filtros" (refino visual, etapa 5). Devolve a chave pedida, abrindo o balao se ele estiver fechado.
 */
export function chaveDoFiltro(nome: string | RegExp): HTMLElement {
  if (!screen.queryByRole('switch', { name: nome })) {
    fireEvent.click(screen.getByTestId('fc-filtros-botao'));
  }
  return screen.getByRole('switch', { name: nome });
}
