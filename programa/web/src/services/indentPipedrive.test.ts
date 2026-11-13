import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn(), patch: vi.fn() },
}));

import { api } from '@/api/client';
import {
  createIndentPendingOrgClient,
  getIndentPipedriveOptions,
  getIndentPipedriveStatus,
  linkIndentPendingOrg,
  listIndentPendingOrgs,
  saveIndentPipedriveConfig,
  syncIndentPipedrive,
} from './indentPipedrive';

const PREFIXO = '/api/v1/indent/';

function urls(): string[] {
  return [api.get, api.post, api.put, api.patch, api.del].flatMap((fn) => vi.mocked(fn).mock.calls.map((call) => String(call[0])));
}

beforeEach(() => {
  vi.mocked(api.get).mockReset().mockResolvedValue({});
  vi.mocked(api.post).mockReset().mockResolvedValue({});
  vi.mocked(api.put).mockReset().mockResolvedValue({});
  vi.mocked(api.patch).mockReset();
  vi.mocked(api.del).mockReset();
});

describe('services/indentPipedrive', () => {
  it('TODAS as URLs comecam por /api/v1/indent/ (caminho completo, nunca /v1 solto)', async () => {
    await getIndentPipedriveStatus();
    await getIndentPipedriveOptions();
    await saveIndentPipedriveConfig({ pipelineId: 900001, stageId: 900002 });
    await syncIndentPipedrive();
    await listIndentPendingOrgs();
    await createIndentPendingOrgClient(5, { orgId: 900003 });
    await linkIndentPendingOrg(5, { orgId: 900003, clientId: 7 });
    const todas = urls();
    expect(todas).toHaveLength(7);
    for (const url of todas) expect(url.startsWith(PREFIXO), url).toBe(true);
  });

  it('metodos e caminhos: status/options/pending-orgs por GET; config por PUT; sync, create-client e link por POST', async () => {
    await getIndentPipedriveStatus();
    expect(api.get).toHaveBeenLastCalledWith('/api/v1/indent/pipedrive/status');
    await listIndentPendingOrgs();
    expect(api.get).toHaveBeenLastCalledWith('/api/v1/indent/pending-orgs');
    await saveIndentPipedriveConfig({ pipelineId: 900001, stageId: 900002, slaBusinessDays: 3 });
    expect(api.put).toHaveBeenLastCalledWith('/api/v1/indent/pipedrive/config', { pipelineId: 900001, stageId: 900002, slaBusinessDays: 3 });
    await syncIndentPipedrive();
    expect(api.post).toHaveBeenLastCalledWith('/api/v1/indent/pipedrive/sync');
    await createIndentPendingOrgClient(5, { orgId: 900003, name: 'Cliente Exemplo Ltda', cnpj: '11222333000181', city: 'Itajaí' });
    expect(api.post).toHaveBeenLastCalledWith('/api/v1/indent/pending-orgs/5/create-client', {
      orgId: 900003,
      name: 'Cliente Exemplo Ltda',
      cnpj: '11222333000181',
      city: 'Itajaí',
    });
    await linkIndentPendingOrg(5, { orgId: 900003, clientId: 7 });
    expect(api.post).toHaveBeenLastCalledWith('/api/v1/indent/pending-orgs/5/link', { orgId: 900003, clientId: 7 });
  });

  it('options: o funil escolhido vai em query (pipelineId); sem funil a query vai vazia de valor', async () => {
    await getIndentPipedriveOptions(900001);
    expect(api.get).toHaveBeenLastCalledWith('/api/v1/indent/pipedrive/options', { pipelineId: 900001 });
    await getIndentPipedriveOptions();
    expect(api.get).toHaveBeenLastCalledWith('/api/v1/indent/pipedrive/options', { pipelineId: undefined });
  });

  it('nada escreve no Pipedrive nem usa DELETE/PATCH: so existem GET, PUT e POST do IQ', async () => {
    await getIndentPipedriveStatus();
    await syncIndentPipedrive();
    await linkIndentPendingOrg(5, { clientId: 7 });
    expect(api.del).not.toHaveBeenCalled();
    expect(api.patch).not.toHaveBeenCalled();
    expect(urls().some((url) => /pipedrive\.com/.test(url))).toBe(false);
  });

  it('devolve o corpo da API sem transformar', async () => {
    const corpo = { client: { id: 7, name: 'Cliente Exemplo Ltda', cnpj: null, city: null, pipedriveOrgId: 900003 }, cnpjCompleted: false, cnpjDivergente: true, resolved: [{ id: 5, requestId: 11 }] };
    vi.mocked(api.post).mockResolvedValueOnce(corpo);
    await expect(linkIndentPendingOrg(5, { orgId: 900003, clientId: 7 })).resolves.toEqual(corpo);
  });
});
