import { afterEach, describe, expect, it, vi } from 'vitest';
import { parsePipedriveEnv } from '../src/config/env';

// Valores FICTICIOS (repositorio publico): token inventado, ids 9xxx e chaves de campo de teste.
const TOKEN_NAME = 'PIPEDRIVE_API' + '_TOKEN';
const VALID: Record<string, string> = {
  [TOKEN_NAME]: 'tok-exemplo-0000-aaaa',
  PIPEDRIVE_DOMAIN: 'exemplo',
  PIPEDRIVE_PIPELINE_ID: '9010',
  PIPEDRIVE_STAGE_ID: '9020',
  PIPEDRIVE_STAGE_NAME: 'Proposta Exemplo a Enviar',
  PIPEDRIVE_ORG_CNPJ_FIELD_KEY: '0123456789abcdef0123456789abcdef01234567',
  PIPEDRIVE_DEAL_TYPE_FIELD_KEY: 'abcdef0123456789abcdef0123456789abcdef01',
  PIPEDRIVE_COMEX_USER_ID: '900302',
  PIPEDRIVE_SYNC_SINCE: '2026-11-01',
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('pipedriveEnv', () => {
  it('sem nenhuma env: nao configurado e sem erro (ambiente local/teste)', () => {
    const parsed = parsePipedriveEnv({});
    expect(parsed.configured).toBe(false);
    expect(parsed.configErrors).toEqual([]);
  });

  it('todas as envs validas: configurado, com trim e tipos numericos', () => {
    const parsed = parsePipedriveEnv({ ...VALID, PIPEDRIVE_DOMAIN: '  exemplo  ', PIPEDRIVE_STAGE_NAME: ' Proposta Exemplo a Enviar ' });
    expect(parsed).toMatchObject({
      configured: true,
      configErrors: [],
      domain: 'exemplo',
      pipelineId: 9010,
      stageId: 9020,
      stageName: 'Proposta Exemplo a Enviar',
      orgCnpjFieldKey: VALID.PIPEDRIVE_ORG_CNPJ_FIELD_KEY,
      dealTypeFieldKey: VALID.PIPEDRIVE_DEAL_TYPE_FIELD_KEY,
      comexUserId: 900302,
      syncSince: '2026-11-01',
    });
    expect(parsed.apiToken).toBe(VALID[TOKEN_NAME]);
  });

  it('so as opcionais podem faltar', () => {
    const { PIPEDRIVE_DEAL_TYPE_FIELD_KEY: _a, PIPEDRIVE_COMEX_USER_ID: _b, PIPEDRIVE_SYNC_SINCE: _c, ...required } = VALID;
    const parsed = parsePipedriveEnv(required);
    expect(parsed.configured).toBe(true);
    expect(parsed.dealTypeFieldKey).toBeUndefined();
    expect(parsed.comexUserId).toBeUndefined();
    expect(parsed.syncSince).toBeUndefined();
  });

  it('com outras definidas, a obrigatoria ausente vira erro (so o nome) e desliga a integracao', () => {
    const { PIPEDRIVE_STAGE_ID: _omitted, ...rest } = VALID;
    const parsed = parsePipedriveEnv(rest);
    expect(parsed.configured).toBe(false);
    expect(parsed.configErrors).toEqual(['PIPEDRIVE_STAGE_ID']);
  });

  const invalid: Array<[string, string]> = [
    [TOKEN_NAME, 'tem espaco'],
    ['PIPEDRIVE_DOMAIN', 'Exemplo.pipedrive.com'],
    ['PIPEDRIVE_DOMAIN', 'a'.repeat(64)],
    ['PIPEDRIVE_PIPELINE_ID', 'abc'],
    ['PIPEDRIVE_PIPELINE_ID', '0'],
    ['PIPEDRIVE_STAGE_ID', '-4'],
    ['PIPEDRIVE_STAGE_NAME', 'x'.repeat(201)],
    ['PIPEDRIVE_ORG_CNPJ_FIELD_KEY', 'XYZ'],
    ['PIPEDRIVE_ORG_CNPJ_FIELD_KEY', '0123456789ABCDEF0123456789ABCDEF01234567'],
    ['PIPEDRIVE_DEAL_TYPE_FIELD_KEY', 'curta'],
    ['PIPEDRIVE_COMEX_USER_ID', 'usuario'],
    ['PIPEDRIVE_SYNC_SINCE', '2026-02-30'],
    ['PIPEDRIVE_SYNC_SINCE', '01/11/2026'],
  ];
  it.each(invalid)('%s com formato invalido (%s) desliga a integracao e lista so o nome da env', (name, value) => {
    const parsed = parsePipedriveEnv({ ...VALID, [name]: value });
    expect(parsed.configured).toBe(false);
    expect(parsed.configErrors).toEqual([name]);
    expect(JSON.stringify(parsed.configErrors)).not.toContain(value);
  });

  it('formato invalido nao derruba o boot: importa, loga uma vez so nomes e nao chama o Pipedrive', async () => {
    const secret = 'tok-segredo-de-teste-9999';
    vi.stubEnv(TOKEN_NAME, secret);
    vi.stubEnv('PIPEDRIVE_DOMAIN', 'Dominio Invalido');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    vi.resetModules();

    const { pipedriveEnv } = await import('../src/config/env');
    expect(pipedriveEnv.configured).toBe(false);
    expect(pipedriveEnv.configErrors).toContain('PIPEDRIVE_DOMAIN');
    expect(fetchSpy).not.toHaveBeenCalled();

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const line = String(errorSpy.mock.calls[0]?.[0]);
    expect(line).toContain('PIPEDRIVE_DOMAIN');
    expect(line).not.toContain(secret);
    expect(line).not.toContain('Dominio Invalido');
  });
});
