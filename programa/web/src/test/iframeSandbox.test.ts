import { describe, expect, it } from 'vitest';

// Guarda: todo <iframe srcDoc> de preview de e-mail renderiza HTML de template/resposta do
// fornecedor; `sandbox=""` (sem allow-*) bloqueia scripts, formularios e same-origin.
const sources = import.meta.glob(['/src/**/*.tsx', '!/src/**/*.test.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

function iframeTags(): { file: string; tag: string }[] {
  const found: { file: string; tag: string }[] = [];
  for (const [file, source] of Object.entries(sources)) {
    for (const match of source.matchAll(/<iframe\b[\s\S]*?\/>/g)) {
      found.push({ file, tag: match[0] });
    }
  }
  return found;
}

describe('iframes de preview de e-mail', () => {
  const tags = iframeTags();

  it('existem os 6 iframes de preview conhecidos', () => {
    expect(tags.length).toBeGreaterThanOrEqual(6);
  });

  it.each(tags.map((entry) => [entry.file, entry.tag] as const))(
    '%s: <iframe> com sandbox="" e sem allow-scripts/allow-same-origin',
    (_file, tag) => {
      expect(tag).toMatch(/\bsandbox=""/);
      expect(tag).not.toMatch(/allow-scripts/);
      expect(tag).not.toMatch(/allow-same-origin/);
    },
  );
});
