/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import {
  classesDoSeletor,
  foraDasRegioes,
  opaque as opaqueOf,
  parseRules,
  ratioOf,
  readSource,
  regioes,
  temasDeTokens,
  tokensDosTemas,
  ultimoComposto,
  type CssRule,
  type Rgb,
  type ThemeName,
} from './rfCss';

// F3c (Suite COMEX, mock v68: Sobreposicoes, Confirmacoes, Movimento, Componentes "Feedback"): modal, confirmacao e aviso de nova versao.
// A regiao `componentes F3c` do globals.css + 2 componentes (Modal: icone do fechar e subtitulo; useConfirm: classe da mensagem).
// Esta guarda afirma as receitas do mock, os invariantes da PROPRIA regiao (classes permitidas, at-rules, reduced-motion, sem cor literal)
// e que nenhum seletor migrado ficou fora dela. Botoes e campos sao da F3a; selos/alertas/tabelas da F3b; abas/paginacao/cartao da F3d.

const css = readSource('../styles/globals.css').replace(/\r\n/g, '\n');
const regs = regioes(css);
const regiao = regs.find((r) => r.nome === 'componentes F3c');
const regras: CssRule[] = regiao?.regras ?? [];
const limpo = regiao?.limpo ?? '';

// Classes que a regiao F3c pode citar em QUALQUER seletor (inclui contexto: .primary-button no rodape do modal, da F3a).
const PERMITIDAS_F3C = new Set([
  'modal-dialog',
  'modal-dialog--wide',
  'modal-dialog--xl',
  'modal-content',
  'modal-header',
  'modal-header__titles',
  'modal-subtitle',
  'btn-close',
  'modal-body',
  'modal-actions',
  'modal-confirm__message',
  'toast-container',
  'toast',
  'new-version-toast',
  'new-version-toast__text',
  'new-version-toast__actions',
  'new-version-toast__later',
  'new-version-toast__reload',
  'primary-button',
]);

// Classes cujas regras tem de morar so na regiao (seletor fora dela so passa com classe de tela/Forecast). `primary-button` e da F3a;
// `.toast--success/--danger/--warning` (0 usos no TSX) sairam do CSS na TROCA-2 e nao entram aqui.
const MIGRADAS_F3C = new Set([...PERMITIDAS_F3C].filter((c) => c !== 'primary-button'));

const REDUZIDO = '@media (prefers-reduced-motion: reduce)';

// ---------- leitura das regras da regiao ----------
// Separa a lista de seletores por virgula FORA de parenteses (:is(.a, .b) e um seletor so).
function listaDeSeletores(prelude: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let atual = '';
  for (const ch of prelude) {
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) {
      out.push(atual.replace(/\s+/g, ' ').trim());
      atual = '';
    } else {
      atual += ch;
    }
  }
  if (atual.trim()) out.push(atual.replace(/\s+/g, ' ').trim());
  return out;
}

function declaracoes(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const parte of body.split(';')) {
    const i = parte.indexOf(':');
    if (i < 0) continue;
    const nome = parte.slice(0, i).trim();
    if (nome) out[nome] = parte.slice(i + 1).replace(/\s+/g, ' ').trim();
  }
  return out;
}

interface Achatada {
  seletor: string;
  decls: Record<string, string>;
  media: string | null;
}

function achatar(rules: CssRule[], media: string | null = null): Achatada[] {
  const out: Achatada[] = [];
  for (const r of rules) {
    if (r.prelude.startsWith('@media')) out.push(...achatar(parseRules(r.body), r.prelude));
    else if (!r.prelude.startsWith('@')) {
      for (const seletor of listaDeSeletores(r.prelude)) out.push({ seletor, decls: declaracoes(r.body), media });
    }
  }
  return out;
}

const achatadas = achatar(regras);

// Declaracoes do seletor EXATO fora da media (ultima regra vence, como na cascata de mesma especificidade).
function de(seletor: string): Record<string, string> {
  const hit = achatadas.filter((a) => a.seletor === seletor && a.media === null);
  if (hit.length === 0) throw new Error(`seletor ausente na regiao F3c: ${seletor}`);
  return Object.assign({}, ...hit.map((h) => h.decls)) as Record<string, string>;
}

