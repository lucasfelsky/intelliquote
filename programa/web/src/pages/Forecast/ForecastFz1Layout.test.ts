/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseRules, regioes, type CssRule } from '../../test/rfCss';

// FZ1 (pos-release do Forecast): layout que o jsdom nao mede e que so o harness protegia. Cada regra abaixo e travada aqui; o mutante (apagar a regra) derruba o teste.
//  1) grade a 390/360: colunas fixas N + Item cabem no scroller e sobra largura para os dados;
//  2) modal Embalagens: rodape (Cancelar/Salvar) fixo no fundo do scroller do modal, sem scroller novo;
//  3) alvos de toque em coarse: o rotulo (e nao a marca de 24 px do radio/checkbox) e o alvo e tem >= 44 nas duas dimensoes.

const css = readFileSync(resolve(import.meta.dirname, '../../styles/globals.css'), 'utf8').replace(/\r\n/g, '\n');
const regiao = regioes(css).find((r) => r.nome === 'tela F13');
const fonte = (arquivo: string) => readFileSync(resolve(import.meta.dirname, arquivo), 'utf8');

interface Achada {
  contexto: string[];
  seletor: string;
  decl: Record<string, string>;
}

function seletoresDe(prelude: string): string[] {
  const out: string[] = [];
  let prof = 0;
  let atual = '';
  for (const ch of prelude) {
    if (ch === '(' || ch === '[') prof++;
    else if (ch === ')' || ch === ']') prof--;
    if (ch === ',' && prof === 0) {
      out.push(atual.replace(/\s+/g, ' ').trim());
      atual = '';
    } else atual += ch;
  }
  if (atual.trim()) out.push(atual.replace(/\s+/g, ' ').trim());
  return out;
}

function achatar(regras: CssRule[], contexto: string[] = []): Achada[] {
  return regras.flatMap((r) => {
    if (/^@media\b/.test(r.prelude)) return achatar(parseRules(r.body), [...contexto, r.prelude.replace(/\s+/g, ' ')]);
    const decl: Record<string, string> = {};
    for (const d of r.body.split(';')) {
      const i = d.indexOf(':');
      if (i > 0) decl[d.slice(0, i).trim()] = d.slice(i + 1).trim();
    }
    return seletoresDe(r.prelude).map((seletor) => ({ contexto, seletor, decl }));
  });
}

const todas = achatar(regiao?.regras ?? []);
const SCREEN_480 = ['@media screen and (max-width: 480px)'];
const COARSE = ['@media screen', '@media (pointer: coarse)'];
const mesmo = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Declaracoes combinadas (a ordem decide) das regras com esse seletor exato e esse contexto de @media. */
function declaracoes(seletor: string, contexto: string[]): Record<string, string> {
  return Object.assign({}, ...todas.filter((a) => a.seletor === seletor && mesmo(a.contexto, contexto)).map((a) => a.decl));
}
const px = (v: string | undefined): number => {
  const m = /^(-?\d+(?:\.\d+)?)px$/.exec(v ?? '');
  if (!m) throw new Error(`esperava px, veio ${String(v)}`);
  return Number(m[1]);
};

describe('FZ1.1: grade do Forecast a 390 e 360 (colunas fixas N + Item)', () => {
  const N = declaracoes('.fc-pagina .fc-grid .fc-fixa--n', SCREEN_480);
  const ITEM = declaracoes('.fc-pagina .fc-grid .fc-fixa--item', SCREEN_480);

  it('ate 480 px o N e o Item tem largura FIXA (width = min-width = max-width) e as duas somam no maximo 200 (sobram >= 126 px de dados a 360)', () => {
    for (const d of [N, ITEM]) {
      expect(d['width'], JSON.stringify(d)).toBeDefined();
      expect(d['min-width']).toBe(d['width']);
      expect(d['max-width']).toBe(d['width']);
    }
    const soma = px(N['width']) + px(ITEM['width']);
    expect(soma).toBeLessThanOrEqual(200);
    // scroller de 326 px a 360 (viewport - 34 de margens): o que sobra para os dados
    expect(360 - 34 - soma).toBeGreaterThanOrEqual(120);
  });

  it('o sticky do Item comeca onde o N termina (left do Item = largura do N) e o padding do N cabe na largura', () => {
    expect(px(ITEM['left'])).toBe(px(N['width']));
    expect(N['padding']).toBe('0 6px');
  });

  it('os <col> inline (44/240 + dados) somem ate 480 px: sem isso o `col` do Item (240) e o conteudo (324) mantem a coluna larga', () => {
    expect(declaracoes('.fc-pagina .fc-grid col', SCREEN_480)['display']).toBe('none');
    // so existe dentro do @media de 480: acima disso o desenho de sempre
    expect(todas.filter((a) => /\.fc-grid col\b/.test(a.seletor) && !mesmo(a.contexto, SCREEN_480))).toEqual([]);
    const grade = fonte('./ForecastGrid.tsx');
    expect(grade).toContain('<col style={{ width: 44 }} />');
    expect(grade).toContain('<col style={{ width: 240 }} />');
  });

  it('o item (link de 48) e a fonte/status quebram linha em vez de cortar; a linha cresce so quando precisa (height auto + min-height 48)', () => {
    // `a.fc-item` (e nao `.fc-item`): a guarda F13-H da telaF13 exige UMA so regra `.fc-pagina .fc-item` no par C (a do text-decoration)
    const link = declaracoes('.fc-pagina a.fc-item', SCREEN_480);
    expect(link['height']).toBe('auto');
    expect(link['min-height']).toBe('48px');
    expect(link['padding']).toBe('4px 8px 4px 12px');
    expect(declaracoes('.fc-pagina .fc-item__fonte', SCREEN_480)['white-space']).toBe('normal');
    expect(declaracoes('.fc-pagina .fc-item__nome', SCREEN_480)['line-height']).toBe('1.25');
    expect(declaracoes('.fc-pagina .fc-item__fonte', SCREEN_480)['line-height']).toBe('1.25');
  });

  it('o cabecalho do Item acompanha o padding menor e a grade acima de 480 px nao muda (legado: N 44 + sticky do Item em 44, que o par C nao redefine fora do @media de 480)', () => {
    expect(declaracoes('.fc-pagina .fc-grid thead th.fc-fixa--item', SCREEN_480)['padding']).toBe('0 8px');
    const fixaForaDe480 = todas.filter((a) => /\.fc-fixa--(n|item)$/.test(a.seletor) && !mesmo(a.contexto, SCREEN_480) && ('left' in a.decl || 'width' in a.decl || 'max-width' in a.decl || 'min-width' in a.decl));
    expect(fixaForaDe480).toEqual([]);
    const legado = css.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(legado).toMatch(/\.fc-grid \.fc-fixa--n \{[^}]*\bleft: 0;[^}]*\bwidth: 44px;/);
    expect(legado).toMatch(/\.fc-grid \.fc-fixa--item \{[^}]*\bleft: 44px;/);
  });
});

