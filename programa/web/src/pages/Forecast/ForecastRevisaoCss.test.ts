import { describe, expect, it } from 'vitest';
import { readSource } from '../../test/rfCss';

// jsdom nao avalia @media print nem posicionamento: estes guardas leem o CSS (achados da revisao do refino visual).
const css = readSource('../styles/globals.css');

describe('Forecast refino visual: guardas de CSS da revisao', () => {
  it('papel do Relatorio: o cabecalho de acoes some, mas a lista de avisos (.fc-avisos, neta de .page-header__actions) continua', () => {
    const regra = css.split('\n').find((l) => l.includes('body:has(.fcr-resumo) :is(.sidebar') && l.includes('display: none !important'));
    expect(regra).toBeTruthy();
    const lista = (regra as string).slice((regra as string).indexOf(':is(') + 4, (regra as string).indexOf(') {'));
    const seletores = lista.split(/,\s*(?![^(]*\))/).map((s) => s.trim());
    // Mesma hierarquia do JSX de Forecast.tsx: .page-header__actions > (.fc-cabecalho__quinzena | .fc-cabecalho__acoes > (.fc-avisos > ul.fc-avisos__papel | botoes)).
    document.body.innerHTML =
      '<div class="page-header__actions fc-cabecalho"><div class="fc-cabecalho__quinzena"><select></select></div>' +
      '<div class="fc-cabecalho__acoes"><div class="fc-avisos"><button class="fc-avisos__botao"></button>' +
      '<ul class="fc-avisos__papel"><li id="aviso">x</li></ul></div><button id="importar"></button></div></div>';
    const oculto = (el: Element) => seletores.some((s) => el.matches(s));
    const aviso = document.getElementById('aviso') as Element;
    for (let el: Element | null = aviso; el && el !== document.body; el = el.parentElement) {
      expect(oculto(el), el.className || el.tagName).toBe(false);
    }
    expect(oculto(document.getElementById('importar') as Element)).toBe(true);
    expect(oculto(document.querySelector('.fc-cabecalho__quinzena') as Element)).toBe(true);
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

  it('papel: o expansor Detalhes sai aberto (hidden vence por !important) e o botao some', () => {
    expect(css).toContain('.fcr-detalhes[hidden] { display: table-row !important; }');
    expect(css).toContain('.fcr-detalhes__alternar { display: none; }');
  });

  it('expansor Detalhes: contem os absolutos do leitor de tela (pagina nao estica no celular), mantem a divisoria das sublinhas e arruma o papel', () => {
    expect(css).toContain('.fcr-detalhes > td { position: relative; }');
    expect(css).toContain('tr:has(+ .fcr-detalhes + .fcr-linha-grupo)');
    expect(css).toContain('tr:has(+ .fcr-detalhes + .fcoc-linha)');
    expect(css).toContain('.fcr-limite__prazos { display: flex; flex-direction: column; }');
  });

  it('o motivo do Cotar (icone) nao estica ate a largura da celula', () => {
    expect(css).toContain('.fgc-motivo-chip { align-self: flex-start; }');
  });

  it('papel: tabelas e nota das secoes recolhidas (hidden) saem abertas', () => {
    expect(css).toContain('.fcr-sem-consumo__nota[hidden] { display: block !important; }');
    expect(css).toContain('.fcr-tabela tbody[hidden] { display: table-row-group !important; }');
  });
});
