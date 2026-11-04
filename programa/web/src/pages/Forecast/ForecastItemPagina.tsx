import { useEffect, useRef } from 'react';
import type { ForecastSnapshotDetail } from '@/services/forecast';
import ForecastMemoria from './ForecastMemoria';

interface Props {
  detail: ForecastSnapshotDetail;
  /** Numero da linha da planilha (`/forecast/item/:linha`). */
  linha: number;
  /** admin/comprador editam; os demais papeis COMEX veem em leitura (mesma regra do painel). */
  podeEditar: boolean;
}

// Pagina do item (D6; board F2): memoria de calculo + cartao lateral + cartao do ultimo preco, SEM a grade. Os dados vem do
// mesmo snapshot do painel (o pai busca; nenhum request novo alem do ultimo preco, sob demanda). A linha nao depende dos
// filtros do painel: um item oculto por "sem venda ha 6 meses" abre normalmente pelo link.
export default function ForecastItemPagina({ detail, linha, podeEditar }: Props) {
  const item = detail.linhas.find((l) => l.linha === linha);
  const encontrado = item !== undefined;
  // Ao entrar na pagina (vinda da grade, de um link ou do historico) o foco vai ao titulo do item (ou ao aviso de item inexistente):
  // o foco nao fica no link da grade que ja saiu da tela.
  const titulo = useRef<HTMLHeadingElement>(null);
  const aviso = useRef<HTMLDivElement>(null);
  useEffect(() => {
    (titulo.current ?? aviso.current)?.focus();
  }, [linha, encontrado]);
  if (!item) {
    return (
      <div ref={aviso} tabIndex={-1} className="empty-state fci-pagina__vazio">
        Item não encontrado nesta quinzena
      </div>
    );
  }
  return (
    <div className="fci-pagina">
      <ForecastMemoria
        key={item.linha}
        linha={item}
        half={detail.half}
        baseDate={detail.baseDate}
        hoje={detail.hoje}
        podeEditar={podeEditar}
        tituloRef={titulo}
      />
    </div>
  );
}
