#!/usr/bin/env node
// audit-vault.cjs — auditoria vault×codigo do IntelliQuote.
//
// Espelha o `scripts/audit-vault-counts.cjs` do Portal COMEX, mas nasceu ja'
// com checks de CONTEUDO (a lição da L26 daquele repo: validar so'
// cardinalidade da' falso verde).
//
// POR QUE ESTE SCRIPT EXISTE
// A auditoria vault×codigo de 2026-07-23 achou 13 arquivos do Inventario do
// IntelliQuote com drift — e aqui estavam os erros MAIS graves dos dois apps,
// porque eram APIs que sequer compilariam se alguem seguisse a doc:
//   - `useAuth` documentado com `loading` (o real e' `status`, enum de 3
//     estados) e `loginWithFirebase` (nao existe);
//   - `tokenStore` com os 5 nomes errados (`saveTokens`, `getAccessToken`,
//     `getStoredUser`, ...) — nenhum existe;
//   - endpoints ficticios (`/quote-comparisons`, `/mail-logs`, `/audit-logs`,
//     CRUD de `/exchange-rates`);
//   - arquivos inexistentes citados como entry point (`src/index.ts`,
//     `src/lib/firebase.ts`, `routes/DispatchRoutes.ts`);
//   - 2 de 5 templates de e-mail documentados; 23 de 25 models; 21 de 25
//     migrations.
//
// DESIGN (igual ao do COMEX, e pelo mesmo motivo)
// O vault mora FORA do repo (`Área de Trabalho/Obsidian/...`), entao este
// script NAO o le' — isso quebraria o CI e amarraria tudo a um caminho
// absoluto nao versionado. Ele deriva os fatos do CODIGO e compara com a
// fixture `tests/fixtures/expected-inventory.json`, que e' o espelho
// versionado do vault. O elo humano e' a MENSAGEM DE ERRO: cada falha diz
// qual arquivo do vault atualizar junto com a fixture.
//
// Uso:
//   node scripts/audit-vault.cjs            # audita (exit 1 se houver drift)
//   node scripts/audit-vault.cjs --print    # imprime os valores REAIS em JSON
//                                           # (para atualizar a fixture)

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const FIXTURE = path.join(ROOT, 'tests', 'fixtures', 'expected-inventory.json');

const VAULT = 'Obsidian/Portal COMEX/Portal COMEX/Inventário/IntelliQuote';

function fail(msg) {
  console.error(`✗ ${msg}`);
  return false;
}
function ok(msg) {
  console.log(`✓ ${msg}`);
}

function listFiles(relDir, ext) {
  const dir = path.join(ROOT, relDir);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(ext))
    .sort();
}