// Declaracoes do seletor no bloco de movimento reduzido.
function reduzido(seletor: string): Record<string, string> {
  const hit = achatadas.filter((a) => a.seletor === seletor && a.media === REDUZIDO);
  if (hit.length === 0) throw new Error(`seletor ausente no reduced-motion da F3c: ${seletor}`);
  return Object.assign({}, ...hit.map((h) => h.decls)) as Record<string, string>;
}

const keyframes = regras.filter((r) => r.prelude.startsWith('@keyframes')).map((r) => ({ nome: r.prelude.replace('@keyframes', '').trim(), corpo: r.body.replace(/\s+/g, ' ').trim() }));
const keyframe = (nome: string) => keyframes.find((k) => k.nome === nome)?.corpo;

// ---------- tokens e contraste (pares novos da etapa, nos 2 temas) ----------
const { claro, escuro } = tokensDosTemas(css);
const TEMAS = temasDeTokens(claro, escuro);
const opaque = (tema: ThemeName, nome: string): Rgb => opaqueOf(TEMAS[tema], nome);
const TEXT = 4.5;

const PAIRS_F3C: ReadonlyArray<readonly [fg: string, bg: string, min: number]> = [
  // aviso de nova versao: texto e acao secundaria sobre o fundo do toast
  ['--rf-toast-ink', '--rf-toast-bg', TEXT],
  ['--rf-toast-ink-soft', '--rf-toast-bg', TEXT],
  // modal: subtitulo sobre a superficie; fechar (ink) sobre o fundo de hover
  ['--rf-ink-soft', '--rf-surface', TEXT],
  ['--rf-ink', '--rf-bg', TEXT],
];

describe('F3c: tokens novos e contraste', () => {
  it('--rf-toast-bg: par (navy no claro, #163845 no escuro); --rf-toast-ink e --rf-toast-ink-soft: constantes so no :root', () => {
    expect(claro['--rf-toast-bg']).toBe('#0b2430');
    expect(escuro['--rf-toast-bg']).toBe('#163845');
    expect(claro['--rf-toast-ink']).toBe('#e8f4f6');
    expect(claro['--rf-toast-ink-soft']).toBe('#b8ccd3');
    expect(escuro['--rf-toast-ink']).toBeUndefined();
    expect(escuro['--rf-toast-ink-soft']).toBeUndefined();
  });

  it('pares novos >= 4,5 nos 2 temas', () => {
    const baixos: string[] = [];
    for (const tema of ['claro', 'escuro'] as const) {
      for (const [fg, bg, min] of PAIRS_F3C) {
        const ratio = ratioOf(opaque(tema, fg), opaque(tema, bg));
        if (ratio < min) baixos.push(`${tema}: ${fg} / ${bg} = ${ratio.toFixed(2)}`);
      }
    }
    expect(baixos).toEqual([]);
  });

  it('o primario do toast usa o par ja medido --rf-on-primary / --rf-primary (e hover)', () => {
    for (const tema of ['claro', 'escuro'] as const) {
      expect(ratioOf(opaque(tema, '--rf-on-primary'), opaque(tema, '--rf-primary'))).toBeGreaterThanOrEqual(TEXT);
      expect(ratioOf(opaque(tema, '--rf-on-primary'), opaque(tema, '--rf-primary-hover'))).toBeGreaterThanOrEqual(TEXT);
    }
  });
});

