import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Modal } from '@/components/Modal';
import type { ForecastItemRelatorio } from '@/services/forecast';
import ForecastDecisaoCompra, { usePodeEditarDecisao } from './ForecastDecisaoCompra';
import ForecastGerarCotacao, { usePodeCriarCotacao } from './ForecastGerarCotacao';
import { kgBr } from './forecastPainel';

// Acao "Cotar" da linha do relatorio de compras (E2 do relatorio enxuto): abre um pop-up com a quantidade a cotar e a
// observacao (o editor de decisao de antes, sem o status) e o botao "Gerar cotacao". Quem so le nao ve a acao.

function PopupCotar({ item, onFechar }: { item: ForecastItemRelatorio; onFechar: () => void }) {
  return (
    <Modal
      isOpen
      onClose={onFechar}
      title={`Cotar ${item.item}`}
      subtitle={item.codigos.join(' · ')}
      size="wide"
      className="fc-portal"
    >
      <div className="fcq-corpo">
        <p className="fcq-sugerida">
          Qtd. final calculada: <strong>{kgBr(item.quantidadeFinal)} kg</strong> (a que “Usar sugerida” preenche)
        </p>
        <div className="fdec-celula fcq-decisao">
          <div className="fdec-conteudo">
            <ForecastDecisaoCompra item={item} />
            <ForecastGerarCotacao item={item} comTexto />
          </div>
        </div>
      </div>
    </Modal>
  );
}

export default function ForecastCotar({ item }: { item: ForecastItemRelatorio }) {
  const podeEditar = usePodeEditarDecisao();
  const podeCriar = usePodeCriarCotacao();
  const [aberto, setAberto] = useState(false);
  const botao = useRef<HTMLButtonElement>(null);
  const abriuAntes = useRef(false);
  // O pop-up e desmontado ao fechar (o foco cairia no BODY): devolve o foco ao botao que o abriu.
  useEffect(() => {
    if (aberto) {
      abriuAntes.current = true;
    } else if (abriuAntes.current) {
      abriuAntes.current = false;
      botao.current?.focus();
    }
  }, [aberto]);
  if (!podeEditar && !podeCriar) return null;
  return (
    <>
      <button
        ref={botao}
        type="button"
        className="ghost-button ghost-button--sm fcq-botao"
        aria-label={`Cotar ${item.item}`}
        aria-haspopup="dialog"
        onClick={() => setAberto(true)}
      >
        Cotar
      </button>
      {/* Fora da tabela (portal): o CSS .fcr-tabela td/th nao pode vazar para o pop-up. */}
      {aberto && createPortal(<PopupCotar item={item} onFechar={() => setAberto(false)} />, document.body)}
    </>
  );
}