function read(relFile) {
  const file = path.join(ROOT, relFile);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

function stripLineComments(text) {
  return text.replace(/\/\/[^\n]*/g, '');
}

// --- extratores -------------------------------------------------------------

// Models e enums do schema Prisma.
function prismaBlocks(kind) {
  const schema = read(path.join('prisma', 'schema.prisma'));
  return Array.from(schema.matchAll(new RegExp(`^${kind}\\s+(\\w+)`, 'gm')))
    .map((m) => m[1])
    .sort();
}

// Migrations aplicadas (diretorios), sem o migration_lock.toml.
function migrationNames() {
  const dir = path.join(ROOT, 'prisma', 'migrations');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

// Templates de e-mail: derivados dos arquivos `nome-com-hifen.locale.html`.
// `quote-dispatch.en.html` -> { key: 'quote_dispatch', locale: 'en' }.
// Pega a classe de bug "2 de 5 templates documentados".
function emailTemplates() {
  return listFiles(path.join('src', 'mailer', 'templates'), '.html')
    .map((file) => {
      const base = file.replace(/\.html$/, '');
      const dot = base.lastIndexOf('.');
      if (dot === -1) return null;
      return `${base.slice(0, dot).replace(/-/g, '_')}@${base.slice(dot + 1)}`;
    })
    .filter(Boolean)
    .sort();
}

// Paths de rota do backend. Cobre os dois estilos do repo: path na mesma linha
// do `.get(` e path na linha seguinte (varios arquivos usam multiline).
function backendRoutePaths() {
  const dir = path.join(ROOT, 'src', 'routes');
  if (!fs.existsSync(dir)) return [];
  const found = new Set();
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
    const source = stripLineComments(fs.readFileSync(path.join(dir, file), 'utf8'));
    for (const m of source.matchAll(/\.(get|post|put|patch|delete)\(\s*(['"`])([^'"`]+)\2/g)) {
      found.add(`${m[1].toUpperCase()} ${m[3]}`);
    }
  }
  return Array.from(found).sort();
}

// Chaves do `interface AuthContextValue { ... }` no AuthProvider do web.
// Pega o drift de `loading` vs `status` e o fantasma `loginWithFirebase`.
function authContextKeys() {
  const source = read(path.join('web', 'src', 'auth', 'AuthProvider.tsx'));
  const match = source.match(/interface AuthContextValue\s*\{([\s\S]*?)\n\}/);
  if (!match) return null;
  return Array.from(stripLineComments(match[1]).matchAll(/^\s*(\w+)\s*[?:]/gm))
    .map((m) => m[1])
    .sort();
}

// Metodos do objeto `tokenStore`. Pega os 5 nomes-fantasma da vault.
function tokenStoreMethods() {
  const source = read(path.join('web', 'src', 'auth', 'tokenStore.ts'));
  const match = source.match(/export const tokenStore\s*=\s*\{([\s\S]*?)\n\};/);
  if (!match) return null;
  return Array.from(stripLineComments(match[1]).matchAll(/^\s{2}(\w+)\s*[<(]/gm))
    .map((m) => m[1])
    .sort();
}

// Rotas do frontend (`path="..."` no App.tsx do web).
function webRoutePaths() {
  const source = read(path.join('web', 'src', 'App.tsx'));
  return Array.from(source.matchAll(/path="([^"]*)"/g))
    .map((m) => m[1])
    .sort();
}

// O IntelliQuote tem DOIS package.json: a raiz (backend) e `web/` (frontend).
// Deps como `date-fns`, `@tanstack/react-query` e `react-router-dom` vivem so'
// no do web — ler apenas a raiz marcaria todas como fantasma (falso positivo
// que eu mesmo produzi na primeira versao deste check).
function installedDeps() {
  const deps = new Set();
  for (const rel of ['package.json', path.join('web', 'package.json')]) {
    const raw = read(rel);
    if (!raw) continue;
    const parsed = JSON.parse(raw);
    for (const name of Object.keys(parsed.dependencies ?? {})) deps.add(name);
    for (const name of Object.keys(parsed.devDependencies ?? {})) deps.add(name);
  }
  return deps;
}

// ---------------------------------------------------------------------------
// Checks que leem o VAULT (fecham o elo fixture↔vault). Opcionais: rodam
// quando a pasta e' encontrada (dev local) e sao PULADOS quando nao (CI).
// Aponta para o subtree do IntelliQuote — o `Inventário/` tem tambem o do
// Portal COMEX, com arquivos homonimos (`Stack.md`, `_index.md`).
// ---------------------------------------------------------------------------

const VAULT_REL = path.join(
  'Obsidian',
  'Portal COMEX',
  'Portal COMEX',
  'Inventário',
  'IntelliQuote'
);

function findVaultDir() {
  if (process.env.SKIP_VAULT_CHECK === '1') return null;
  if (process.env.VAULT_DIR) {
    return fs.existsSync(process.env.VAULT_DIR) ? process.env.VAULT_DIR : null;
  }
  let dir = ROOT;
  for (let i = 0; i < 6; i += 1) {
    const candidate = path.join(dir, VAULT_REL);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function listMarkdown(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listMarkdown(full));
    else if (entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

// Mencao a fantasma e' legitima em contexto historico/de correcao — e' assim
// que o vault documenta o proprio drift. Tambem e' legitima numa linha que
// NEGA a existencia. O check so' acusa fantasma descrito COMO SE FOSSE REAL.
const CORRECTION_CONTEXT =
  /corrigid|correç|corre[cç]ao|nunca existiu|drift|removid|substitu|era documentad|fantasma|superad|deprecad|obsolet|hist[oó]ric/i;
const NEGATION = /\b(sem|não|nao|nunca|inexistent|ausent)\b|\*\*(não|nao|sem)\*\*/i;

function isHistoricalLine(line) {
  return (
    line.trimStart().startsWith('>') ||
    CORRECTION_CONTEXT.test(line) ||
    NEGATION.test(line)
  );
}

function scanVaultForPhantoms(vaultDir, phantoms) {
  const hits = [];
  for (const file of listMarkdown(vaultDir)) {
    fs.readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .forEach((line, index) => {
        if (isHistoricalLine(line)) return;
        for (const phantom of phantoms) {
          if (line.includes(phantom)) {
            hits.push(`${path.basename(file)}:${index + 1} → "${phantom}"`);
          }
        }
      });
  }
  return hits;
}

function scanVaultForMissing(vaultDir, required) {
  const corpus = listMarkdown(vaultDir)
    .map((file) => fs.readFileSync(file, 'utf8'))
    .join('\n');
  return required.filter((item) => !corpus.includes(item));
}

// --- coleta -----------------------------------------------------------------

function collectActual() {
  return {
    backend: {
      controllers: listFiles(path.join('src', 'controllers'), '.ts'),
      services: listFiles(path.join('src', 'services'), '.ts'),
      middlewares: listFiles(path.join('src', 'middlewares'), '.ts'),
      validators: listFiles(path.join('src', 'validators'), '.ts'),
      lib: listFiles(path.join('src', 'lib'), '.ts'),
      routeFiles: listFiles(path.join('src', 'routes'), '.ts'),
    },
    prisma: {
      models: prismaBlocks('model'),
      enums: prismaBlocks('enum'),
      migrations: migrationNames().length,
    },
    emailTemplates: emailTemplates(),
    backendRoutes: backendRoutePaths(),
    web: {
      pages: listFiles(path.join('web', 'src', 'pages'), '.tsx'),
      authContextKeys: authContextKeys(),
      tokenStoreMethods: tokenStoreMethods(),
      routes: webRoutePaths(),
    },
  };
}

// --- comparacao -------------------------------------------------------------

function diffLists(label, expected, actual, vaultHint, mismatches) {
  if (actual === null) {
    mismatches.push(
      fail(
        `${label}: nao consegui extrair do codigo (arquivo/estrutura mudou?). ` +
          `Ajuste o extrator em scripts/audit-vault.cjs E ${vaultHint}`
      )
    );
    return;
  }
  const exp = [...expected].sort();
  const act = [...actual].sort();
  const onlyCode = act.filter((x) => !exp.includes(x));
  const onlyFixture = exp.filter((x) => !act.includes(x));

  if (onlyCode.length === 0 && onlyFixture.length === 0) {
    ok(`${label} = ${act.length}`);
    return;
  }
  const parts = [];
  if (onlyCode.length > 0) parts.push(`no codigo mas NAO na fixture: ${onlyCode.join(', ')}`);
  if (onlyFixture.length > 0) {
    parts.push(`na fixture mas NAO no codigo: ${onlyFixture.join(', ')}`);
  }
  mismatches.push(
    fail(`${label} diverge — ${parts.join(' | ')}. Atualize a fixture E ${vaultHint}`)
  );
}

function diffNumber(label, expected, actual, vaultHint, mismatches) {
  if (expected === actual) {
    ok(`${label} = ${actual}`);
    return;
  }
  mismatches.push(
    fail(`${label}: esperado ${expected}, obtido ${actual}. Atualize a fixture E ${vaultHint}`)
  );
}

function main() {
  const actual = collectActual();

  if (process.argv.includes('--print')) {
    console.log(JSON.stringify(actual, null, 2));
    process.exit(0);
  }

  if (!fs.existsSync(FIXTURE)) {
    console.error(`Fixture nao encontrada: ${FIXTURE}`);
    console.error('Gere com: node scripts/audit-vault.cjs --print');
    process.exit(2);
  }
  const fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const mismatches = [];

  // 1-6. Modulos do backend.
  const backendHint = `"${VAULT}/02 - Backend/" (Módulos.md, Services.md, Controllers.md)`;
  for (const key of ['controllers', 'services', 'middlewares', 'validators', 'lib', 'routeFiles']) {
    diffLists(
      `src/${key === 'routeFiles' ? 'routes' : key}`,
      fixture.backend?.[key] ?? [],
      actual.backend[key],
      backendHint,
      mismatches
    );
  }

  // 7-9. Prisma.
  const prismaHint = `"${VAULT}/04 - Banco de dados/Prisma Models.md" e /Migrações.md`;
  diffLists('prisma models', fixture.prisma?.models ?? [], actual.prisma.models, prismaHint, mismatches);
  diffLists('prisma enums', fixture.prisma?.enums ?? [], actual.prisma.enums, prismaHint, mismatches);
  diffNumber(
    'prisma migrations',
    fixture.prisma?.migrations,
    actual.prisma.migrations,
    prismaHint,
    mismatches
  );

  // 10. Templates de e-mail (chave@locale).
  diffLists(
    'email templates (chave@locale)',
    fixture.emailTemplates ?? [],
    actual.emailTemplates,
    `"${VAULT}/06 - Notificações e E-mails/Templates.md" (atenção ao locale: supplier_response_received e' pt, os outros en)`,
    mismatches
  );

  // 11. Rotas do backend.
  diffLists(
    'backend routes',
    fixture.backendRoutes ?? [],
    actual.backendRoutes,
    `"${VAULT}/02 - Backend/Endpoints.md" (ja' teve /quote-comparisons, /mail-logs e /audit-logs ficticios)`,
    mismatches
  );

  // 12-15. Web.
  diffLists(
    'web pages',
    fixture.web?.pages ?? [],
    actual.web.pages,
    `"${VAULT}/03 - Frontend/Páginas.md"`,
    mismatches
  );
  diffLists(
    'web AuthContextValue',
    fixture.web?.authContextKeys ?? [],
    actual.web.authContextKeys,
    `"${VAULT}/03 - Frontend/Hooks e Stores.md" (o real e' status, NAO loading; nao existe loginWithFirebase)`,
    mismatches
  );
  diffLists(
    'web tokenStore',
    fixture.web?.tokenStoreMethods ?? [],
    actual.web.tokenStoreMethods,
    `"${VAULT}/03 - Frontend/Hooks e Stores.md" (sao metodos de objeto: getAccess/getUser/set/clear)`,
    mismatches
  );
  diffLists(
    'web routes',
    fixture.web?.routes ?? [],
    actual.web.routes,
    `"${VAULT}/03 - Frontend/Rotas.md"`,
    mismatches
  );

  // 16. Dependencias que a vault afirma existir.
  if (fixture.declaredDependencies) {
    const installed = installedDeps();
    const phantom = fixture.declaredDependencies.filter((dep) => !installed.has(dep));
    if (phantom.length > 0) {
      mismatches.push(
        fail(
          `dependencias-fantasma (citadas na vault, ausentes do package.json): ${phantom.join(', ')}. ` +
            `Instale-as OU remova a mencao de "${VAULT}/01 - Visão geral/Stack.md"`
        )
      );
    } else {
      ok(`declaredDependencies = ${fixture.declaredDependencies.length} (todas instaladas)`);
    }
  }

  // 17. Arquivos que a vault JA' citou e que NAO devem existir. Inverte o
  //     check: se algum voltar a existir, a nota de correcao no vault fica
  //     errada e precisa sair.
  if (fixture.mustNotExist) {
    const resurrected = fixture.mustNotExist.filter((rel) =>
      fs.existsSync(path.join(ROOT, rel))
    );
    if (resurrected.length > 0) {
      mismatches.push(
        fail(
          `arquivos marcados como inexistentes VOLTARAM a existir: ${resurrected.join(', ')}. ` +
            `Remova-os da fixture E as notas "nao existe" do vault (${VAULT}/02 - Backend/Módulos.md)`
        )
      );
    } else {
      ok(`mustNotExist = ${fixture.mustNotExist.length} (nenhum existe, como esperado)`);
    }
  }

  // 18-19. Checks que leem o vault (opcionais — pulados sem a pasta).
  let checks = 17;
  const vaultDir = findVaultDir();

  if (!vaultDir) {
    console.log('· vault nao encontrada — checks de vault PULADOS (normal em CI)');
  } else {
    if (fixture.vaultMustMention) {
      checks += 1;
      const missing = scanVaultForMissing(vaultDir, fixture.vaultMustMention);
      if (missing.length > 0) {
        mismatches.push(
          fail(
            `vault NAO menciona em lugar nenhum: ${missing.join(', ')}. ` +
              'Existe no codigo e nao esta documentado.'
          )
        );
      } else {
        ok(`vault menciona todos os ${fixture.vaultMustMention.length} identificadores exigidos`);
      }
    }

    if (fixture.vaultMustNotMention) {
      checks += 1;
      const hits = scanVaultForPhantoms(vaultDir, fixture.vaultMustNotMention);
      if (hits.length > 0) {
        mismatches.push(
          fail(
            'vault descreve identificador-FANTASMA como se fosse real ' +
              `(fora de nota de correcao):\n    ${hits.join('\n    ')}\n  ` +
              'Se for contexto historico, deixe a linha num blockquote (">").'
          )
        );
      } else {
        ok(`vault sem mencao ativa aos ${fixture.vaultMustNotMention.length} fantasmas conhecidos`);
      }
    }
  }

  console.log(`\n${checks} checks, ${mismatches.length} mismatches`);

  if (mismatches.length > 0) {
    console.error('\nAUDIT FAILED. Atualize tests/fixtures/expected-inventory.json e a vault.');
    process.exit(1);
  }
  process.exit(0);
}

main();
