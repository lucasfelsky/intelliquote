// Guarda estatica do wiring de deploy da integracao Pipedrive (IQ Indent, PR 5c).
//
// Le o workflow do deploy do backend, deploy-cloudrun.ps1, deploy-secrets.yaml e deploy-env-vars.yaml e confere:
// (1) os 3 segredos do Secret Manager nos 3 pontos de referencia; (2) as 4 envs que identificam campos/usuario do CRM
// entram SO por `secrets.*` (o log de Actions de repo publico mostra `vars.*` em claro) e nunca com valor no repo;
// (3) nenhum hex de 40 caracteres nem id numerico real em arquivo versionado; (4) o smoke do deploy nao depende do
// Pipedrive. Nao executa nada: so leitura de texto.

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const PROGRAMA = path.resolve(__dirname, '..');
const REPO = path.resolve(PROGRAMA, '..');

function read(...segments: string[]): string {
  return fs.readFileSync(path.join(...segments), 'utf8').replace(/\r\n/g, '\n');
}

const workflow = read(REPO, '.github', 'workflows', 'deploy-intelliquote-api.yml');
const ps1 = read(PROGRAMA, 'deploy-cloudrun.ps1');
const secretsYaml = read(PROGRAMA, 'deploy-secrets.yaml');
const envYaml = read(PROGRAMA, 'deploy-env-vars.yaml');
const runbook = read(PROGRAMA, 'docs', 'OPERATIONS_RUNBOOK.md');

const PIPEDRIVE_SECRETS = ['PIPEDRIVE_API_TOKEN', 'PIPEDRIVE_WEBHOOK_USER', 'PIPEDRIVE_WEBHOOK_PASSWORD'];
const EXISTING_SECRETS = [
  'SMTP_PASS',
  'SMTP_HOST',
  'SMTP_USER',
  'SMTP_PORT',
  'SMTP_FROM',
  'DATABASE_URL',
  'DIRECT_URL',
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
];
const SECRETS_YAML_EXISTING = ['SMTP_PASS', 'DATABASE_URL', 'DIRECT_URL', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'];
const SENSITIVE_ENVS = [
  'PIPEDRIVE_ORG_CNPJ_FIELD_KEY',
  'PIPEDRIVE_DEAL_TYPE_FIELD_KEY',
  'PIPEDRIVE_COMEX_USER_ID',
  'PIPEDRIVE_SYNC_SINCE',
];

function section(text: string, from: string, to?: string): string {
  const start = text.indexOf(from);
  expect(start, `trecho "${from}" ausente`).toBeGreaterThanOrEqual(0);
  const end = to === undefined ? text.length : text.indexOf(to, start + from.length);
  expect(end, `trecho "${to}" ausente`).toBeGreaterThan(start);
  return text.slice(start, end);
}

const deployStep = section(workflow, '- name: Deploy no Cloud Run', '- name: Smoke test');
const deployEnvBlock = section(deployStep, '        env:\n', '        run: |');
const smokeStep = section(workflow, '- name: Smoke test');

describe('deploy wiring - segredos referenciados', () => {
  it.each([...PIPEDRIVE_SECRETS, ...EXISTING_SECRETS])('%s em SECRET_REFS, no --set-secrets do ps1 e em deploy-secrets.yaml', (name) => {
    expect(workflow).toMatch(new RegExp(`SECRET_REFS="\\$\\{SECRET_REFS\\},${name}=${name}:latest"|SECRET_REFS="${name}=${name}:latest"`));

    const setSecretsLine = ps1.split('\n').find((line) => line.includes('--set-secrets'));
    expect(setSecretsLine, '--set-secrets ausente no ps1').toBeDefined();
    const refs = /--set-secrets\s+"([^"]+)"/.exec(setSecretsLine ?? '')?.[1].split(',') ?? [];
    expect(refs).toContain(`${name}=${name}:latest`);
    for (const ref of refs) expect(ref).toMatch(/^([A-Z0-9_]+)=\1:latest$/);

    // deploy-secrets.yaml sempre listou so 5 dos segredos antigos (sem SMTP_HOST/USER/PORT/FROM): nao exigir o que nunca teve.
    if (PIPEDRIVE_SECRETS.includes(name) || SECRETS_YAML_EXISTING.includes(name)) {
      expect(secretsYaml).toMatch(new RegExp(`^${name}: ${name}:latest$`, 'm'));
    }
  });

  it('o --set-secrets do workflow usa SECRET_REFS e nenhum segredo vira env em claro', () => {
    expect(deployStep).toContain('--set-secrets="${SECRET_REFS}"');
    for (const name of PIPEDRIVE_SECRETS) {
      expect(envYaml).not.toMatch(new RegExp(`^${name}\\s*:`, 'm'));
    }
  });
});

