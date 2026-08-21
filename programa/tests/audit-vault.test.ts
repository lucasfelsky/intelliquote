// Testes do scripts/audit-vault.cjs (auditoria vault×codigo do IntelliQuote).
//
// Cada caso de drift abaixo reproduz um bug REAL encontrado na auditoria
// vault×codigo de 2026-07-23. Nenhum deles era detectavel antes, porque o
// IntelliQuote nao tinha script de auditoria nenhum — e foi aqui que
// apareceram os erros mais graves dos dois apps (APIs que nao compilariam).
//
// O script roda como child process; os testes mexem na fixture e restauram.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'audit-vault.cjs');
const FIXTURE = path.join(ROOT, 'tests', 'fixtures', 'expected-inventory.json');

function runScript(args: string[] = []) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
  });
}

// Em Windows o exit code pode nao propagar; aceitamos o marcador no output.
function isFailure(result: ReturnType<typeof runScript>) {
  return (
    result.status !== 0 ||
    /AUDIT FAILED/.test(result.stdout ?? '') ||
    /AUDIT FAILED/.test(result.stderr ?? '')
  );
}

type Fixture = Record<string, any>;

function readFixture(): Fixture {
  return JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
}

function writeFixture(value: Fixture) {
  fs.writeFileSync(FIXTURE, `${JSON.stringify(value, null, 2)}\n`);
}

