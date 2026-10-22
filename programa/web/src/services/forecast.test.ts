import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() },
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

import { api, ApiError } from '@/api/client';
import {
  confirmForecastDbcorp,
  confirmForecastWorkbook,
  forecastErrorMessage,
  forecastImportErrorMessage,
  forecastKeys,
  ForecastLocalError,
  getForecastRelatorioCompras,
  getForecastSnapshot,
  listForecastSnapshots,
  previewForecastDbcorp,
  previewForecastWorkbook,
} from './forecast';

const get = vi.mocked(api.get);
const post = vi.mocked(api.post);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('servico do Forecast', () => {
  it('lista as quinzenas por /v1/forecast/snapshots e desembrulha { data }', async () => {
    get.mockResolvedValue({ data: [{ id: 1, label: '10-2' }] });
    await expect(listForecastSnapshots()).resolves.toEqual([{ id: 1, label: '10-2' }]);
    expect(get).toHaveBeenCalledWith('/v1/forecast/snapshots');
  });

  it('pede o detalhe por id', async () => {
    get.mockResolvedValue({ data: { id: 7, linhas: [] } });
    await expect(getForecastSnapshot(7)).resolves.toEqual({ id: 7, linhas: [] });
    expect(get).toHaveBeenCalledWith('/v1/forecast/snapshots/7');
  });

  it('pede o relatorio de compras da quinzena e desembrulha { data }', async () => {
    get.mockResolvedValue({ data: { grupos: [] } });
    await expect(getForecastRelatorioCompras(7)).resolves.toEqual({ grupos: [] });
    expect(get).toHaveBeenCalledWith('/v1/forecast/snapshots/7/relatorio-compras');
  });

  it('chaves de cache', () => {
    expect(forecastKeys.snapshots).toEqual(['forecast', 'snapshots']);
    expect(forecastKeys.snapshot(7)).toEqual(['forecast', 'snapshot', 7]);
  });

  it('a chave do relatorio fica sob ["forecast"] (a invalidacao pos-importacao a cobre)', () => {
    expect(forecastKeys.relatorio(7)).toEqual(['forecast', 'relatorio', 7]);
  });
});

describe('forecastErrorMessage', () => {
  it('401, 403 e 404 tem texto proprio', () => {
    expect(forecastErrorMessage(new ApiError(401, null))).toBe('Sua sessão expirou. Entre de novo.');
    expect(forecastErrorMessage(new ApiError(403, null))).toBe('Seu perfil não tem acesso ao Forecast.');
    expect(forecastErrorMessage(new ApiError(404, null))).toBe('Quinzena não encontrada (pode ter sido removida).');
  });

  it.each([400, 409, 413])('%s repassa a mensagem do backend', (status) => {
    expect(forecastErrorMessage(new ApiError(status, { message: 'Mensagem do servidor.' }))).toBe('Mensagem do servidor.');
  });

  it('400/409/413 sem mensagem usam o texto de recusa', () => {
    expect(forecastErrorMessage(new ApiError(409, null))).toBe('Pedido recusado pelo servidor (HTTP 409).');
  });

  it('outros status e erro de rede', () => {
    expect(forecastErrorMessage(new ApiError(500, { message: 'detalhe interno' }))).toBe(
      'Não foi possível carregar o Forecast (HTTP 500).',
    );
    expect(forecastErrorMessage(new TypeError('Failed to fetch'))).toBe('Sem conexão com o servidor. Tente de novo.');
  });
});

describe('importacao da quinzena', () => {
  const arquivo = { fileName: 'teste.xlsx', contentBase64: 'AQID' };
  const corpoPlanilha = { contentBase64: 'AQID', fileName: 'p.xlsx', label: '12-2', baseDate: '2026-12-15' };
  const corpoDbcorp = {
    label: '12-2',
    baseDate: '2026-12-15',
    files: { saldo: arquivo, vendasMes: arquivo, vendasAtual: arquivo, vendasAnual: arquivo, programacao: arquivo, fup: arquivo },
  };

  it('preview da planilha: path e corpo exatos, desembrulha { data }', async () => {
    post.mockResolvedValue({ data: { label: '12-2' } });
    await expect(previewForecastWorkbook(corpoPlanilha)).resolves.toEqual({ label: '12-2' });
    expect(post).toHaveBeenCalledWith('/v1/forecast/import/workbook/preview', corpoPlanilha);
  });

  it('confirm da planilha: mesmo corpo + options', async () => {
    const options = { atualizarCadastro: true, gravarHistorico: false, criarQuinzena: true };
    post.mockResolvedValue({ data: { snapshotId: 9 } });
    await expect(confirmForecastWorkbook(corpoPlanilha, options)).resolves.toEqual({ snapshotId: 9 });
    expect(post).toHaveBeenCalledWith('/v1/forecast/import/workbook/confirm', { ...corpoPlanilha, options });
  });

  it('preview e confirm do DBCorp: o corpo do confirm e identico ao do preview', async () => {
    post.mockResolvedValue({ data: { snapshotId: 99 } });
    await previewForecastDbcorp(corpoDbcorp);
    await expect(confirmForecastDbcorp(corpoDbcorp)).resolves.toEqual({ snapshotId: 99 });
    expect(post).toHaveBeenNthCalledWith(1, '/v1/forecast/import/dbcorp/preview', corpoDbcorp);
    expect(post).toHaveBeenNthCalledWith(2, '/v1/forecast/import/dbcorp/confirm', corpoDbcorp);
  });
});

describe('forecastImportErrorMessage', () => {
  const msg = (err: unknown) => forecastImportErrorMessage(err, '12-2');

  it('401, 403 e 404 falam de importacao', () => {
    expect(msg(new ApiError(401, null))).toBe('Sua sessão expirou. Entre de novo.');
    expect(msg(new ApiError(403, null))).toBe('Só administradores e compradores podem importar quinzenas.');
    expect(msg(new ApiError(404, null))).toBe(
      'O servidor ainda não tem esta importação. Aguarde a atualização do sistema.',
    );
  });

  it('409 cita o rotulo e 413 tem texto fixo (mesmo com corpo)', () => {
    expect(msg(new ApiError(409, { message: 'Quinzena 12-2 ja existe.' }))).toBe(
      'Já existe a quinzena 12-2. Nada foi gravado.',
    );
    expect(msg(new ApiError(413, { message: 'texto do proxy' }))).toBe(
      'O envio passa do limite de 10 MB (somando todos os arquivos). Nada foi gravado.',
    );
  });

  it('400 repassa a mensagem do backend; sem mensagem usa o texto de recusa', () => {
    expect(msg(new ApiError(400, { message: 'Rotulo da quinzena invalido.' }))).toBe('Rotulo da quinzena invalido.');
    expect(msg(new ApiError(400, null))).toBe('Pedido recusado pelo servidor (HTTP 400).');
  });

  it.each([502, 503, 504])('%s avisa que a importacao pode ter sido concluida', (status) => {
    expect(msg(new ApiError(status, null))).toBe(
      'O servidor demorou para responder. Confira a lista de quinzenas antes de tentar de novo: a importação pode ter sido concluída.',
    );
  });

  it('outros status, rede e falha local', () => {
    expect(msg(new ApiError(500, { message: 'detalhe interno' }))).toBe(
      'Não foi possível concluir a importação (HTTP 500).',
    );
    expect(msg(new TypeError('Failed to fetch'))).toBe('Sem conexão com o servidor. Tente de novo.');
    expect(msg(new ForecastLocalError('Não foi possível ler o arquivo a.xlsx.'))).toBe(
      'Não foi possível ler o arquivo a.xlsx.',
    );
  });
});