describe('deploy wiring - envs sensiveis do CRM', () => {
  it.each(SENSITIVE_ENVS)('%s entra no passo de deploy so por secrets.* (nunca vars.*)', (name) => {
    const lines = deployEnvBlock.split('\n').map((line) => line.trim());
    expect(lines).toContain(`${name}: \${{ secrets.${name} }}`);
    expect(workflow).not.toContain(`vars.${name}`);
    expect(workflow).not.toMatch(new RegExp(`${name}:\\s*["']?[0-9a-fA-F-]{4,}`));
  });

  it('o bloco env do passo so tem as 4 envs, todas por secrets.*, e elas nao aparecem em outro passo', () => {
    const entries = deployEnvBlock
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '' && line !== 'env:');
    expect(entries).toHaveLength(SENSITIVE_ENVS.length);
    for (const entry of entries) expect(entry).toMatch(/^[A-Z_]+: \$\{\{ secrets\.[A-Z_]+ \}\}$/);

    expect(workflow.match(/secrets\.PIPEDRIVE_/g)).toHaveLength(SENSITIVE_ENVS.length);
    const outsideDeployStep = workflow
      .replace(deployStep, '')
      .split(/\r?\n/)
      .filter((line) => !line.trim().startsWith('#'))
      .join(' ');
    expect(outsideDeployStep).not.toMatch(/PIPEDRIVE_(ORG_CNPJ|DEAL_TYPE|COMEX_USER|SYNC_SINCE)/);
  });

  it('append_pipedrive_env vem depois do cat do arquivo de envs e nunca imprime o valor', () => {
    const catIndex = deployStep.indexOf('cat "${ENV_VARS_FILE}"');
    expect(catIndex).toBeGreaterThanOrEqual(0);
    const fnStart = deployStep.indexOf('append_pipedrive_env() {');
    expect(fnStart).toBeGreaterThan(catIndex);

    const fnBody = section(deployStep, 'append_pipedrive_env() {', '\n          }\n');
    expect(fnBody).not.toMatch(/echo[^\n]*\$\{value\}/);
    // um warning para formato invalido e outro para chave duplicada (so com o nome, nunca o valor)
    expect(fnBody.match(/::warning::/g)).toHaveLength(2);
    expect(fnBody).toContain('grep -Eq "^${name}:" "${ENV_VARS_FILE}"');
    expect(fnBody).toContain('printf \'%s: "%s"\\n\' "${name}" "${value}" >> "${ENV_VARS_FILE}"');

    for (const name of SENSITIVE_ENVS) {
      const call = new RegExp(`^ {10}append_pipedrive_env ${name} '([^']+)'$`, 'm').exec(deployStep);
      expect(call, `chamada de append_pipedrive_env para ${name} ausente`).not.toBeNull();
      expect(deployStep.indexOf(call?.[0] ?? '')).toBeGreaterThan(fnStart);
    }
  });

  it('o formato aceito pelo workflow nao e mais frouxo que o do app', () => {
    const patternOf = (name: string): RegExp => {
      const match = new RegExp(`append_pipedrive_env ${name} '([^']+)'`).exec(deployStep);
      expect(match).not.toBeNull();
      return new RegExp(match?.[1] ?? '$^');
    };
    const hex = patternOf('PIPEDRIVE_ORG_CNPJ_FIELD_KEY');
    expect(hex.test('a'.repeat(40))).toBe(true);
    expect(hex.test('a'.repeat(39))).toBe(false);
    expect(hex.test('A'.repeat(40))).toBe(false);
    expect(patternOf('PIPEDRIVE_DEAL_TYPE_FIELD_KEY').test('z'.repeat(40))).toBe(false);

    const userId = patternOf('PIPEDRIVE_COMEX_USER_ID');
    expect(userId.test('7')).toBe(true);
    expect(userId.test('123456789')).toBe(true);
    for (const bad of ['0', '', '1234567890', '12a', '007', '-1']) expect(userId.test(bad)).toBe(false);

    const since = patternOf('PIPEDRIVE_SYNC_SINCE');
    expect(since.test('2026-11-01')).toBe(true);
    expect(since.test('2026-12-31')).toBe(true);
    for (const bad of ['2026-13-45', '2026-00-10', '2026-11-00', '2026-11-32', '2026-1-1', '26-11-01', '2026-11-01x']) {
      expect(since.test(bad)).toBe(false);
    }
  });

  it('nenhum passo imprime o ambiente inteiro (set -x, printenv)', () => {
    expect(workflow).not.toMatch(/set -[a-z]*x/);
    expect(workflow).not.toContain('printenv');
  });
});

