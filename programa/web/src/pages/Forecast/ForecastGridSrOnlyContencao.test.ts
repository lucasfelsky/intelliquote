/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Regressao: as celulas da grade com quantidade decidida trazem `<span class="sr-only">` (position:absolute).
// `.fc-grid td` nao e containing block, entao sem `position: relative` no scroller (`.fc-scroll`) o span
// escapa dele e estica a PAGINA na horizontal (+828 px a 1440, +1.622 a 390; tambem no papel).
// jsdom nao faz layout: o teste trava o CSS que contem o span (globals.css e o unico CSS do app).

const css = readFileSync(resolve(import.meta.dirname, '../../styles/globals.css'), 'utf8').replace(/\r\n/g, '\n');
const semComentarios = css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Declaracoes de TODAS as regras cujo seletor e exatamente `seletor` (inclusive dentro de @media). */
function declaracoesDe(seletor: string): string[] {
  const achadas: string[] = [];
  const regra = /([^{}]+)\{([^{}]*)\}/g;
  for (const m of semComentarios.matchAll(regra)) {
    const seletores = (m[1] ?? '').split(',').map((s) => s.trim());
    if (seletores.includes(seletor)) achadas.push(m[2] ?? '');
  }
  return achadas;
}

/** Ultimo valor declarado para `propriedade` entre as regras (a ordem do arquivo decide). */
function valorFinal(seletor: string, propriedade: string): string | null {
  let valor: string | null = null;
  for (const bloco of declaracoesDe(seletor)) {
    for (const decl of bloco.split(';')) {
      const [prop, ...resto] = decl.split(':');
      if (prop?.trim() === propriedade) valor = resto.join(':').trim();
    }
  }
  return valor;
}

describe('grade do Forecast: contencao do span.sr-only', () => {
  it('.sr-only continua position:absolute (premissa do teste)', () => {
    expect(valorFinal('.sr-only', 'position')).toBe('absolute');
  });

  it('.fc-scroll e o containing block do .sr-only das celulas (position: relative)', () => {
    expect(declaracoesDe('.fc-scroll').length).toBeGreaterThan(0);
    expect(valorFinal('.fc-scroll', 'position')).toBe('relative');
  });

  it('.fc-scroll continua sendo o scroller da grade (overflow: auto)', () => {
    expect(valorFinal('.fc-scroll', 'overflow')).toBe('auto');
  });
});
