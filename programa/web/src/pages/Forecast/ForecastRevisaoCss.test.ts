import { describe, expect, it } from 'vitest';
import { readSource } from '../../test/rfCss';

// jsdom nao avalia @media print nem posicionamento: estes guardas leem o CSS (achados da revisao do refino visual).
const css = readSource('../styles/globals.css');

describe('Forecast refino visual: guardas de CSS da revisao', () => {
  it('papel do Relatorio: o cabecalho de acoes some, mas a lista de avisos (.fc-avisos) continua', () => {
    expect(css).toContain('.page-header__actions > :not(.fc-avisos)');
    expect(css).not.toMatch(/body:has\(\.fcr-resumo\) :is\([^)]*\.page-header__actions,/);
  });

  it('papel da grade: o texto do selo de sem venda vence o display:none de .fc-grid .sr-only', () => {
    expect(css).toMatch(/\.fc-grid \.fcsv-selo \.sr-only \{ display: inline !important;/);
  });

  it('celular: baloes de Avisos e de Filtros tem ancestral posicionado (senao caem no fim da pagina)', () => {
    expect(css).toMatch(/@media \(max-width: 640px\) \{[^@]*\.fc-pagina > \.page-header \{ position: relative; \}/);
    expect(css).toMatch(/@media \(max-width: 640px\) \{\s*\.fc-pagina \.fc-barra \{ position: relative; \}/);
  });

  it('balao largo nao tem rolagem interna (o balao nao recebe foco) e o cartao nao corta o balao de Filtros', () => {
    expect(css).toMatch(/\.info-popover--largo \{ width: 460px; max-width: calc\(100vw - 16px\); \}/);
    expect(css).toContain('.fc-card:has(.fc-filtros-menu__painel) { overflow: visible; }');
  });
});