describe('deploy wiring - repo publico sem dados reais', () => {
  it('deploy-env-vars.yaml: sem as 4 envs sensiveis nem segredos, com funil/coluna e valores string', () => {
    for (const name of [...SENSITIVE_ENVS, ...PIPEDRIVE_SECRETS]) {
      expect(envYaml).not.toMatch(new RegExp(`^${name}\\s*:`, 'm'));
    }
    expect(envYaml).toMatch(/^PIPEDRIVE_DOMAIN: "[a-z0-9-]+"$/m);
    expect(envYaml).toMatch(/^PIPEDRIVE_PIPELINE_ID: "10"$/m);
    expect(envYaml).toMatch(/^PIPEDRIVE_STAGE_ID: "149"$/m);
    expect(envYaml).toMatch(/^PIPEDRIVE_STAGE_NAME: ".+"$/m);
    for (const line of envYaml.split('\n').filter((entry) => /^PIPEDRIVE_[A-Z_]+:/.test(entry))) {
      expect(line).toMatch(/^PIPEDRIVE_[A-Z_]+: "[^"]*"$/);
    }
  });

  it.each([
    ['workflow', workflow],
    ['deploy-env-vars.yaml', envYaml],
    ['deploy-secrets.yaml', secretsYaml],
    ['deploy-cloudrun.ps1', ps1],
    ['OPERATIONS_RUNBOOK.md', runbook],
  ])('%s: sem hex de 40 caracteres nem id numerico atribuido a env do Pipedrive', (_label, text) => {
    expect(text).not.toMatch(/\b[0-9a-f]{40}\b/i);
    expect(text).not.toMatch(/PIPEDRIVE_[A-Z_]+["']?\s*[:=]\s*["']?\d{5,}/);
    expect(text).not.toMatch(/--body\s+["']?\d{5,}/);
    expect(text).not.toMatch(/PIPEDRIVE_API_TOKEN:\s*"[^"]{8,}"|PASSWORD:\s*"[^"]+"/);
  });

  it('o smoke test do deploy nao referencia o Pipedrive', () => {
    expect(smokeStep).not.toMatch(/pipedrive/i);
    expect(smokeStep).toContain('/health/ready');
    expect(smokeStep).toContain('buildTag');
  });
});
