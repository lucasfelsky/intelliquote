import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ehArquivoPdf, useSoltarArquivo } from './useSoltarArquivo';

// Dados 100% sinteticos.

function Campo({ aoSoltar, desabilitado = false }: { aoSoltar: (f: File[]) => void; desabilitado?: boolean }) {
  const soltar = useSoltarArquivo(aoSoltar, desabilitado);
  return (
    <div data-testid="recipiente" {...soltar.recipiente}>
      <label data-testid="campo" data-arrastando={String(soltar.arrastando)} {...soltar.campo}>
        <span data-testid="filho">anexo</span>
      </label>
      <p data-testid="fora">fora do campo</p>
    </div>
  );
}

const pdf = (nome = 'po.pdf') => new File(['%PDF-1.4'], nome, { type: 'application/pdf' });
const arquivos = (files: File[]) => ({ dataTransfer: { files, types: ['Files'] } });
const texto = { dataTransfer: { files: [], types: ['text/plain'] } };

describe('ehArquivoPdf', () => {
  it.each([
    [{ type: 'application/pdf', name: 'a.pdf' }, true],
    [{ type: '', name: 'PO-0001.PDF' }, true],
    [{ type: '', name: 'a.txt' }, false],
    [{ type: 'text/plain', name: 'a.pdf' }, false],
    [{ type: 'application/octet-stream', name: 'a.pdf' }, false],
    [{ type: 'image/png', name: 'a.png' }, false],
  ])('%j -> %s', (f, esperado) => {
    expect(ehArquivoPdf(f)).toBe(esperado);
  });
});

describe('useSoltarArquivo', () => {
  it('arquivo sobre o campo liga o destaque e sair desliga (filhos nao fazem piscar)', () => {
    render(<Campo aoSoltar={vi.fn()} />);
    const campo = screen.getByTestId('campo');
    const filho = screen.getByTestId('filho');
    fireEvent.dragEnter(campo, arquivos([pdf()]));
    expect(campo.dataset.arrastando).toBe('true');
    // entra no filho e sai do campo: o dragleave do campo vem depois do dragenter do filho
    fireEvent.dragEnter(filho, arquivos([pdf()]));
    fireEvent.dragLeave(campo, arquivos([pdf()]));
    expect(campo.dataset.arrastando).toBe('true');
    fireEvent.dragLeave(filho, arquivos([pdf()]));
    expect(campo.dataset.arrastando).toBe('false');
  });

  it('soltar entrega os arquivos, desliga o destaque e barra o comportamento padrao do navegador', () => {
    const aoSoltar = vi.fn();
    render(<Campo aoSoltar={aoSoltar} />);
    const campo = screen.getByTestId('campo');
    fireEvent.dragEnter(campo, arquivos([pdf()]));
    const naoCancelado = fireEvent.drop(campo, arquivos([pdf('um.pdf'), pdf('dois.pdf')]));
    expect(naoCancelado).toBe(false); // preventDefault chamado
    expect(aoSoltar).toHaveBeenCalledTimes(1);
    expect((aoSoltar.mock.calls[0]![0] as File[]).map((f) => f.name)).toEqual(['um.pdf', 'dois.pdf']);
    expect(campo.dataset.arrastando).toBe('false');
  });

  it('dragover com arquivo permite a queda (preventDefault); sem arquivo (texto) deixa o navegador em paz', () => {
    render(<Campo aoSoltar={vi.fn()} />);
    const campo = screen.getByTestId('campo');
    expect(fireEvent.dragOver(campo, arquivos([pdf()]))).toBe(false);
    expect(fireEvent.dragOver(campo, texto)).toBe(true);
  });

  it('arrasto de texto ou de item da pagina nao liga o destaque nem chama aoSoltar', () => {
    const aoSoltar = vi.fn();
    render(<Campo aoSoltar={aoSoltar} />);
    const campo = screen.getByTestId('campo');
    fireEvent.dragEnter(campo, texto);
    expect(campo.dataset.arrastando).toBe('false');
    expect(fireEvent.drop(campo, texto)).toBe(true);
    expect(aoSoltar).not.toHaveBeenCalled();
  });

  it('desabilitado (ex.: enviando): ignora o arrasto e a queda', () => {
    const aoSoltar = vi.fn();
    render(<Campo aoSoltar={aoSoltar} desabilitado />);
    const campo = screen.getByTestId('campo');
    fireEvent.dragEnter(campo, arquivos([pdf()]));
    expect(campo.dataset.arrastando).toBe('false');
    fireEvent.drop(campo, arquivos([pdf()]));
    expect(aoSoltar).not.toHaveBeenCalled();
  });

  it('queda de arquivo fora do campo (no recipiente) nao abre o PDF no navegador e nao anexa nada', () => {
    const aoSoltar = vi.fn();
    render(<Campo aoSoltar={aoSoltar} />);
    const fora = screen.getByTestId('fora');
    expect(fireEvent.dragOver(fora, arquivos([pdf()]))).toBe(false);
    expect(fireEvent.drop(fora, arquivos([pdf()]))).toBe(false);
    expect(aoSoltar).not.toHaveBeenCalled();
    // texto solto fora do campo segue o comportamento normal
    expect(fireEvent.drop(fora, texto)).toBe(true);
  });
});
