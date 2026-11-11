import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react';
import { Icon } from '@/components/icons';

interface Props {
  ocultas: boolean;
  onAlternarOcultas: () => void;
  mostrarSemVenda: boolean;
  /** Produtos que o filtro de sem venda esconde (ou mostraria). */
  ocultaveis: number;
  onAlternarSemVenda: () => void;
}

/**
 * Botao "Filtros" do Painel (refino visual, etapa 5): reune as duas chaves da grade num balao que abre por clique.
 * O contador mostra quantas chaves estao ligadas. Diferente do InfoPopover, o balao tem conteudo interativo: fica no
 * lugar (sem portal) e fecha com Esc, clique fora ou quando o foco sai dele.
 */
export default function ForecastFiltrosMenu({ ocultas, onAlternarOcultas, mostrarSemVenda, ocultaveis, onAlternarSemVenda }: Props) {
  const idPainel = useId();
  const [aberto, setAberto] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);
  const botao = useRef<HTMLButtonElement>(null);
  const ativos = (ocultas ? 1 : 0) + (mostrarSemVenda ? 1 : 0);

  useEffect(() => {
    if (!aberto) return undefined;
    const aoApontar = (e: Event) => {
      if (raiz.current && e.target instanceof Node && !raiz.current.contains(e.target)) setAberto(false);
    };
    document.addEventListener('pointerdown', aoApontar);
    return () => document.removeEventListener('pointerdown', aoApontar);
  }, [aberto]);

  const aoPerderFoco = (e: FocusEvent<HTMLDivElement>) => {
    if (!e.relatedTarget || !raiz.current?.contains(e.relatedTarget as Node)) setAberto(false);
  };
  const aoTeclar = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape' && aberto) {
      e.stopPropagation();
      setAberto(false);
      botao.current?.focus();
    }
  };

  return (
    <div ref={raiz} className="fc-filtros-menu" onBlur={aoPerderFoco} onKeyDown={aoTeclar}>
      <button
        ref={botao}
        type="button"
        className="fc-filtros-menu__botao"
        aria-expanded={aberto}
        aria-controls={aberto ? idPainel : undefined}
        aria-label={ativos > 0 ? `Filtros avançados: ${ativos} ${ativos === 1 ? 'ligado' : 'ligados'}` : 'Filtros avançados'}
        data-testid="fc-filtros-botao"
        onClick={() => setAberto((a) => !a)}
      >
        <Icon name="filter" size={16} />
        <span className="fc-filtros-menu__txt">Filtros</span>
        {ativos > 0 && (
          <span className="fc-filtro__conta fc-filtros-menu__conta" aria-hidden="true">
            {ativos}
          </span>
        )}
      </button>
      {aberto && (
        <div id={idPainel} className="fc-filtros-menu__painel" role="group" aria-label="Filtros avançados">
          <button type="button" role="switch" aria-checked={mostrarSemVenda} className="fc-chave fcsv-chave" onClick={onAlternarSemVenda}>
            <span className={mostrarSemVenda ? 'fc-trilho fc-trilho--on' : 'fc-trilho'} aria-hidden="true">
              <span />
            </span>
            <span className="fc-filtros-menu__rotulo">
              <Icon name="clock" size={14} />
              Mostrar produtos sem venda há 6 meses ou mais
            </span>
            <span className="fc-filtro__conta">{ocultaveis}</span>
          </button>
          <button type="button" role="switch" aria-checked={ocultas} className="fc-chave" onClick={onAlternarOcultas}>
            <span className={ocultas ? 'fc-trilho fc-trilho--on' : 'fc-trilho'} aria-hidden="true">
              <span />
            </span>
            Colunas ocultas da planilha
          </button>
        </div>
      )}
    </div>
  );
}
