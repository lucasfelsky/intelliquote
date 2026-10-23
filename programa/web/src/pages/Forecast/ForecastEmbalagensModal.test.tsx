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

describe('ForecastEmbalagensModal - pallet fechado (PR 6e)', () => {
  const pallet = (codigo: string) => screen.getByLabelText(`Pallet em kg do código ${codigo}`) as HTMLInputElement;

  beforeEach(() => {
    atual = dados({
      codigos: [
        { id: 11, posicao: 1, codigo: 'C0001', quantidadeKg: 25, palletKg: 600, rotulo: 'Saco', principal: false, origem: 'manual', atualizadoEm: '2026-10-22' },
        { id: 12, posicao: 2, codigo: 'C0002', quantidadeKg: null, palletKg: null, rotulo: null, principal: false, origem: null, atualizadoEm: null },
        { id: 13, posicao: 3, codigo: 'C0003', quantidadeKg: 200, palletKg: null, rotulo: null, principal: true, origem: 'dbcorp', atualizadoEm: '2026-10-21' },
      ],
    });
  });

  it('leitura: coluna "Pallet (kg)" com os kg ou traco (admin/comprador editam; os demais so leem)', async () => {
    renderModal(false);
    await screen.findByText('PRODUTO 001');
    expect(screen.getByRole('columnheader', { name: 'Pallet (kg)' })).toBeTruthy();
    const linhas = screen.getAllByRole('row').slice(1) as HTMLElement[];
    const celulas = linhas.map((l) => within(l).getAllByRole('cell').map((c) => c.textContent));
    // celulas: codigo, quantidade, pallet, rotulo, principal, origem
    expect(celulas[0]?.[2]).toBe('600 kg');
    expect(celulas[1]?.[2]).toBe('—');
    expect(celulas[2]?.[2]).toBe('—');
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
  });

  it('edicao: campo "Pallet (kg)" por codigo, preenchido, desabilitado sem quantidade, com a dica da regra', async () => {
    renderModal(true);
    await screen.findByText('PRODUTO 001');
    expect(screen.getByRole('columnheader', { name: 'Pallet (kg)' })).toBeTruthy();
    expect(pallet('C0001').value).toBe('600');
    expect(pallet('C0003').value).toBe('');
    expect(pallet('C0002').disabled).toBe(true); // sem quantidade
    expect(pallet('C0001').disabled).toBe(false);
    expect(screen.getByText(/É uma opção de compra informada pelo cadastro, não uma regra: pode não ser múltiplo da embalagem/)).toBeTruthy();
    expect(salvar().disabled).toBe(true);
  });

  it('digitar o pallet e Salvar envia so o pallet do codigo alterado', async () => {
    patch.mockResolvedValue({ data: atual });
    renderModal(true);
    await screen.findByText('PRODUTO 001');
    fireEvent.change(pallet('C0003'), { target: { value: '1.000' } });
    expect(salvar().disabled).toBe(false);
    fireEvent.click(salvar());
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch).toHaveBeenCalledWith('/v1/forecast/products/5/embalagens', {
      embalagens: [{ codigoId: 13, quantidadeKg: 200, rotulo: null, palletKg: 1000 }],
    });
  });

  it('apagar o pallet envia palletKg null; apagar a quantidade apaga o pallet junto', async () => {
    patch.mockResolvedValue({ data: atual });
    renderModal(true);
    await screen.findByText('PRODUTO 001');
    fireEvent.change(pallet('C0001'), { target: { value: '' } });
    fireEvent.click(salvar());
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch).toHaveBeenLastCalledWith('/v1/forecast/products/5/embalagens', {
      embalagens: [{ codigoId: 11, quantidadeKg: 25, rotulo: 'Saco', palletKg: null }],
    });
  });

  it('esvaziar a quantidade de um codigo com pallet manda quantidade null e palletKg null; o campo fica vazio e desabilitado', async () => {
    patch.mockResolvedValue({ data: atual });
    renderModal(true);
    await screen.findByText('PRODUTO 001');
    fireEvent.change(qtd('C0001'), { target: { value: '' } });
    expect(pallet('C0001').disabled).toBe(true);
    expect(pallet('C0001').value).toBe('');
    fireEvent.click(salvar());
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch).toHaveBeenLastCalledWith('/v1/forecast/products/5/embalagens', {
      embalagens: [{ codigoId: 11, quantidadeKg: null, rotulo: 'Saco', palletKg: null }],
    });
  });

  it.each([
    ['0', 'O pallet deve ser maior que zero.'],
    ['600,1234', 'O pallet aceita no máximo 3 casas decimais.'],
    ['1.000.001', 'O pallet aceita no máximo 1.000.000 kg.'],
    ['abc', 'Informe os kg do pallet só com números (ex.: 600 ou 1.200).'],
  ])('pallet "%s" mostra o erro no campo e desabilita Salvar (nenhum PATCH)', async (texto, erro) => {
    renderModal(true);
    await screen.findByText('PRODUTO 001');
    fireEvent.change(pallet('C0001'), { target: { value: texto } });
    const campo = pallet('C0001');
    expect(campo.getAttribute('aria-invalid')).toBe('true');
    const mensagem = screen.getByText(erro);
    expect(campo.getAttribute('aria-describedby')).toBe(mensagem.id);
    expect(salvar().disabled).toBe(true);
    fireEvent.click(salvar());
    expect(patch).not.toHaveBeenCalled();
    fireEvent.change(campo, { target: { value: '1.200' } });
    expect(screen.queryByText(erro)).toBeNull();
    expect(salvar().disabled).toBe(false);
  });

  it.each([
    ['610', 'O pallet (610 kg) não é múltiplo da embalagem (25 kg): confira com o fornecedor.'],
    ['12,5', 'O pallet (12,5 kg) não é múltiplo da embalagem (25 kg): confira com o fornecedor.'],
  ])('pallet "%s" que nao e multiplo da embalagem mostra AVISO (polite) e o Salvar continua liberado e envia o valor', async (texto, aviso) => {
    patch.mockResolvedValue({ data: atual });
    renderModal(true);
    await screen.findByText('PRODUTO 001');
    fireEvent.change(pallet('C0001'), { target: { value: texto } });
    const campo = pallet('C0001');
    const mensagem = screen.getByText(aviso);
    expect(campo.getAttribute('aria-invalid')).toBe('false');
    expect(campo.getAttribute('aria-describedby')).toBe(mensagem.id);
    expect(mensagem.closest('[aria-live="polite"]')).toBeTruthy();
    expect(mensagem.getAttribute('role')).toBeNull();
    expect(salvar().disabled).toBe(false);
    fireEvent.click(salvar());
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    const corpo = patch.mock.calls[0]?.[1] as { embalagens: Array<{ codigoId: number; palletKg: number | null }> } | undefined;
    expect(corpo?.embalagens[0]?.palletKg).toBe(Number(texto.replace(',', '.')));
  });

  it('pallet multiplo exato (e vazio) nao mostra aviso', async () => {
    renderModal(true);
    await screen.findByText('PRODUTO 001');
    fireEvent.change(pallet('C0001'), { target: { value: '1.200' } });
    expect(screen.queryByText(/não é múltiplo/)).toBeNull();
    fireEvent.change(pallet('C0001'), { target: { value: '' } });
    expect(screen.queryByText(/não é múltiplo/)).toBeNull();
  });

  it('trocar a quantidade para um valor que deixa de dividir o pallet salvo mostra o aviso (nao bloqueia) e some ao voltar a dividir', async () => {
    renderModal(true);
    await screen.findByText('PRODUTO 001');
    fireEvent.change(qtd('C0001'), { target: { value: '7' } });
    expect(screen.getByText('O pallet (600 kg) não é múltiplo da embalagem (7 kg): confira com o fornecedor.')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(salvar().disabled).toBe(false);
    fireEvent.change(qtd('C0001'), { target: { value: '20' } });
    expect(screen.queryByText(/não é múltiplo/)).toBeNull();
    expect(salvar().disabled).toBe(false);
  });

  it('backend antigo (sem palletKg nos codigos): o modal abre, o campo fica vazio e nada e enviado sem edicao', async () => {
    atual = dados(); // codigos sem a chave palletKg
    renderModal(true);
    await screen.findByText('PRODUTO 001');
    expect(pallet('C0001').value).toBe('');
    expect(salvar().disabled).toBe(true);
  });

  it('400 do backend sobre o pallet aparece em role="alert" e mantem o texto digitado', async () => {
    patch.mockRejectedValue(new ApiError(400, { message: 'Mensagem qualquer do servidor.' }));
    renderModal(true);
    await screen.findByText('PRODUTO 001');
    fireEvent.change(pallet('C0001'), { target: { value: '1.200' } });
    fireEvent.click(salvar());
    expect((await screen.findByRole('alert')).textContent).toBe('Mensagem qualquer do servidor.');
    expect(pallet('C0001').value).toBe('1.200');
  });
});
