import { useEffect } from 'react';

// `document.title` da tela enquanto ela estiver montada; ao trocar o titulo (grade -> pagina do item e de volta) ou desmontar, volta ao anterior.
export function useTituloDaPagina(titulo: string) {
  useEffect(() => {
    const anterior = document.title;
    document.title = titulo;
    return () => {
      document.title = anterior;
    };
  }, [titulo]);
}
