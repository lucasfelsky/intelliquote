import { useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

interface RegiaoRolavelProps {
  className: string;
  // Nome acessivel da regiao quando ela rola ("Tabela: ..., role na horizontal").
  nome: string;
  children: ReactNode;
}

// Regiao do Manual que PODE rolar na horizontal. So quando o conteudo de fato excede a caixa (scrollWidth > clientWidth)
// ela vira regiao focavel (tabIndex 0 + role region + nome); sem rolagem nao ha parada de Tab a toa nem marco a mais para o leitor de tela.
// A rolagem depende da largura, entao a medida acompanha o redimensionamento da caixa e do conteudo (ResizeObserver) e o carregamento das fontes.
export default function RegiaoRolavel({ className, nome, children }: RegiaoRolavelProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [rola, setRola] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    let ativo = true;
    const medir = () => {
      if (ativo) setRola(el.scrollWidth > el.clientWidth + 1);
    };
    medir();
    const observador = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(medir) : null;
    observador?.observe(el);
    for (const filho of Array.from(el.children)) observador?.observe(filho);
    window.addEventListener('resize', medir);
    void document.fonts?.ready.then(medir);
    return () => {
      ativo = false;
      observador?.disconnect();
      window.removeEventListener('resize', medir);
    };
  }, []);

  return (
    <div ref={ref} className={className} {...(rola ? { tabIndex: 0, role: 'region', 'aria-label': nome } : {})}>
      {children}
    </div>
  );
}
