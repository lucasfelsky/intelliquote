import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ForecastEmbalagensModal from './ForecastEmbalagensModal';
import type { ForecastEmbalagens } from '@/services/forecastEmbalagens';

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

import { api, ApiError } from '@/api/client';

const get = vi.mocked(api.get);
const patch = vi.mocked(api.patch);

// Dados 100% sinteticos.
function dados(over: Partial<ForecastEmbalagens> = {}): ForecastEmbalagens {
  return {
    produto: { id: 5, nome: 'PRODUTO 001', ativo: true, embalagemPlanilha: null, naoFraciona: false },
    codigos: [
      { id: 11, posicao: 1, codigo: 'C0001', quantidadeKg: 25, rotulo: 'Saco', principal: false, origem: 'manual', atualizadoEm: '2026-10-22' },
      { id: 12, posicao: 2, codigo: 'C0002', quantidadeKg: null, rotulo: null, principal: false, origem: null, atualizadoEm: null },
      { id: 13, posicao: 3, codigo: 'C0003', quantidadeKg: 200, rotulo: null, principal: true, origem: 'dbcorp', atualizadoEm: '2026-10-21' },
    ],
    usadaCodigoId: 13,
    ...over,
  };
}

let atual: ForecastEmbalagens;
let client: QueryClient;
const onFechar = vi.fn();

function renderModal(podeEditar: boolean) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ForecastEmbalagensModal productId={5} podeEditar={podeEditar} onFechar={onFechar} />
    </QueryClientProvider>,
  );
}

const qtd = (codigo: string) => screen.getByLabelText(`Quantidade em kg do código ${codigo}`) as HTMLInputElement;
const salvar = () => screen.getByRole('button', { name: /Salvar embalagens|Salvando/ }) as HTMLButtonElement;

beforeEach(() => {
  vi.clearAllMocks();
  atual = dados();
  get.mockImplementation(async () => ({ data: atual }));
});