// ---------- invariantes da regiao ----------
describe('F3c: regiao `componentes F3c`', () => {
  it('existe, tem regras e nao declara --rf-*', () => {
    expect(regiao).toBeDefined();
    expect(regras.length).toBeGreaterThan(25);
    expect(limpo).not.toMatch(/(^|[;{\s])--rf-[\w-]+\s*:/);
    expect(limpo).toContain('var(--rf-');
  });

  it('toda classe citada em qualquer seletor pertence a PERMITIDAS_F3C', () => {
    const fora = achatadas.flatMap((a) => classesDoSeletor(a.seletor)).filter((c) => !PERMITIDAS_F3C.has(c));
    expect([...new Set(fora)]).toEqual([]);
  });

  it('at-rules: so reduced-motion e os 3 @keyframes rf-* da etapa; sem print, sem media de largura', () => {
    const atRules = regras.filter((r) => r.prelude.startsWith('@')).map((r) => r.prelude);
    expect(atRules.filter((a) => a.startsWith('@media'))).toEqual([REDUZIDO]);
    expect(keyframes.map((k) => k.nome).sort()).toEqual(['rf-dialog-rise', 'rf-scrim-fade', 'rf-toast-in']);
    expect(atRules.filter((a) => !a.startsWith('@media') && !a.startsWith('@keyframes'))).toEqual([]);
    expect(limpo).not.toContain('@media print');
    expect(limpo).not.toContain('@media (max-width');
  });

  it('sem cor literal e sem opacity fora dos keyframes (so tokens); height fixo so no .btn-close', () => {
    expect(limpo).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
    const semKeyframes = regras.filter((r) => !r.prelude.startsWith('@keyframes'));
    expect(semKeyframes.map((r) => r.body).join(';')).not.toMatch(/(^|[;{\s])opacity\s*:/);
    const comHeight = achatadas.filter((a) => 'height' in a.decls).map((a) => a.seletor);
    expect(comHeight).toEqual(['.btn-close']);
  });

  it('toda animation/transform tem contrapartida no reduced-motion (invariante 6)', () => {
    const animados = achatadas.filter((a) => a.media === null && 'animation' in a.decls).map((a) => a.seletor);
    expect(animados.sort()).toEqual(['.toast', 'dialog.modal-dialog::backdrop', 'dialog.modal-dialog[open]']);
    for (const seletor of animados) {
      const r = reduzido(seletor);
      expect(r['animation'] ?? r['animation-duration'], seletor).toBeDefined();
    }
    // nenhum transform nem :active { transform } fora dos keyframes; nenhuma transition com transform
    const semKeyframes = regras.filter((r) => !r.prelude.startsWith('@keyframes')).map((r) => r.body).join(';');
    expect(semKeyframes).not.toMatch(/(^|[;{\s])transform\s*:/);
    expect(limpo).not.toMatch(/transition\s*:[^;]*transform/);
    // o bloco reduzido nao desloca nada
    const bloco = regras.find((r) => r.prelude === REDUZIDO)?.body ?? '';
    expect(bloco).not.toContain('transform');
    expect(bloco).not.toContain('rf-dialog-rise');
    expect(bloco).not.toContain('rf-toast-in');
  });

  it('nenhum seletor migrado ficou FORA das regioes (ultimo composto + demais classes todas migradas)', () => {
    const fora = foraDasRegioes(css, regs).replace(/\/\*[\s\S]*?\*\//g, '');
    const infratores: string[] = [];
    const varrer = (rules: CssRule[]) => {
      for (const r of rules) {
        if (r.prelude.startsWith('@media') || r.prelude.startsWith('@supports')) {
          varrer(parseRules(r.body));
        } else if (!r.prelude.startsWith('@')) {
          for (const seletor of listaDeSeletores(r.prelude)) {
            const ultimas = classesDoSeletor(ultimoComposto(seletor));
            const todas = classesDoSeletor(seletor);
            if (todas.length > 0 && todas.every((c) => MIGRADAS_F3C.has(c)) && ultimas.some((c) => MIGRADAS_F3C.has(c))) infratores.push(seletor);
          }
        }
      }
    };
    varrer(parseRules(fora));
    expect(infratores).toEqual([]);
  });

  it('PLAN 10.5: as regras mortas .row-actions .ghost-button e .link-button e o par .row-actions > button/a do grupo misto foram apagadas de fora das regioes', () => {
    const foraLimpo = foraDasRegioes(css, regs).replace(/\/\*[\s\S]*?\*\//g, '');
    const seletoresFora = achatar(parseRules(foraLimpo)).map((a) => a.seletor);
    for (const s of ['.row-actions .ghost-button', '.link-button', '.row-actions > button', '.row-actions > a']) expect(seletoresFora, s).not.toContain(s);
    expect(seletoresFora).toContain('.page-header__actions > button');
    expect(seletoresFora).toContain('.page-header__actions > a');
  });

  it('o grupo de white-space de fora perdeu o .modal-actions > button (agora na regiao) e o overlay deixou de ter fallback literal', () => {
    const foraLimpo = foraDasRegioes(css, regs).replace(/\/\*[\s\S]*?\*\//g, '');
    const seletoresFora = achatar(parseRules(foraLimpo)).map((a) => a.seletor);
    expect(seletoresFora).not.toContain('.modal-actions > button');
    expect(seletoresFora.filter((s) => s.includes('::backdrop'))).toEqual([]);
    expect(limpo).not.toContain('var(--overlay');
  });
});

// ---------- modal ----------
describe('F3c: modal', () => {
  it('larguras 560 / 880 / min(1200px, 95vw) (D-F3-13); <dialog> sem borda nem fundo, overflow visible', () => {
    expect(de('dialog.modal-dialog')).toMatchObject({
      border: '0',
      padding: '0',
      background: 'transparent',
      width: '100%',
      'max-width': '560px',
      'max-height': '90vh',
      overflow: 'visible',
    });
    expect(de('dialog.modal-dialog--wide')).toEqual({ 'max-width': '880px' });
    expect(de('dialog.modal-dialog--xl')).toEqual({ 'max-width': 'min(1200px, 95vw)' });
  });

  it('::backdrop usa --rf-overlay (sem o fallback literal antigo)', () => {
    expect(de('dialog.modal-dialog::backdrop').background).toBe('var(--rf-overlay)');
  });

  it('.modal-content: --rf-surface, raio painel (22), sombra do modal, sem padding, 90vh com rolagem vertical', () => {
    expect(de('.modal-content')).toEqual({
      background: 'var(--rf-surface)',
      'border-radius': 'var(--rf-radius-panel)',
      'box-shadow': 'var(--rf-shadow-modal)',
      padding: '0',
      'max-height': '90vh',
      'overflow-y': 'auto',
    });
  });

  it('cabecalho 22 24 14, alinhado ao topo; titulo Sora 20/700 -0,01em; subtitulo 13 em --rf-ink-soft', () => {
    expect(de('.modal-header')).toMatchObject({
      display: 'flex',
      'align-items': 'flex-start',
      'justify-content': 'space-between',
      gap: '16px',
      padding: '22px 24px 14px',
    });
    expect(de('.modal-header h2')).toMatchObject({
      margin: '0',
      'font-family': 'var(--rf-font-display)',
      'font-size': '20px',
      'font-weight': '700',
      'letter-spacing': '-0.01em',
      color: 'var(--rf-ink)',
    });
    expect(de('.modal-header__titles')).toMatchObject({ display: 'flex', 'flex-direction': 'column', gap: '4px', 'min-width': '0' });
    expect(de('.modal-subtitle')).toMatchObject({ margin: '0', 'font-size': '13px', color: 'var(--rf-ink-soft)' });
  });

  it('sem subtitulo o titulo (filho direto do cabecalho) desce 8 px; com subtitulo (dentro de __titles) nao', () => {
    expect(de('.modal-header > h2')).toEqual({ 'padding-top': '8px' });
    expect(limpo.indexOf('.modal-header > h2')).toBeGreaterThan(limpo.indexOf('.modal-header h2 {'));
  });

  it('.btn-close: 44x44, raio 12, fundo --rf-surface-alt, cor --rf-ink, hover --rf-bg, foco duplo com outline transparente', () => {
    expect(de('.btn-close')).toMatchObject({
      width: '44px',
      height: '44px',
      padding: '0',
      border: '0',
      'border-radius': 'var(--rf-radius-button)',
      background: 'var(--rf-surface-alt)',
      color: 'var(--rf-ink)',
    });
    expect(de('.btn-close:hover')).toEqual({ background: 'var(--rf-bg)' });
    expect(de('.btn-close:focus-visible')).toEqual({
      outline: '2px solid transparent',
      'outline-offset': '2px',
      'box-shadow': '0 0 0 3px var(--rf-surface), 0 0 0 5px var(--rf-action)',
    });
  });

  it('corpo 6 24 20 em --rf-ink; .modal-actions: flex no fim, gap 8, margem de cima 20', () => {
    expect(de('.modal-body')).toEqual({ padding: '6px 24px 20px', color: 'var(--rf-ink)' });
    expect(de('.modal-actions')).toEqual({ display: 'flex', gap: '8px', 'justify-content': 'flex-end', 'margin-top': '20px' });
  });

  it('faixa do rodape (D-F3-11): SO em :is(.modal-body, .modal-body > form) > .modal-actions:last-child', () => {
    const SELETOR = ':is(.modal-body, .modal-body > form) > .modal-actions:last-child';
    expect(de(SELETOR)).toEqual({
      margin: '20px -24px -20px',
      padding: '16px 24px',
      'border-top': '1px solid var(--rf-divider)',
      background: 'var(--rf-surface-alt)',
    });
    // nenhum outro seletor da regiao desenha a faixa (borda de cima ou fundo na .modal-actions)
    const outros = achatadas.filter((a) => a.seletor !== SELETOR && /(^| )\.modal-actions( |$|:|>)/.test(a.seletor) && ('border-top' in a.decls || 'background' in a.decls));
    expect(outros.map((o) => o.seletor)).toEqual([]);
  });

  it('.modal-actions > button nao quebra o rotulo; o primario do rodape tem 0 18 (boards de modal)', () => {
    expect(de('.modal-actions > button')).toEqual({ 'white-space': 'nowrap' });
    expect(de('.modal-actions .primary-button')).toEqual({ padding: '0 18px' });
  });

  it('confirmacao: mensagem 14/1,6 em --rf-ink; titulo e mensagem mais proximos (10 + 4) so com .modal-confirm__message', () => {
    expect(de('.modal-confirm__message')).toEqual({ margin: '0', 'font-size': '14px', 'line-height': '1.6', color: 'var(--rf-ink)' });
    expect(de('.modal-content:has(.modal-confirm__message) .modal-header')).toEqual({ 'padding-bottom': '10px' });
    expect(de('.modal-content:has(.modal-confirm__message) .modal-body')).toEqual({ 'padding-top': '4px' });
  });
});

// ---------- movimento ----------
describe('F3c: movimento do modal e do toast', () => {
  it('dialogo sobe 12 px com opacidade (--rf-dur-slow, --rf-ease-out); sem fill-mode final (backwards)', () => {
    expect(de('dialog.modal-dialog[open]').animation).toBe('rf-dialog-rise var(--rf-dur-slow) var(--rf-ease-out) backwards');
    expect(keyframe('rf-dialog-rise')).toBe('from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; }');
  });

  it('fundo aparece em 200 ms linear (rf-scrim-fade)', () => {
    expect(de('dialog.modal-dialog::backdrop').animation).toBe('rf-scrim-fade var(--rf-dur-base) linear');
    expect(keyframe('rf-scrim-fade')).toBe('from { opacity: 0; } to { opacity: 1; }');
    expect(claro['--rf-dur-base']).toBe('200ms');
  });

  it('toast entra com mola: sobe 16 px + scale(.98), --rf-dur-slow, --rf-ease-spring', () => {
    expect(de('.toast').animation).toBe('rf-toast-in var(--rf-dur-slow) var(--rf-ease-spring) backwards');
    expect(keyframe('rf-toast-in')).toBe('from { opacity: 0; transform: translateY(16px) scale(0.98); } to { opacity: 1; transform: none; }');
    expect(claro['--rf-dur-slow']).toBe('300ms');
    expect(claro['--rf-ease-spring']).toBe('cubic-bezier(0.34, 1.56, 0.64, 1)');
  });

  it('reduced-motion: dialogo e toast viram fade de 150 ms sem deslocamento; o fundo mantem o fade (150 ms)', () => {
    expect(reduzido('dialog.modal-dialog[open]').animation).toBe('rf-scrim-fade 150ms linear backwards');
    expect(reduzido('.toast').animation).toBe('rf-scrim-fade 150ms linear backwards');
    expect(reduzido('dialog.modal-dialog::backdrop')['animation-duration']).toBe('150ms');
    expect(reduzido('.btn-close').transition).toBe('background-color var(--rf-dur-base), color var(--rf-dur-base)');
  });
});

// ---------- toast ----------
describe('F3c: aviso de nova versao (toast)', () => {
  it('.toast-container: canto inferior direito (20/20), coluna com gap 8, acima de tudo', () => {
    expect(de('.toast-container')).toEqual({
      position: 'fixed',
      right: '20px',
      bottom: '20px',
      display: 'flex',
      'flex-direction': 'column',
      gap: '8px',
      'z-index': '10000',
    });
  });

  it('.toast: --rf-toast-bg / --rf-toast-ink, raio 14, 14 16, sombra do modal, largura 360', () => {
    expect(de('.toast')).toMatchObject({
      width: '360px',
      'max-width': 'calc(100vw - 40px)',
      padding: '14px 16px',
      'border-radius': 'var(--rf-radius-alert)',
      background: 'var(--rf-toast-bg)',
      color: 'var(--rf-toast-ink)',
      'box-shadow': 'var(--rf-shadow-modal)',
      'font-size': '14px',
    });
    expect(claro['--rf-radius-alert']).toBe('14px');
  });

  it('.new-version-toast: coluna com gap 10; texto 14/600/1,45; acoes a direita com gap 8', () => {
    expect(de('.new-version-toast')).toEqual({ 'flex-direction': 'column', 'align-items': 'stretch', gap: '10px' });
    expect(de('.new-version-toast__text')).toEqual({ 'font-weight': '600', 'line-height': '1.45' });
    expect(de('.new-version-toast__actions')).toEqual({ display: 'flex', 'justify-content': 'flex-end', gap: '8px' });
  });

  it('botoes do toast: 36 de altura minima, raio 10, 700 13 px', () => {
    expect(de('.new-version-toast__actions button')).toMatchObject({
      'min-height': '36px',
      border: '0',
      'border-radius': 'var(--rf-radius-control)',
      'font-family': 'var(--rf-font-sans)',
      'font-size': '13px',
      'font-weight': '700',
    });
    expect(claro['--rf-radius-control']).toBe('10px');
  });

  it('"Depois": 0 12, transparente, --rf-toast-ink-soft; "Recarregar": 0 14, --rf-primary com --rf-on-primary', () => {
    expect(de('.new-version-toast__later')).toEqual({ padding: '0 12px', background: 'transparent', color: 'var(--rf-toast-ink-soft)' });
    expect(de('.new-version-toast__reload')).toEqual({ padding: '0 14px', background: 'var(--rf-primary)', color: 'var(--rf-on-primary)' });
    expect(de('.new-version-toast__reload:hover')).toEqual({ background: 'var(--rf-primary-hover)' });
    expect(de('.new-version-toast__later:hover').color).toBe('var(--rf-toast-ink)');
  });

  it('foco duplo com o --rf-toast-bg por dentro e outline transparente', () => {
    expect(de('.new-version-toast__actions button:focus-visible')).toEqual({
      outline: '2px solid transparent',
      'outline-offset': '2px',
      'box-shadow': '0 0 0 3px var(--rf-toast-bg), 0 0 0 5px var(--rf-primary)',
    });
  });

  it('.toast--success/--danger/--warning (0 usos no TSX) nao existem mais no CSS (sairam na TROCA-2)', () => {
    const fora = foraDasRegioes(css, regs);
    for (const v of ['success', 'danger', 'warning']) expect(fora).not.toContain(`.toast--${v} {`);
    expect(limpo).not.toContain('toast--');
  });
});
