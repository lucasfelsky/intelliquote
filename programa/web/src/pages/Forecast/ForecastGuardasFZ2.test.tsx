import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ForecastImportModal from './ForecastImportModal';
import { parseRules, readSource, regioes, type CssRule } from '../../test/rfCss';

// FZ2: guardas unitarias de duas regras de CSS que so o harness (captura em navegador) protegia:
//  - o <input type="file"> do Importar DBCorp fica fora da tela (nao some) ate um arquivo ser escolhido; com arquivo escolhido ele e display:none e o
//    botao "Remover" devolve a entrada (nova `key`) - sem isso o comprador ficaria sem como trocar o arquivo;
//  - `.fci-destaque` (avisos do FUP no resumo): o conteudo ao lado do icone tem `min-width: 0`; sem ele a tabela larga estica o cartao e a pagina estoura a 390.
// O CSS e lido do globals.css (regiao `tela F13`, dentro de @media screen), como nas guardas telaF13.

vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() },
  ApiError: class ApiError extends Error {
    status: number;
    body: unknown;
    constructor(status: number, body: unknown, message?: string) {
      super(message ?? `HTTP ${status}`);
      this.status = status;
      this.body = body;
    }
  },
}));

const css = readSource('../styles/globals.css').replace(/\r\n/g, '\n');
const regiao = regioes(css).find((r) => r.nome === 'tela F13');

// Regras folha da regiao, entrando em @media/@supports; cada uma carrega a lista de seletores e as declaracoes.
interface Regra {
  seletores: string[];
  decl: Map<string, string>;
  emTela: boolean;
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

function declaracoes(corpo: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const [, prop, valor] of corpo.matchAll(/(?:^|;)\s*([\w-]+)\s*:\s*([^;]+)/g)) if (prop && valor) m.set(prop, valor.trim());
  return m;
}

function achatar(rules: CssRule[], emTela: boolean): Regra[] {
  return rules.flatMap((r) => {
    if (r.prelude.startsWith('@media')) return achatar(parseRules(r.body), emTela || /\bscreen\b/.test(r.prelude));
    if (r.prelude.startsWith('@')) return [];
    return [{ seletores: seletoresDe(r.prelude), decl: declaracoes(r.body), emTela }];
  });
}

const regras = achatar(regiao?.regras ?? [], false);
const regrasDo = (seletor: string) => regras.filter((r) => r.seletores.includes(seletor));

describe('FZ2: CSS do input de arquivo do Importar (regiao tela F13)', () => {
  const ENTRADA = '.fc-pagina .fci-arquivo > input[type="file"]';
  const COM_ARQUIVO = '.fc-pagina .fci-arquivo:has(> .fci-slot__arquivo) > input[type="file"]';
  const FOCO = '.fc-pagina .fci-arquivo > input[type="file"]:focus-visible + .fci-escolher';

  it('com arquivo escolhido (o cartao tem .fci-slot__arquivo) a entrada e display:none, so em tela', () => {
    const r = regrasDo(COM_ARQUIVO);
    expect(r).toHaveLength(1);
    expect(r[0]?.emTela).toBe(true);
    expect(r[0]?.decl.get('display')).toBe('none');
  });

  it('sem arquivo a entrada continua no fluxo de foco: fora da tela por posicao/opacidade, NUNCA display:none (nem visibility:hidden)', () => {
    const r = regrasDo(ENTRADA);
    expect(r).toHaveLength(1);
    const d = r[0]?.decl;
    expect(d?.get('position')).toBe('absolute');
    expect(d?.get('opacity')).toBe('0');
    expect(d?.has('display')).toBe(false);
    expect(d?.has('visibility')).toBe(false);
  });

  it('o foco da entrada acende o botao "Escolher .xlsx" (irmao seguinte)', () => {
    expect(regrasDo(FOCO)).toHaveLength(1);
  });
});

describe('FZ2: CSS do destaque do FUP (regiao tela F13)', () => {
  it('o conteudo ao lado do icone encolhe (min-width: 0, flex: 1 1 0): a tabela rola dentro do cartao em vez de esticar a pagina', () => {
    const r = regrasDo('.fc-pagina .fci-destaque > :not(.fci-destaque__icone)');
    expect(r).toHaveLength(1);
    expect(r[0]?.emTela).toBe(true);
    expect(r[0]?.decl.get('min-width')).toBe('0');
    expect(r[0]?.decl.get('flex')).toBe('1 1 0');
  });
});

describe('FZ2: foco do painel de aba do Fontes e lead time (CSS)', () => {
  it('o painel de aba do Fontes (.fco-abas) tem anel de foco por teclado (focus-visible), igual ao dos modais Importar e Completar', () => {
    const regraDoAnel = (css.match(/[^{}]*\.fco-abas \.tabs-panel:focus-visible[^{]*\{[^}]*\}/) ?? [''])[0];
    expect(regraDoAnel).toContain('.fci-modal .tabs-panel:focus-visible');
    expect(regraDoAnel).toMatch(/outline:\s*2px solid var\(--primary-700\)/);
    expect(regraDoAnel).toMatch(/box-shadow:[^;]*var\(--focus-ring-strong\)/);
  });
});

describe('FZ2: contrato de marcacao do Importar DBCorp com o CSS acima', () => {
  afterEach(() => cleanup());

  function renderImport() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ForecastImportModal aberto onFechar={vi.fn()} quinzenasExistentes={[]} onImportada={vi.fn()} somenteDbcorp />
      </QueryClientProvider>,
    );
  }

  it('sem arquivo: entrada e filha direta de .fci-arquivo e o botao e o irmao SEGUINTE (seletor `+`), rotulo do mesmo id', () => {
    renderImport();
    const entrada = screen.getByLabelText('SALDO') as HTMLInputElement;
    expect(entrada.type).toBe('file');
    expect(entrada.parentElement?.className).toBe('fci-arquivo');
    const botao = entrada.nextElementSibling as HTMLLabelElement;
    expect(botao.className).toBe('fci-escolher');
    expect(botao.htmlFor).toBe(entrada.id);
    expect(entrada.parentElement?.querySelector(':scope > .fci-slot__arquivo')).toBeNull();
  });

  it('com arquivo: o cartao ganha .fci-slot__arquivo como filho direto (liga o display:none) e o Remover devolve a entrada acessivel', () => {
    renderImport();
    const entrada = screen.getByLabelText('SALDO') as HTMLInputElement;
    fireEvent.change(entrada, { target: { files: [new File([new Uint8Array(10)], 'saldo-teste.xlsx')] } });
    const cartao = entrada.closest('.fci-arquivo') as HTMLElement;
    expect(cartao.querySelector(':scope > .fci-slot__arquivo')).not.toBeNull();
    expect(cartao.querySelector(':scope > input[type="file"]')).toBe(entrada);
    fireEvent.click(screen.getByRole('button', { name: 'Remover saldo-teste.xlsx' }));
    const nova = screen.getByLabelText('SALDO') as HTMLInputElement;
    expect(nova.closest('.fci-arquivo')?.querySelector(':scope > .fci-slot__arquivo')).toBeNull();
    expect((nova.nextElementSibling as HTMLLabelElement).htmlFor).toBe(nova.id);
    expect(nova.files).toHaveLength(0);
  });
});
