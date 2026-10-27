// Forecast preditivo (fase 0): leitura de entrada (CSV ou JSON, texto -> series) e protecao de caminho.
// Nunca ecoa o VALOR de uma linha rejeitada (so o numero da linha e o motivo): o dado pode ser real.
import * as nodePath from 'node:path';
import { anoMesValido } from './forecastPreditivoSerie';
import type { PontoMensal, SerieEntrada } from './forecastPreditivoTipos';

export const LIMITE_SERIES = 5000;
export const LIMITE_PONTOS = 240;

type Caminhos = typeof nodePath.win32 | typeof nodePath.posix;

const OBRIGATORIAS = ['serie', 'anomes', 'quantidade'];
const NENHUMA = 'nenhuma serie';

const leadTimeValido = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 3650;

class Acumulador {
  readonly erros: string[] = [];
  private readonly mapa = new Map<string, SerieEntrada>();
  private limiteSeries = false;
  private limitePontos = false;

  serie(id: string): SerieEntrada | null {
    const existente = this.mapa.get(id);
    if (existente) return existente;
    if (this.mapa.size >= LIMITE_SERIES) {
      if (!this.limiteSeries) this.erros.push(`limite de ${LIMITE_SERIES} series excedido`);
      this.limiteSeries = true;
      return null;
    }
    const nova: SerieEntrada = { id, pontos: [] };
    this.mapa.set(id, nova);
    return nova;
  }

  ponto(s: SerieEntrada, p: PontoMensal): void {
    if (s.pontos.length >= LIMITE_PONTOS) {
      if (!this.limitePontos) this.erros.push(`limite de ${LIMITE_PONTOS} pontos por serie excedido`);
      this.limitePontos = true;
      return;
    }
    s.pontos.push(p);
  }

  resultado(): { series: SerieEntrada[]; erros: string[] } {
    const series = [...this.mapa.values()];
    return { series, erros: series.length === 0 ? [...this.erros, NENHUMA] : this.erros };
  }
}

function lerCsv(texto: string): { series: SerieEntrada[]; erros: string[] } {
  const acc = new Acumulador();
  const linhas = texto.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/);
  const primeira = linhas.findIndex((l) => l.trim() !== '');
  if (primeira < 0) return acc.resultado();
  const sep = linhas[primeira].includes(';') ? ';' : ',';
  const nomes = linhas[primeira].split(sep).map((c) => c.trim().toLowerCase());
  if (OBRIGATORIAS.some((c) => !nomes.includes(c))) {
    acc.erros.push('cabecalho invalido: faltam colunas obrigatorias (serie, anoMes, quantidade)');
    return acc.resultado();
  }
  const col = (campos: string[], nome: string): string => {
    const i = nomes.indexOf(nome);
    return i < 0 ? '' : (campos[i] ?? '').trim();
  };
  const regexQtd = sep === ';' ? /^-?\d+([.,]\d+)?$/ : /^-?\d+(\.\d+)?$/;
  for (let i = primeira + 1; i < linhas.length; i++) {
    if (linhas[i].trim() === '') continue;
    const n = i + 1;
    const campos = linhas[i].split(sep);
    const id = col(campos, 'serie');
    const anoMes = col(campos, 'anomes');
    const qtdTexto = col(campos, 'quantidade');
    const atipico = col(campos, 'atipico');
    const ruptura = col(campos, 'ruptura');
    const leadTexto = col(campos, 'leadtimedias');
    const motivo =
      campos.length !== nomes.length
        ? 'numero de colunas diferente do cabecalho'
        : id === ''
          ? 'serie vazia'
          : !anoMesValido(anoMes)
            ? 'anoMes invalido'
            : !regexQtd.test(qtdTexto)
              ? 'quantidade invalida'
              : !['', '0', '1'].includes(atipico)
                ? 'atipico invalido'
                : !['', '0', '1'].includes(ruptura)
                  ? 'ruptura invalido'
                  : leadTexto !== '' && !(/^\d+$/.test(leadTexto) && leadTimeValido(Number(leadTexto)))
                    ? 'leadTimeDias invalido'
                    : null;
    if (motivo !== null) {
      acc.erros.push(`linha ${n}: ${motivo}`);
      continue;
    }
    const s = acc.serie(id);
    if (!s) continue;
    acc.ponto(s, { anoMes, qtd: Number(qtdTexto.replace(',', '.')), atipico: atipico === '1', ruptura: ruptura === '1' });
    const fonte = col(campos, 'fonte');
    const familia = col(campos, 'familia');
    if (fonte !== '' && s.fonte === undefined) s.fonte = fonte;
    if (familia !== '' && s.familia === undefined) s.familia = familia;
    if (leadTexto !== '' && s.leadTimeDias === undefined) s.leadTimeDias = Number(leadTexto);
  }
  return acc.resultado();
}

