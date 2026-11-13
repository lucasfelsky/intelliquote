import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isValidCnpj, normalizeCnpj } from '../src/utils/cnpj';

// O repositorio e PUBLICO: os fixtures so podem ter dados fictícios no formato real do Pipedrive.
const DIR = resolve(__dirname, 'fixtures', 'pipedrive');
const ALLOWED_CNPJ_DIGITS = new Set(['11222333000181', '11444777000161']);
const FILES = readdirSync(DIR).filter((name) => name.endsWith('.json'));

/** Todas as strings do JSON (valores e chaves), inclusive HTML de notas. */
function collectStrings(value: unknown, into: string[] = []): string[] {
  if (typeof value === 'string') {
    into.push(value);
  } else if (Array.isArray(value)) {
    value.forEach((item) => collectStrings(item, into));
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      into.push(key);
      collectStrings(item, into);
    }
  }
  return into;
}

function load(name: string): string[] {
  return collectStrings(JSON.parse(readFileSync(join(DIR, name), 'utf8')));
}

const DATE_TIME = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z?)?$/;
const CNPJ_PATTERN = /\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/g;

describe('fixtures ficticias', () => {
  it('ha fixtures e todos sao JSON com success=true', () => {
    expect(FILES.length).toBeGreaterThanOrEqual(13);
    for (const name of FILES) {
      const parsed = JSON.parse(readFileSync(join(DIR, name), 'utf8')) as { success?: boolean };
      expect(parsed.success, name).toBe(true);
    }
  });

  it('todo CNPJ pertence a lista de teste e os dois sao validos', () => {
    for (const digits of ALLOWED_CNPJ_DIGITS) {
      expect(isValidCnpj(digits)).toBe(true);
    }
    const found = new Set<string>();
    for (const name of FILES) {
      for (const text of load(name)) {
        for (const match of text.matchAll(CNPJ_PATTERN)) {
          found.add(normalizeCnpj(match[0]));
          expect(ALLOWED_CNPJ_DIGITS.has(normalizeCnpj(match[0])), `${name}: CNPJ fora da lista`).toBe(true);
        }
      }
    }
    expect(found.size).toBeGreaterThan(0);
  });

  it('todo e-mail termina em @exemplo.com.br', () => {
    let count = 0;
    for (const name of FILES) {
      for (const text of load(name)) {
        for (const match of text.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g)) {
          count += 1;
          expect(match[0].toLowerCase().endsWith('@exemplo.com.br'), `${name}: e-mail fora de exemplo.com.br`).toBe(true);
        }
      }
    }
    expect(count).toBeGreaterThan(0);
  });

  it('nenhum telefone (sequencia de 8 ou mais digitos, fora datas e CNPJ)', () => {
    for (const name of FILES) {
      for (const text of load(name)) {
        if (DATE_TIME.test(text) || /^[0-9a-f]{40}$/.test(text)) continue; // data e chave de campo (hash)
        const withoutCnpj = text.replace(CNPJ_PATTERN, ' ');
        for (const match of withoutCnpj.matchAll(/\+?\d[\d ().-]{6,}\d/g)) {
          const digits = match[0].replace(/\D/g, '');
          expect(digits.length, `${name}: sequencia de ${digits.length} digitos`).toBeLessThan(8);
        }
      }
    }
  });

  it('nenhuma URL https://<x>.pipedrive.com fora de "exemplo"', () => {
    let count = 0;
    for (const name of FILES) {
      for (const text of load(name)) {
        for (const match of text.matchAll(/https?:\/\/([a-z0-9-]+)\.pipedrive\.com/gi)) {
          count += 1;
          expect((match[1] as string).toLowerCase(), name).toBe('exemplo');
        }
      }
    }
    expect(count).toBeGreaterThan(0);
  });

  it('ids de teste: nada de id numerico real de funil, coluna ou usuario nos fixtures', () => {
    // Constantes fictícias distintas das reais (9010/9020/9xxxxx); as reais ficam so em env/config fora do repositorio.
    const raw = FILES.map((name) => readFileSync(join(DIR, name), 'utf8')).join('\n');
    expect(raw).toContain('"pipeline_id": 9010');
    expect(raw).toContain('"stage_id": 9020');
  });
});
