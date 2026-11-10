import { fireEvent, screen } from '@testing-library/react';

/**
 * Relatorio de compras enxuto (E1): demanda, embalagem, andamento, saldo, media, observacao e a decisao de compra ficam no
 * expansor "Detalhes" sob cada item (fechado por padrao). Abre todos os que estiverem fechados.
 */
export function expandirDetalhes(): void {
  for (const botao of screen.queryAllByRole('button', { name: /^Ver detalhes de / })) fireEvent.click(botao);
}

/** Espera os botoes "Detalhes" aparecerem (dados carregados) e abre todos. */
export async function abrirDetalhes(): Promise<void> {
  await screen.findAllByRole('button', { name: /^Ver detalhes de / });
  expandirDetalhes();
}

/** A linha do item e a linha de detalhes logo abaixo, copiadas para um so contêiner (so leitura: queries de texto). */
export function linhaCompleta(nome: string): HTMLElement {
  const linha = screen.getByText(nome).closest('tr') as HTMLElement;
  const caixa = document.createElement('div');
  caixa.append(linha.cloneNode(true));
  const detalhes = linha.nextElementSibling;
  if (detalhes?.classList.contains('fcr-detalhes')) caixa.append(detalhes.cloneNode(true));
  return caixa;
}

/** Abre o pop-up "Cotar" do item (E2) e devolve o <dialog>. */
export async function abrirCotar(nome: string): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole('button', { name: `Cotar ${nome}` }));
  const titulo = await screen.findByRole('heading', { name: `Cotar ${nome}` });
  return titulo.closest('dialog') as HTMLElement;
}
