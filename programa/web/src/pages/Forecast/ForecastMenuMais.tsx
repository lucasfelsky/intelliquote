import { forwardRef, useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Icon, type IconName } from '@/components/icons';

interface Props {
  /** Admin/comprador com uma quinzena escolhida: so eles veem "Excluir quinzena" (depois do divisor). */
  podeExcluir: boolean;
  onFontes: () => void;
  onEventos: () => void;
  onGrupos: () => void;
  onExcluir: () => void;
}

interface Item {
  id: string;
  rotulo: string;
  icone: IconName;
  perigo?: boolean;
  acao: () => void;
}

/**
 * Menu "Mais" do cabecalho do Forecast (board F1e/F1f do mock v68): as 3 consultas (Fontes e lead time, Eventos
 * estrangeiros, Grupos de equivalencia) e, so para quem edita, "Excluir quinzena" depois de um divisor.
 * Teclado: Enter, Espaco ou seta para baixo abrem e focam o 1o item; setas navegam; Home/End vao ao primeiro e ao
 * ultimo; Esc fecha e devolve o foco ao botao; Tab fecha. Item = botao `role="menuitem"` de 44 px (roving tabindex).
 */
const ForecastMenuMais = forwardRef<HTMLButtonElement, Props>(function ForecastMenuMais(
  { podeExcluir, onFontes, onEventos, onGrupos, onExcluir },
  refBotao,
) {
  const idMenu = useId();
  const [aberto, setAberto] = useState(false);
  // Qual item recebe o foco ao abrir: o 1o (padrao) ou o ultimo (seta para cima no botao).
  const [focoInicial, setFocoInicial] = useState<'primeiro' | 'ultimo'>('primeiro');
  const raiz = useRef<HTMLDivElement>(null);
  const botao = useRef<HTMLButtonElement | null>(null);
  const itens = useRef<Array<HTMLButtonElement | null>>([]);

  const definirBotao = useCallback(
    (el: HTMLButtonElement | null) => {
      botao.current = el;
      if (typeof refBotao === 'function') refBotao(el);
      else if (refBotao) refBotao.current = el;
    },
    [refBotao],
  );

  const lista: Item[] = [
    { id: 'fontes', rotulo: 'Fontes e lead time', icone: 'clock', acao: onFontes },
    { id: 'eventos', rotulo: 'Eventos estrangeiros', icone: 'globe', acao: onEventos },
    { id: 'grupos', rotulo: 'Grupos de equivalência', icone: 'layers', acao: onGrupos },
    ...(podeExcluir ? [{ id: 'excluir', rotulo: 'Excluir quinzena', icone: 'trash' as IconName, perigo: true, acao: onExcluir }] : []),
  ];

  const focar = (indice: number) => {
    const total = lista.length;
    itens.current[((indice % total) + total) % total]?.focus();
  };

  const fechar = useCallback((devolverFoco: boolean) => {
    setAberto(false);
    if (devolverFoco) botao.current?.focus();
  }, []);

  // Ao abrir, o foco vai para o 1o (ou ultimo) item.
  useEffect(() => {
    if (!aberto) return;
    const alvo = focoInicial === 'ultimo' ? itens.current.filter(Boolean).length - 1 : 0;
    itens.current[alvo]?.focus();
  }, [aberto, focoInicial]);

  // Clique fora fecha (o foco fica onde o usuario clicou).
  useEffect(() => {
    if (!aberto) return;
    const aoPressionar = (e: MouseEvent) => {
      if (raiz.current && !raiz.current.contains(e.target as Node)) setAberto(false);
    };
    document.addEventListener('mousedown', aoPressionar);
    return () => document.removeEventListener('mousedown', aoPressionar);
  }, [aberto]);

  const aoTeclarBotao = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setFocoInicial(e.key === 'ArrowUp' ? 'ultimo' : 'primeiro');
      setAberto(true);
    }
  };

  const aoTeclarMenu = (e: KeyboardEvent<HTMLDivElement>) => {
    const atual = itens.current.findIndex((el) => el === document.activeElement);
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        focar(atual + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        focar(atual - 1);
        break;
      case 'Home':
        e.preventDefault();
        focar(0);
        break;
      case 'End':
        e.preventDefault();
        focar(lista.length - 1);
        break;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        fechar(true);
        break;
      case 'Tab':
        // Nao impede o Tab: o foco segue para o proximo elemento da pagina e o menu fecha.
        setAberto(false);
        break;
      default:
    }
  };

  return (
    <div className="fc-mais" ref={raiz}>
      <button
        ref={definirBotao}
        type="button"
        className="ghost-button fc-mais__botao"
        aria-haspopup="menu"
        aria-expanded={aberto}
        aria-controls={aberto ? idMenu : undefined}
        onClick={() => {
          setFocoInicial('primeiro');
          setAberto((v) => !v);
        }}
        onKeyDown={aoTeclarBotao}
      >
        <Icon name="ellipsis" size={16} />
        Mais
        <Icon name="chevron-down" size={16} />
      </button>
      {aberto && (
        <div id={idMenu} className="fc-mais__menu" role="menu" aria-label="Mais ações do Forecast" onKeyDown={aoTeclarMenu}>
          {lista.map((item, i) => (
            <div key={item.id} role="none" className="fc-mais__linha">
              {item.id === 'excluir' && <div role="separator" className="fc-mais__divisor" />}
              <button
                ref={(el) => {
                  itens.current[i] = el;
                }}
                type="button"
                role="menuitem"
                tabIndex={i === 0 ? 0 : -1}
                className={item.perigo ? 'fc-mais__item fc-mais__item--perigo' : 'fc-mais__item'}
                onClick={() => {
                  setAberto(false);
                  item.acao();
                }}
              >
                <Icon name={item.icone} size={16} />
                {item.rotulo}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

export default ForecastMenuMais;
