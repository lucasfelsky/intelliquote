import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/prisma', () => ({ prisma: {} }));

import { INDENT_PORTAL_API_ORIGIN, INDENT_PORTAL_CSP, app } from '../src/app';

// Pagina PUBLICA do portal do fornecedor do IQ Indent (4b-2): rotas com CSP propria, guardas estaticas dos 3 arquivos e funcoes puras do JS.
// Os fluxos da pagina (DOM, fetch, XSS) ficam em web/src/test/indentPortalHtml.test.ts (jsdom).

const requireFromHere = createRequire(import.meta.url);
const publicDir = path.join(process.cwd(), 'public');
const read = (name: string) => readFileSync(path.join(publicDir, name), 'utf8');
const html = read('indent-portal.html');
const css = read('indent-portal.css');
const js = read('indent-portal.js');

const TOKEN = 'A'.repeat(43);
const logic = requireFromHere('../public/indent-portal.js') as Record<string, (...args: unknown[]) => unknown> & {
  API_ORIGIN: string;
  TOKEN_PATTERN: RegExp;
};

describe('rotas da pagina /portal/indent', () => {
  const cases: Array<[string, RegExp]> = [
    ['/portal/indent', /text\/html/],
    [`/portal/indent?token=${TOKEN}`, /text\/html/],
    ['/portal/indent/app.js', /javascript/],
    ['/portal/indent/app.css', /text\/css/],
  ];

  it.each(cases)('GET %s -> 200 com CSP propria, no-cache, no-referrer e nosniff', async (url, type) => {
    const res = await request(app).get(url);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(type);
    expect(res.headers['content-security-policy']).toBe(INDENT_PORTAL_CSP);
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('serve exatamente os arquivos de public/ (html, css, js)', async () => {
    expect((await request(app).get('/portal/indent')).text).toBe(html);
    expect((await request(app).get('/portal/indent/app.css')).text).toBe(css);
    expect((await request(app).get('/portal/indent/app.js')).text).toBe(js);
  });

  it('/portal e /portal/credit NAO ganham CSP (nao regressao)', async () => {
    for (const url of ['/portal', '/portal/credit']) {
      const res = await request(app).get(url);

      expect(res.status).toBe(200);
      expect(res.headers['content-security-policy']).toBeUndefined();
    }
  });

  it('o resto da API tambem segue sem CSP', async () => {
    const res = await request(app).get('/health/live');

    expect(res.headers['content-security-policy']).toBeUndefined();
  });
});

describe('CSP', () => {
  const directives = new Map(INDENT_PORTAL_CSP.split('; ').map((part) => [part.split(' ')[0], part.slice(part.indexOf(' ') + 1)]));

  it('script e estilo so do proprio dominio (nada de inline, eval ou curinga) e fecha o resto', () => {
    expect(INDENT_PORTAL_CSP).not.toMatch(/unsafe-inline|unsafe-eval|\*/);
    expect(directives.get('default-src')).toBe("'none'");
    expect(directives.get('script-src')).toBe("'self'");
    expect(directives.get('style-src')).toBe("'self' https://fonts.googleapis.com");
    expect(directives.get('font-src')).toBe('https://fonts.gstatic.com');
    expect(directives.get('img-src')).toBe("'self' data:");
    expect(directives.get('form-action')).toBe("'none'");
    expect(directives.get('base-uri')).toBe("'none'");
    expect(directives.get('frame-ancestors')).toBe("'none'");
  });

  it('connect-src libera a propria origem e o Cloud Run, que e a MESMA origem que o JS usa quando servido pelo Hosting', () => {
    expect(directives.get('connect-src')).toBe(`'self' ${INDENT_PORTAL_API_ORIGIN}`);
    expect(logic.API_ORIGIN).toBe(INDENT_PORTAL_API_ORIGIN);
    expect(js).toContain(INDENT_PORTAL_API_ORIGIN);
    expect(logic.resolveApiBase({ hostname: 'intelliquote.portal-comex.com', origin: 'https://intelliquote.portal-comex.com' })).toBe(`${INDENT_PORTAL_API_ORIGIN}/api`);
  });
});

describe('guardas estaticas dos arquivos da pagina', () => {
  it('HTML: sem style inline, sem handler on*, scripts so externos e vazios, referrer e idioma', () => {
    expect(html).not.toMatch(/\sstyle\s*=/i);
    expect(html).not.toMatch(/\son[a-z]+\s*=/i);
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];

    expect(scripts).toHaveLength(1);
    expect(scripts[0]![1]).toMatch(/\bsrc="\/portal\/indent\/app\.js"/);
    expect(scripts[0]![2].trim()).toBe('');
    expect(html).toMatch(/<meta name="referrer" content="no-referrer">/);
    expect(html).toMatch(/<meta name="robots" content="noindex,nofollow">/);
    expect(html).toMatch(/<html lang="en">/);
    expect(html).not.toMatch(/javascript:/i);
  });

  it('HTML: os unicos assets locais sao /portal/indent/app.(js|css); o resto e Google Fonts ou data:', () => {
    const refs = [...html.matchAll(/\b(?:src|href)="([^"]+)"/g)].map((match) => match[1]!);

    for (const ref of refs) {
      expect(ref).toMatch(/^(\/portal\/indent\/app\.(js|css)|https:\/\/fonts\.(googleapis|gstatic)\.com[^"]*|data:image\/svg\+xml,.*)$/);
    }
    expect(refs).toContain('/portal/indent/app.css');
    expect(refs).toContain('/portal/indent/app.js');
  });

  it('HTML: o input de arquivo e o unico lugar com "accept"; o resto da pagina nao tem', () => {
    expect(html.match(/accept="[^"]*"/g)).toEqual(['accept=".pdf,application/pdf"']);
    expect(html.replace(/accept="[^"]*"/g, '')).not.toMatch(/\baccept/i);
    expect(js).not.toMatch(/\baccept/i);
    expect(css).not.toMatch(/\baccept/i);
  });

  it('JS: nada de HTML por string, eval, estilo por script, log, localStorage, toISOString', () => {
    for (const forbidden of [
      /innerHTML/,
      /outerHTML/,
      /insertAdjacentHTML/,
      /document\.write/,
      /\beval\s*\(/,
      /new Function/,
      /setAttribute\(\s*['"]style/,
      /\.style\./,
      /console\./,
      /localStorage/,
      /toISOString/,
    ]) {
      expect(js).not.toMatch(forbidden);
    }
    expect(js).toContain('sessionStorage');
  });

  it('JS e HTML: nenhum texto que diga ao fornecedor que a SQ compra em nome de alguem', () => {
    for (const text of [html, js, css]) {
      expect(text).not.toMatch(/\b(buyer|purchaser|on behalf of|our customer)\b/i);
    }
  });

  it('JS: o token so aparece na URL do fetch (nunca em log, titulo ou atributo)', () => {
    const tokenUses = js.split('\n').filter((line) => /\bctx\.token\b/.test(line) || /\bfound\.token\b/.test(line));

    for (const line of tokenUses) {
      expect(line).not.toMatch(/document\.title|setAttribute|\.textContent|\.href|\.src/);
    }
    expect(js).toContain("cache: 'no-store'");
    expect(js).toContain("credentials: 'omit'");
    expect(js).toContain("referrerPolicy: 'no-referrer'");
    expect(js).toContain('encodeURIComponent(extra.file.name)');
  });

  it('CSS: sempre claro (sem prefers-color-scheme), sem @import nem url() externo alem das fontes pelo <link>', () => {
    expect(css).not.toMatch(/prefers-color-scheme/);
    expect(css).not.toMatch(/@import/);
    expect(css).not.toMatch(/url\(/);
    expect(css).toMatch(/color-scheme:\s*light/);
    expect(css).toMatch(/:focus-visible/);
    expect(css).toMatch(/prefers-reduced-motion/);
  });

  it('HTML: os ids que o harness e os testes usam existem nos templates', () => {
    for (const id of ['ip-app', 'cur', 'lead', 'pay', 'valid', 'maker', 'notes', 'files', 'filelist', 'submit', 'edit', 'tot']) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).toContain('id="ip-app" data-state="loading" aria-busy="true"');
    expect(html).toContain('id="filelist" aria-live="polite"');
  });
});

describe('funcoes puras do JS', () => {
  it('normalizePrice: ponto ou virgula, ate 4 decimais e 5 inteiros', () => {
    expect(logic.normalizePrice(' 0,7250 ')).toBe('0.7250');
    expect(logic.normalizePrice('12')).toBe('12');
    expect(logic.normalizePrice('99999.9999')).toBe('99999.9999');
    for (const bad of ['', '0.72501', '123456', '-1', '1e3', '.5', '5.', 'abc', '1,2,3', '1 000']) {
      expect(logic.normalizePrice(bad)).toBeNull();
    }
  });

  it('priceScaled: inteiro x10000, sem ponto flutuante (0.1 + 0.2 nao existe aqui)', () => {
    expect(logic.priceScaled('0.7')).toBe(7000);
    expect(logic.priceScaled('0.7950')).toBe(7950);
    expect(logic.priceScaled('12')).toBe(120000);
    expect(logic.priceScaled('99999.9999')).toBe(999999999);
    expect(Number(logic.priceScaled('1.1005')) > Number(logic.priceScaled('1.1004'))).toBe(true);
  });

  it('errorFieldFromPath: fob e cfr nao se confundem; caminho desconhecido vira null', () => {
    expect(logic.errorFieldFromPath('items.2.cfrPricePerKg')).toBe('cfr2');
    expect(logic.errorFieldFromPath('items.0.fobPricePerKg')).toBe('fob0');
    expect(logic.errorFieldFromPath('items.0.packaging')).toBe('pkg0');
    expect(logic.errorFieldFromPath('productionLeadTimeDays')).toBe('lead');
    expect(logic.errorFieldFromPath('paymentTerms')).toBe('pay');
    expect(logic.errorFieldFromPath('validUntil')).toBe('valid');
    expect(logic.errorFieldFromPath('manufacturer')).toBe('maker');
    expect(logic.errorFieldFromPath('currency')).toBe('cur');
    expect(logic.errorFieldFromPath('notes')).toBe('notes');
    for (const other of ['items', 'items.1.quoteItemId', '', 'toString', '__proto__']) {
      expect(logic.errorFieldFromPath(other)).toBeNull();
    }
  });

  it('resolveApiBase: Cloud Run e localhost usam a propria origem; o Hosting aponta para o Cloud Run', () => {
    expect(logic.resolveApiBase({ hostname: 'x.southamerica-east1.run.app', origin: 'https://x.southamerica-east1.run.app' })).toBe('https://x.southamerica-east1.run.app/api');
    expect(logic.resolveApiBase({ hostname: 'localhost', origin: 'http://localhost:3000' })).toBe('http://localhost:3000/api');
    expect(logic.resolveApiBase({ hostname: '127.0.0.1', origin: 'http://127.0.0.1:3000' })).toBe('http://127.0.0.1:3000/api');
    expect(logic.resolveApiBase({ hostname: 'evil.run.app.example.com', origin: 'https://evil.run.app.example.com' })).toBe(`${INDENT_PORTAL_API_ORIGIN}/api`);
  });

  it('todayKeySaoPaulo: 23:30 em Sao Paulo (02:30 UTC do dia seguinte) ainda e o dia de Sao Paulo', () => {
    expect(logic.todayKeySaoPaulo(new Date('2026-11-27T02:30:00Z'))).toBe('2026-11-26');
    expect(logic.todayKeySaoPaulo(new Date('2026-11-27T03:00:00Z'))).toBe('2026-11-27');
    expect(logic.addDaysToKey('2026-12-31', 1)).toBe('2027-01-01');
    expect(logic.addDaysToKey('2026-11-26', 365)).toBe('2027-11-26');
  });

  it('TOKEN_PATTERN e o mesmo formato do backend (43 chars base64url)', () => {
    expect(logic.TOKEN_PATTERN.test(TOKEN)).toBe(true);
    expect(logic.TOKEN_PATTERN.test('A'.repeat(42))).toBe(false);
    expect(logic.TOKEN_PATTERN.test(`${'A'.repeat(42)}!`)).toBe(false);
  });
});
