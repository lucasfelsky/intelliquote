import { useRef, useState, type DragEvent } from 'react';

// Arrastar e soltar um arquivo sobre um campo de anexo (ex.: o PDF da Ordem de Compra), sem passar pelo explorador. O campo
// continua funcionando por clique e pelo teclado: isto so acrescenta a queda. Cobre so arrasto de ARQUIVOS (texto, links e itens
// arrastados dentro da pagina passam direto).

/** O arrasto traz arquivos do sistema (e nao texto ou um item da propria pagina). */
function temArquivos(e: DragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes('Files');
}

/**
 * PDF de verdade: tipo `application/pdf` ou, quando o sistema nao informa o tipo (acontece no Windows sem leitor de PDF
 * associado), a extensao `.pdf`. O servidor valida de novo.
 */
export function ehArquivoPdf(file: Pick<File, 'type' | 'name'>): boolean {
  return file.type === 'application/pdf' || (file.type === '' && /\.pdf$/i.test(file.name));
}

export interface SoltarArquivo {
  /** `true` enquanto um arquivo esta sobre o campo (para o destaque visual). */
  arrastando: boolean;
  /** Espalhe no elemento que recebe a queda (o campo de anexo). */
  campo: {
    onDragEnter: (e: DragEvent) => void;
    onDragOver: (e: DragEvent) => void;
    onDragLeave: (e: DragEvent) => void;
    onDrop: (e: DragEvent) => void;
  };
  /**
   * Espalhe no recipiente do formulario: uma queda ERRADA (fora do campo) nao pode abrir o PDF no navegador e tirar a pessoa
   * do formulario. So barra o comportamento padrao para arquivos; nao anexa nada.
   */
  recipiente: {
    onDragOver: (e: DragEvent) => void;
    onDrop: (e: DragEvent) => void;
  };
}

/** `aoSoltar` recebe os arquivos soltos (quem usa decide o que fazer com mais de um). `desabilitado` ignora a queda. */
export function useSoltarArquivo(aoSoltar: (arquivos: File[]) => void, desabilitado = false): SoltarArquivo {
  const [arrastando, setArrastando] = useState(false);
  // dragenter/dragleave disparam tambem nos filhos: conta a profundidade para o destaque nao piscar.
  const profundidade = useRef(0);

  const encerrar = () => {
    profundidade.current = 0;
    setArrastando(false);
  };

  return {
    arrastando,
    campo: {
      onDragEnter: (e) => {
        if (desabilitado || !temArquivos(e)) return;
        e.preventDefault();
        profundidade.current += 1;
        setArrastando(true);
      },
      onDragOver: (e) => {
        if (desabilitado || !temArquivos(e)) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      },
      onDragLeave: (e) => {
        if (desabilitado || !temArquivos(e)) return;
        profundidade.current -= 1;
        if (profundidade.current <= 0) encerrar();
      },
      onDrop: (e) => {
        if (desabilitado || !temArquivos(e)) return;
        e.preventDefault();
        encerrar();
        aoSoltar(Array.from(e.dataTransfer?.files ?? []));
      },
    },
    recipiente: {
      onDragOver: (e) => {
        if (temArquivos(e)) e.preventDefault();
      },
      onDrop: (e) => {
        if (temArquivos(e)) e.preventDefault();
      },
    },
  };
}