const objeto = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

function lerJson(texto: string): { series: SerieEntrada[]; erros: string[] } {
  const acc = new Acumulador();
  let raiz: unknown;
  try {
    raiz = JSON.parse(texto.replace(/^\uFEFF/, ''));
  } catch {
    acc.erros.push('json invalido');
    return acc.resultado();
  }
  if (!objeto(raiz) || !Array.isArray(raiz.series)) {
    acc.erros.push('json invalido: esperado { "series": [...] }');
    return acc.resultado();
  }
  raiz.series.forEach((item: unknown, idx: number) => {
    if (!objeto(item) || typeof item.id !== 'string' || item.id.trim() === '' || !Array.isArray(item.pontos)) {
      acc.erros.push(`serie ${idx + 1}: formato invalido`);
      return;
    }
    const s = acc.serie(item.id.trim());
    if (!s) return;
    if (typeof item.fonte === 'string' && item.fonte.trim() !== '' && s.fonte === undefined) s.fonte = item.fonte.trim();
    if (typeof item.familia === 'string' && item.familia.trim() !== '' && s.familia === undefined) s.familia = item.familia.trim();
    if (item.leadTimeDias !== undefined && item.leadTimeDias !== null) {
      if (leadTimeValido(item.leadTimeDias)) {
        if (s.leadTimeDias === undefined) s.leadTimeDias = item.leadTimeDias;
      }
      else acc.erros.push(`serie ${idx + 1}: leadTimeDias invalido`);
    }
    item.pontos.forEach((p: unknown, j: number) => {
      const bom =
        objeto(p) &&
        anoMesValido(p.anoMes) &&
        typeof p.qtd === 'number' &&
        Number.isFinite(p.qtd) &&
        (p.atipico === undefined || typeof p.atipico === 'boolean') &&
        (p.ruptura === undefined || typeof p.ruptura === 'boolean');
      if (!bom) {
        acc.erros.push(`serie ${idx + 1}: ponto ${j + 1} invalido`);
        return;
      }
      const q = p as Record<string, unknown>;
      acc.ponto(s, { anoMes: q.anoMes as string, qtd: q.qtd as number, atipico: q.atipico === true, ruptura: q.ruptura === true });
    });
  });
  return acc.resultado();
}

export function lerEntrada(texto: string, formato: 'csv' | 'json'): { series: SerieEntrada[]; erros: string[] } {
  return formato === 'json' ? lerJson(texto) : lerCsv(texto);
}

export function caminhoSob(base: string, alvo: string, caminhos: Caminhos): boolean {
  const rel = caminhos.relative(base, alvo);
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + caminhos.sep) && !caminhos.isAbsolute(rel));
}

// Pasta de fixtures do backend: unica parte do repo que o CLI aceita como entrada (dado sintetico/anonimizado).
export function pastaFixtures(raizRepo: string, caminhos: Caminhos = nodePath): string {
  return caminhos.join(raizRepo, 'programa', 'tests', 'fixtures');
}

// true se o caminho esta sob `raizRepo` e NAO sob programa/tests/fixtures.
export function entradaDentroDoRepo(caminhoAbsoluto: string, raizRepo: string, caminhos: Caminhos = nodePath): boolean {
  return caminhoSob(raizRepo, caminhoAbsoluto, caminhos) && !caminhoSob(pastaFixtures(raizRepo, caminhos), caminhoAbsoluto, caminhos);
}

// Primeiro diretorio ancestral com `.git` (arquivo ou pasta: o worktree tem `.git` ARQUIVO); null se nenhum.
export function ancestralComGit(caminhoAbsoluto: string, existe: (c: string) => boolean, caminhos: Caminhos = nodePath): string | null {
  let dir = caminhos.dirname(caminhoAbsoluto);
  for (;;) {
    if (existe(caminhos.join(dir, '.git'))) return dir;
    const pai = caminhos.dirname(dir);
    if (pai === dir) return null;
    dir = pai;
  }
}