describe('ForecastEmbalagensModal', () => {
  it('carrega por /v1/forecast/products/:id/embalagens e marca "Usada no relatório" na linha certa', async () => {
    renderModal(true);
    expect(await screen.findByText('PRODUTO 001')).toBeTruthy();
    expect(get).toHaveBeenCalledWith('/v1/forecast/products/5/embalagens');
    expect(screen.getByRole('heading', { name: 'Embalagens do item' })).toBeTruthy();
    const linhas = screen.getAllByRole('row').slice(1);
    expect(linhas).toHaveLength(3);
    expect(within(linhas[2] as HTMLElement).getByText('Usada no relatório')).toBeTruthy();
    expect(within(linhas[0] as HTMLElement).queryByText('Usada no relatório')).toBeNull();
    expect(screen.getAllByText('Usada no relatório')).toHaveLength(1);
    expect(screen.getByText(/Vale para todas as quinzenas: o relatório usa a embalagem do cadastro atual/)).toBeTruthy();
    expect(within(linhas[0] as HTMLElement).getByText('manual · 22/10/2026')).toBeTruthy();
    expect(within(linhas[2] as HTMLElement).getByText('DBCorp · 21/10/2026')).toBeTruthy();
    expect(within(linhas[1] as HTMLElement).getByText('EMB.2')).toBeTruthy();
  });

  it('mostra os selos do produto e a dica da planilha (coluna AW)', async () => {
    atual = dados({
      produto: { id: 5, nome: 'PRODUTO 001', ativo: false, embalagemPlanilha: 'Saco 25 kg', naoFraciona: true },
    });
    renderModal(true);
    await screen.findByText('PRODUTO 001');
    expect(screen.getByText('Não fraciona')).toBeTruthy();
    expect(screen.getByText('Produto inativo no cadastro')).toBeTruthy();
    expect(screen.getByText('Na planilha (coluna AW): Saco 25 kg')).toBeTruthy();
  });

  it('leitura (sem permissao): dados em texto, sem campos e so "Fechar"', async () => {
    renderModal(false);
    await screen.findByText('PRODUTO 001');
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(screen.getByText('25 kg')).toBeTruthy();
    expect(screen.getByText('200 kg')).toBeTruthy();
    expect(screen.getByText('Somente admin e comprador editam embalagens.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Salvar embalagens' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancelar' })).toBeNull();
    expect(screen.queryByText(/integração com o DBCorp estiver ativa/)).toBeNull();
    const fechar = screen.getAllByRole('button', { name: 'Fechar' });
    fireEvent.click(fechar[fechar.length - 1] as HTMLElement);
    expect(onFechar).toHaveBeenCalledTimes(1);
  });

  it('edicao: a dica do DBCorp aparece so no modo edicao', async () => {
    renderModal(true);
    await screen.findByText('PRODUTO 001');
    expect(
      screen.getByText('Valor editado manualmente pode ser substituído quando a integração com o DBCorp estiver ativa.'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeTruthy();
    expect(salvar().disabled).toBe(true);
  });

  it.each([
    ['0', 'A quantidade da embalagem deve ser maior que zero.'],
    ['25,1234', 'A quantidade da embalagem aceita no máximo 3 casas decimais.'],
    ['abc', 'Informe a quantidade em kg só com números (ex.: 25 ou 22,68).'],
  ])('quantidade "%s" mostra o erro no campo e desabilita Salvar', async (texto, erro) => {
    renderModal(true);
    await screen.findByText('PRODUTO 001');
    fireEvent.change(qtd('C0002'), { target: { value: texto } });
    const campo = qtd('C0002');
    expect(campo.getAttribute('aria-invalid')).toBe('true');
    const mensagem = screen.getByText(erro);
    expect(campo.getAttribute('aria-describedby')).toBe(mensagem.id);
    expect(salvar().disabled).toBe(true);
    fireEvent.change(campo, { target: { value: '10' } });
    expect(screen.queryByText(erro)).toBeNull();
    expect(salvar().disabled).toBe(false);
  });

  it('Salvar envia so o que mudou e confirma com o relatorio invalidado', async () => {
    const novo = dados({
      codigos: [
        dados().codigos[0] as ForecastEmbalagens['codigos'][number],
        dados().codigos[1] as ForecastEmbalagens['codigos'][number],
        { id: 13, posicao: 3, codigo: 'C0003', quantidadeKg: 22.68, rotulo: null, principal: true, origem: 'manual', atualizadoEm: '2026-10-22' },
      ],
    });
    patch.mockImplementation(async () => {
      atual = novo;
      return { data: novo };
    });
    const invalidate = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
    renderModal(true);
    await screen.findByText('PRODUTO 001');
    fireEvent.change(qtd('C0003'), { target: { value: '22,68' } });
    expect(salvar().disabled).toBe(false);
    fireEvent.click(salvar());

    expect(await screen.findByText('Embalagens salvas. O relatório foi atualizado.')).toBeTruthy();
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledWith('/v1/forecast/products/5/embalagens', {
      embalagens: [{ codigoId: 13, quantidadeKg: 22.68, rotulo: null }],
    });
    const chaves = invalidate.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey);
    expect(chaves).toContainEqual(['forecast', 'relatorio']);
    expect(chaves).toContainEqual(['forecast', 'embalagens']);
    expect(chaves.some((k) => k[1] === 'snapshot')).toBe(false);
    expect(qtd('C0003').value).toBe('22,68');
    expect(salvar().disabled).toBe(true);
    invalidate.mockRestore();
  });

  it('trocar a principal envia so principalCodigoId (e sem quantidade o radio fica desabilitado)', async () => {
    patch.mockResolvedValue({ data: atual });
    renderModal(true);
    await screen.findByText('PRODUTO 001');
    const radioC2 = screen.getByLabelText('Principal: código C0002') as HTMLInputElement;
    expect(radioC2.disabled).toBe(true); // sem quantidade nao pode ser principal
    fireEvent.click(screen.getByLabelText('Principal: código C0001'));
    fireEvent.click(salvar());
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch).toHaveBeenCalledWith('/v1/forecast/products/5/embalagens', { principalCodigoId: 11 });
  });

  it('esvaziar a quantidade da principal tira a principal (e envia as duas mudancas)', async () => {
    patch.mockResolvedValue({ data: atual });
    renderModal(true);
    await screen.findByText('PRODUTO 001');
    fireEvent.change(qtd('C0003'), { target: { value: '' } });
    expect((screen.getByLabelText('Principal: código C0003') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText(/Nenhuma \(usa o primeiro código\)/) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(salvar());
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch).toHaveBeenCalledWith('/v1/forecast/products/5/embalagens', {
      embalagens: [{ codigoId: 13, quantidadeKg: null, rotulo: null }],
      principalCodigoId: null,
    });
  });

  it('400 do backend aparece em role="alert" e mantem a edicao', async () => {
    patch.mockRejectedValue(new ApiError(400, { message: 'A embalagem principal precisa de quantidade.' }));
    renderModal(true);
    await screen.findByText('PRODUTO 001');
    fireEvent.change(qtd('C0001'), { target: { value: '30' } });
    fireEvent.click(salvar());
    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toBe('A embalagem principal precisa de quantidade.');
    expect(qtd('C0001').value).toBe('30');
    expect(screen.queryByText('Embalagens salvas. O relatório foi atualizado.')).toBeNull();
  });

  it('erro ao carregar mostra o alerta com a mensagem do status e "Fechar"', async () => {
    get.mockRejectedValue(new ApiError(404, { message: 'Produto nao encontrado.' }));
    renderModal(true);
    expect((await screen.findByRole('alert')).textContent).toBe('Produto não encontrado no cadastro do Forecast.');
    expect(screen.queryByRole('button', { name: 'Salvar embalagens' })).toBeNull();
  });

  it('o rotulo aceita ate 60 caracteres e o rotulo alterado vai no PATCH', async () => {
    patch.mockResolvedValue({ data: atual });
    renderModal(true);
    await screen.findByText('PRODUTO 001');
    const rotulo = screen.getByLabelText('Rótulo do código C0001') as HTMLInputElement;
    expect(rotulo.maxLength).toBe(60);
    fireEvent.change(rotulo, { target: { value: 'Saco 25 kg' } });
    fireEvent.click(salvar());
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch).toHaveBeenCalledWith('/v1/forecast/products/5/embalagens', {
      embalagens: [{ codigoId: 11, quantidadeKg: 25, rotulo: 'Saco 25 kg' }],
    });
  });
});
