import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { SupplierNotes, notesPreview, NOTES_PREVIEW_CHARS } from './SupplierNotes';

describe('SupplierNotes', () => {
  it.each([null, '', '   '])('nao renderiza nada para %j', (value) => {
    const { container } = render(<SupplierNotes notes={value} />);
    expect(container.firstChild).toBeNull();
  });

  it('mostra o texto com o rotulo "Observações:"', () => {
    const { getByTestId, getByText } = render(<SupplierNotes notes="SM6104" />);
    expect(getByText('SM6104')).toBeTruthy();
    expect(getByTestId('supplier-notes').textContent).toContain('Observações:');
  });

  it('preserva quebras de linha (pre-wrap)', () => {
    const { getByTestId } = render(<SupplierNotes notes={'linha 1\nlinha 2'} />);
    const span = getByTestId('supplier-notes').querySelector('span') as HTMLElement;
    expect(span.textContent).toBe('linha 1\nlinha 2');
    expect(span.style.whiteSpace).toBe('pre-wrap');
  });

  it('HTML aparece literal, sem criar elementos', () => {
    const { getByText, container } = render(<SupplierNotes notes="<b>x</b>" />);
    expect(getByText('<b>x</b>')).toBeTruthy();
    expect(container.querySelector('b')).toBeNull();
  });

  it('texto longo: prévia com reticências e alternancia ver mais / ver menos', () => {
    const long = 'a'.repeat(300);
    const { getByRole, getByTestId } = render(<SupplierNotes notes={long} />);
    const span = getByTestId('supplier-notes').querySelector('span') as HTMLElement;
    expect(span.textContent?.endsWith('…')).toBe(true);
    expect(span.textContent).not.toBe(long);

    const more = getByRole('button', { name: 'ver mais' });
    expect(more.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(more);

    expect(span.textContent).toBe(long);
    const less = getByRole('button', { name: 'ver menos' });
    expect(less.getAttribute('aria-expanded')).toBe('true');
    expect(less.getAttribute('aria-controls')).toBe(span.id);
  });

  it('3 linhas curtas truncam na 2a', () => {
    const { getByTestId, getByRole } = render(<SupplierNotes notes={'um\ndois\ntres'} />);
    const span = getByTestId('supplier-notes').querySelector('span') as HTMLElement;
    expect(span.textContent).toBe('um\ndois…');
    expect(getByRole('button', { name: 'ver mais' })).toBeTruthy();
  });

  it('collapsible={false} mostra tudo e sem botao', () => {
    const long = 'b'.repeat(300);
    const { getByTestId, queryByRole } = render(<SupplierNotes notes={long} collapsible={false} />);
    expect(getByTestId('supplier-notes').querySelector('span')?.textContent).toBe(long);
    expect(queryByRole('button')).toBeNull();
  });

  it('label={null} nao tem rotulo', () => {
    const { getByTestId } = render(<SupplierNotes notes="SM6104" label={null} />);
    expect(getByTestId('supplier-notes').querySelector('strong')).toBeNull();
    expect(getByTestId('supplier-notes').textContent).toBe('SM6104');
  });
});

describe('notesPreview', () => {
  it('texto curto nao e truncado', () => {
    expect(notesPreview('SM6104')).toEqual({ preview: 'SM6104', truncated: false });
  });

  it('espaco ou quebra no fim (dado legado) nao conta como truncado', () => {
    expect(notesPreview('SM6104\n')).toEqual({ preview: 'SM6104', truncated: false });
    expect(notesPreview('SM6104  ')).toEqual({ preview: 'SM6104', truncated: false });
  });

  it('corta em NOTES_PREVIEW_CHARS e marca truncated', () => {
    const result = notesPreview('c'.repeat(NOTES_PREVIEW_CHARS + 10));
    expect(result.truncated).toBe(true);
    expect(result.preview).toBe(`${'c'.repeat(NOTES_PREVIEW_CHARS)}…`);
  });
});