describe('FZ1.2: modal Embalagens com o rodape fixo (notebook 1536x730 e menores)', () => {
  const RODAPE = '.fc-portal .fce-modal .modal-actions:last-child';

  it('Cancelar/Salvar ficam sticky no fundo do scroller do modal (so em tela), colados em bottom: 0', () => {
    const d = declaracoes(RODAPE, ['@media screen']);
    expect(d['position']).toBe('sticky');
    expect(d['bottom']).toBe('0');
  });

  it('o scroll-padding-bottom do .modal-content cobre a altura do rodape (padding 16 + botao 44 + 16 + 1 de borda) para o foco nunca ficar sob ele', () => {
    const faixa = declaracoes(RODAPE, ['@media screen']);
    const padV = px(faixa['padding']?.split(' ')[0]);
    const altura = padV * 2 + 44 + 1;
    const sp = declaracoes('.fc-portal .modal-content:has(.fce-modal)', ['@media screen']);
    expect(px(sp['scroll-padding-bottom'])).toBeGreaterThanOrEqual(altura);
  });

  it('nao cria scroller novo: nenhuma regra do Forecast poe overflow/max-height no corpo do Embalagens (o unico scroller segue sendo o .modal-content)', () => {
    const corpo = todas.filter((a) => /\.fce-(modal|form|cabecalho)\b/.test(a.seletor) && !/\.fce-scroll/.test(a.seletor));
    for (const a of corpo) {
      expect(Object.keys(a.decl).filter((p) => /^(overflow|overflow-y|max-height|height)$/.test(p)), `${a.contexto.join(' ')} ${a.seletor}`).toEqual([]);
    }
  });

  it('o markup existe: `.fce-modal` envolve as 3 variantes e a ultima `.modal-actions` e filha dele (senao o seletor do rodape nao casa)', () => {
    const src = fonte('./ForecastEmbalagensModal.tsx');
    expect(src).toContain('<div className="fce-modal">');
    expect(src.match(/className="modal-actions"/g)?.length).toBeGreaterThanOrEqual(2);
  });
});

describe('FZ1.3: alvos de toque em coarse (o rotulo e o alvo; a marca do radio/checkbox fica em 24 px)', () => {
  it('as linhas de marcar dos modais de apoio tem min-height 44 em coarse', () => {
    for (const s of ['.fc-pagina .fci-quinzena .checkbox-field', '.fc-pagina .fci-entendi', '.fc-pagina .fit-alternancia', '.fc-pagina .fco-form .checkbox-field', '.fc-pagina .fcg-form .fcd-produto', '.fc-pagina .fcg-selecionados .fcd-produto']) {
      expect(declaracoes(s, COARSE)['min-height'], s).toBe('44px');
    }
  });

  it('o rotulo "1a/2a" da quinzena e as legendas SALDO/FUP dos slots tem min-width 44 (mediam 42,4 / 43,1 / 24,5)', () => {
    expect(declaracoes('.fc-pagina .fci-quinzena .checkbox-field', COARSE)['min-width']).toBe('44px');
    const slot = declaracoes('.fc-pagina .fci-slot__topo .field-label', COARSE);
    expect(slot['min-width']).toBe('44px');
    expect(slot['min-height']).toBe('44px');
  });

  it('a marca nao cresce (o visual do controle e o mesmo): radio/checkbox seguem em 24 px', () => {
    expect(declaracoes('.fc-pagina .fci-quinzena input[type="radio"]', COARSE)['width']).toBe('24px');
    expect(declaracoes('.fc-pagina .fcg-form .fcd-produto input', COARSE)['height']).toBe('24px');
  });
});
