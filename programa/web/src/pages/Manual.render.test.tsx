import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Manual from './Manual';

// Desempenho da busca (revisao M1-M3): digitar nao pode refazer o corpo dos 17 capitulos. O capitulo Itens e trocado por um que conta
// quantas vezes a funcao dele roda; Capitulo/Destacar (que leem o termo por contexto) continuam reais.
const contagem = vi.hoisted(() => ({ itens: 0 }));

vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, name: 'Maria', email: 'maria@exemplo.invalid', role: 'admin' } }),
}));

vi.mock('./Manual/capitulos/Itens', async () => {
  const Capitulo = (await import('./Manual/componentes/Capitulo')).default;
  return {
    default: function ItensContado() {
      contagem.itens += 1;
      return <Capitulo lead="Catálogo de exemplo para a busca." />;
    },
  };
});

class ObservadorFalso {
  constructor(readonly chamada: unknown) {}
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

const esperar = (ms: number) =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });

beforeEach(() => {
  contagem.itens = 0;
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('IntersectionObserver', ObservadorFalso);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Manual: a busca nao refaz os capitulos', () => {
  it('cada tecla muda so o campo: o corpo dos capitulos roda 1 vez na abertura e nenhuma depois (nem quando o termo vale)', async () => {
    render(
      <MemoryRouter initialEntries={['/manual']}>
        <Manual />
      </MemoryRouter>,
    );
    expect(contagem.itens).toBe(1);
    const campo = screen.getByRole('searchbox', { name: 'Buscar no manual' });
    for (const texto of ['c', 'ca', 'cat', 'catálogo']) fireEvent.change(campo, { target: { value: texto } });
    // antes do atraso de 180 ms o termo nem chegou na pagina
    expect(contagem.itens).toBe(1);
    expect((campo as HTMLInputElement).value).toBe('catálogo');
    await esperar(260);
    // o termo valeu (o capitulo continua visivel): filtro e destaque rodaram, mas o corpo do capitulo nao foi refeito
    expect(document.querySelector('.manual-busca__status')?.textContent).toMatch(/capítulos? encontrados?/);
    expect(contagem.itens).toBe(1);
    fireEvent.change(campo, { target: { value: '' } });
    await esperar(260);
    expect(contagem.itens).toBe(1);
  });

  it('trocar o capitulo ativo (indice) tambem nao refaz o corpo dos capitulos', () => {
    render(
      <MemoryRouter initialEntries={['/manual']}>
        <Manual />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('link', { name: /Enviar aos fornecedores/ }));
    fireEvent.click(screen.getByRole('link', { name: /Comparação e vencedora/ }));
    expect(contagem.itens).toBe(1);
  });
});