describe('audit-vault (IntelliQuote)', () => {
  // 17 checks sem a vault; 19 quando ela esta' presente (+2 que a leem). O
  // teste aceita os dois porque a vault existe na maquina do dev, nao no CI.
  it('passa com a fixture atual (17 checks sem vault, 19 com)', () => {
    const result = runScript();
    expect(isFailure(result)).toBe(false);
    expect(result.stdout).toMatch(/1[79] checks, 0 mismatches/);
  });

  it('--print emite os valores reais em JSON sem auditar', () => {
    const result = runScript(['--print']);
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    // Sanity: os extratores acharam as estruturas principais.
    expect(parsed.backend.controllers).toContain('DispatchController.ts');
    expect(parsed.prisma.models).toContain('SupplierPortalResponseRevision');
    expect(parsed.web.authContextKeys).toContain('status');
    expect(parsed.web.tokenStoreMethods).toContain('getAccess');
  });

  it('reporta as familias de check no happy path', () => {
    const result = runScript();
    expect(result.stdout).toMatch(/prisma models = 28/);
    expect(result.stdout).toMatch(/prisma migrations = 33/);
    expect(result.stdout).toMatch(/email templates \(chave@locale\) = 6/);
    expect(result.stdout).toMatch(/backend routes = 94/);
    expect(result.stdout).toMatch(/web pages = 15/);
    expect(result.stdout).toMatch(/web AuthContextValue = 7/);
    expect(result.stdout).toMatch(/web tokenStore = 8/);
    expect(result.stdout).toMatch(/web routes = 17/);
  });

  describe('deteccao de drift', () => {
    let original: Fixture;

    beforeEach(() => {
      original = readFixture();
    });

    afterEach(() => {
      try {
        writeFixture(original);
      } catch {
        // ignora
      }
    });

    // Vault: "23 models" quando eram 25 (faltavam SupplierReview,
    // Attachment, SupplierPortalResponseRevision).
    it('detecta model do Prisma ausente da fixture', () => {
      const fixture = readFixture();
      fixture.prisma.models = fixture.prisma.models.filter(
        (m: string) => m !== 'SupplierReview'
      );
      writeFixture(fixture);

      const result = runScript();
      expect(isFailure(result)).toBe(true);
      expect(result.stderr).toMatch(/prisma models diverge/);
      expect(result.stderr).toMatch(/no codigo mas NAO na fixture: SupplierReview/);
      expect(result.stderr).toMatch(/Prisma Models\.md/);
    });

    // Vault: "21 migrations" quando eram 25.
    it('detecta contagem de migrations desatualizada', () => {
      const fixture = readFixture();
      fixture.prisma.migrations = 21;
      writeFixture(fixture);

      const result = runScript();
      expect(isFailure(result)).toBe(true);
      expect(result.stderr).toMatch(/prisma migrations: esperado 21, obtido 33/);
    });

    // Vault documentava 2 de 5 templates. O locale importa:
    // supplier_response_received e' `pt`, os outros `en`.
    it('detecta template de e-mail nao documentado (com locale)', () => {
      const fixture = readFixture();
      fixture.emailTemplates = ['quote_dispatch@en', 'quote_reply@en'];
      writeFixture(fixture);

      const result = runScript();
      expect(isFailure(result)).toBe(true);
      expect(result.stderr).toMatch(/email templates/);
      expect(result.stderr).toMatch(/supplier_response_received@pt/);
      expect(result.stderr).toMatch(/Templates\.md/);
    });

    // Vault: `loading` (o real e' `status`) e `loginWithFirebase` (inexistente).
    // Quem seguisse a doc escreveria `if (loading)` — sempre undefined.
    it('detecta drift no AuthContextValue (loading vs status)', () => {
      const fixture = readFixture();
      fixture.web.authContextKeys = [
        'user',
        'loading',
        'login',
        'loginWithFirebase',
        'logout',
        'refresh',
      ];
      writeFixture(fixture);

      const result = runScript();
      expect(isFailure(result)).toBe(true);
      expect(result.stderr).toMatch(/web AuthContextValue diverge/);
      expect(result.stderr).toMatch(/na fixture mas NAO no codigo:.*loading/);
      expect(result.stderr).toMatch(/loginWithFirebase/);
      expect(result.stderr).toMatch(/Hooks e Stores\.md/);
    });

    // Vault: os 5 nomes do tokenStore, nenhum existente.
    it('detecta os nomes-fantasma do tokenStore', () => {
      const fixture = readFixture();
      fixture.web.tokenStoreMethods = [
        'saveTokens',
        'clearTokens',
        'getAccessToken',
        'getRefreshToken',
        'getStoredUser',
      ];
      writeFixture(fixture);

      const result = runScript();
      expect(isFailure(result)).toBe(true);
      expect(result.stderr).toMatch(/web tokenStore diverge/);
      expect(result.stderr).toMatch(/saveTokens/);
      expect(result.stderr).toMatch(/getStoredUser/);
    });

    // Verbo errado quebra o cliente em silencio (404/405).
    it('detecta verbo HTTP errado numa rota do backend', () => {
      const fixture = readFixture();
      fixture.backendRoutes = fixture.backendRoutes.map((route: string) =>
        route === 'POST /quote-requests/:id/reopen'
          ? 'PATCH /quote-requests/:id/reopen'
          : route
      );
      writeFixture(fixture);

      const result = runScript();
      expect(isFailure(result)).toBe(true);
      expect(result.stderr).toMatch(/backend routes diverge/);
      expect(result.stderr).toMatch(/POST \/quote-requests\/:id\/reopen/);
      expect(result.stderr).toMatch(/PATCH \/quote-requests\/:id\/reopen/);
    });

    // Endpoints ficticios: /mail-logs, /audit-logs, /quote-comparisons.
    it('detecta endpoint ficticio na fixture', () => {
      const fixture = readFixture();
      fixture.backendRoutes = [
        ...fixture.backendRoutes,
        'GET /mail-logs',
        'GET /audit-logs',
        'POST /quote-comparisons',
      ];
      writeFixture(fixture);

      const result = runScript();
      expect(isFailure(result)).toBe(true);
      expect(result.stderr).toMatch(/na fixture mas NAO no codigo/);
      expect(result.stderr).toMatch(/GET \/mail-logs/);
      expect(result.stderr).toMatch(/Endpoints\.md/);
    });

    // Services: vault dizia 9, sao 12 (faltavam os 3 do Supplier Portal).
    it('detecta service novo ausente da fixture', () => {
      const fixture = readFixture();
      fixture.backend.services = fixture.backend.services.filter(
        (s: string) => s !== 'SupplierPortalReminderService.ts'
      );
      writeFixture(fixture);

      const result = runScript();
      expect(isFailure(result)).toBe(true);
      expect(result.stderr).toMatch(/src\/services diverge/);
      expect(result.stderr).toMatch(/SupplierPortalReminderService\.ts/);
    });

    it('detecta dependencia-fantasma (citada na vault, nao instalada)', () => {
      const fixture = readFixture();
      fixture.declaredDependencies = [
        ...fixture.declaredDependencies,
        'lucide-react',
        'moment',
      ];
      writeFixture(fixture);

      const result = runScript();
      expect(isFailure(result)).toBe(true);
      expect(result.stderr).toMatch(/dependencias-fantasma/);
      expect(result.stderr).toMatch(/lucide-react, moment/);
      expect(result.stderr).toMatch(/Stack\.md/);
    });

    // O IntelliQuote tem DOIS package.json (raiz = backend, web/ = frontend).
    // `date-fns`, `@tanstack/react-query` e `react-router-dom` vivem so' no do
    // web — o check tem que enxergar os dois, senao acusa fantasma que existe.
    // (Foi o falso positivo que a 1a versao deste check produziu.)
    it('reconhece deps que existem apenas no web/package.json', () => {
      const result = runScript();
      expect(isFailure(result)).toBe(false);
      expect(result.stdout).toMatch(/declaredDependencies = 13 \(todas instaladas\)/);
    });

    // Inverte o check: se um arquivo que a vault marca como "nao existe"
    // ressuscitar, a nota de correcao no vault fica errada.
    it('detecta arquivo de mustNotExist que voltou a existir', () => {
      const fixture = readFixture();
      // package.json existe — simula a ressurreicao sem criar arquivo.
      fixture.mustNotExist = [...fixture.mustNotExist, 'package.json'];
      writeFixture(fixture);

      const result = runScript();
      expect(isFailure(result)).toBe(true);
      expect(result.stderr).toMatch(/VOLTARAM a existir: package\.json/);
    });

    it('volta a passar depois de restaurar a fixture', () => {
      const fixture = readFixture();
      fixture.prisma.migrations = 999;
      writeFixture(fixture);
      expect(isFailure(runScript())).toBe(true);

      writeFixture(original);
      expect(isFailure(runScript())).toBe(false);
    });
  });

  // Checks que leem o vault de verdade. Opcionais: pulados quando a pasta nao
  // e' encontrada, para o CI seguir hermetico.
  describe('checks de vault (opcionais)', () => {
    let original: Fixture;

    beforeEach(() => {
      original = readFixture();
    });

    afterEach(() => {
      try {
        writeFixture(original);
      } catch {
        // ignora
      }
    });

    function runWithEnv(env: Record<string, string>) {
      return spawnSync(process.execPath, [SCRIPT], {
        cwd: ROOT,
        encoding: 'utf8',
        env: { ...process.env, ...env },
      });
    }

    it('pula com SKIP_VAULT_CHECK=1 e continua verde', () => {
      const result = runWithEnv({ SKIP_VAULT_CHECK: '1' });
      expect(isFailure(result)).toBe(false);
      expect(result.stdout).toMatch(/checks de vault PULADOS/);
      expect(result.stdout).toMatch(/17 checks, 0 mismatches/);
    });

    it('pula (sem falhar) quando VAULT_DIR nao existe', () => {
      const result = runWithEnv({ VAULT_DIR: path.join(ROOT, 'nao-existe-xyz') });
      expect(isFailure(result)).toBe(false);
      expect(result.stdout).toMatch(/checks de vault PULADOS/);
    });

    it('com a vault presente, roda 19 checks e valida mencoes', () => {
      const result = runScript();
      if (/checks de vault PULADOS/.test(result.stdout ?? '')) return;
      expect(isFailure(result)).toBe(false);
      expect(result.stdout).toMatch(/19 checks, 0 mismatches/);
      expect(result.stdout).toMatch(/vault menciona todos os \d+ identificadores/);
      expect(result.stdout).toMatch(/vault sem mencao ativa aos \d+ fantasmas/);
    });

    it('acusa identificador exigido que a vault nao menciona', () => {
      const probe = runScript();
      if (/checks de vault PULADOS/.test(probe.stdout ?? '')) return;

      const fixture = readFixture();
      fixture.vaultMustMention = [...fixture.vaultMustMention, 'servicoQueNinguemDocumentou'];
      writeFixture(fixture);

      const result = runScript();
      expect(isFailure(result)).toBe(true);
      expect(result.stderr).toMatch(/vault NAO menciona em lugar nenhum/);
      expect(result.stderr).toMatch(/servicoQueNinguemDocumentou/);
    });

    // Foi este check que pegou o 3o arquivo com `/audit-logs` (Auditoria.md),
    // depois de eu ja' ter corrigido Endpoints.md — mencao ativa a fantasma.
    it('acusa fantasma descrito como real, e aceita mencao negada/historica', () => {
      const probe = runScript();
      if (/checks de vault PULADOS/.test(probe.stdout ?? '')) return;

      const fixture = readFixture();
      // 'GET' aparece em linhas de endpoint reais sem negacao → deve acusar.
      fixture.vaultMustNotMention = [...fixture.vaultMustNotMention, 'GET    /audit'];
      writeFixture(fixture);

      const result = runScript();
      expect(isFailure(result)).toBe(true);
      expect(result.stderr).toMatch(/FANTASMA/);
    });
  });
});
