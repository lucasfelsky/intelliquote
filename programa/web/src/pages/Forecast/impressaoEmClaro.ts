// Impressao em tema claro: o app guarda o tema em <html data-theme>; no escuro, o papel sairia com fundo
// escuro e texto claro. Antes de imprimir grava 'light' e, depois, restaura o valor anterior.
// Nao chama applyTheme: nao mexe em meta theme-color, localStorage nem preferencia do usuario.
// Cobre o botao "Imprimir" e o Ctrl+P (os dois disparam beforeprint/afterprint).
export function forcarClaroNaImpressao(win: Window = window): () => void {
  const html = win.document.documentElement;
  let guardado: string | null | undefined;

  const antes = () => {
    if (guardado !== undefined) return;
    const atual = html.getAttribute('data-theme');
    if (atual === 'light') return;
    guardado = atual;
    html.setAttribute('data-theme', 'light');
  };

  const restaurar = () => {
    if (guardado === undefined) return;
    if (html.getAttribute('data-theme') === 'light') {
      if (guardado === null) html.removeAttribute('data-theme');
      else html.setAttribute('data-theme', guardado);
    }
    guardado = undefined;
  };

  win.addEventListener('beforeprint', antes);
  win.addEventListener('afterprint', restaurar);

  return () => {
    win.removeEventListener('beforeprint', antes);
    win.removeEventListener('afterprint', restaurar);
    restaurar();
  };
}
