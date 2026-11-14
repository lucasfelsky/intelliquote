import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import IndentVincularModal from './IndentVincularModal';

// "Vincular a existente" da fila de vinculo (mock v14: toast de prototipo; aqui e um modal). Dados FICTICIOS (ids 9xxxxx, CNPJs de teste).

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

const CLIENTS_URL = '/api/v1/indent/clients';
const LINK_URL = '/api/v1/indent/pending-orgs/501/link';

const ORG_COM_CNPJ = { orgId: 900201, name: 'Cliente Exemplo Alfa Ltda', cnpj: '11222333000181', city: 'Itajaí, SC' };
const ORG_SEM_CNPJ = { orgId: 900202, name: 'Cliente Exemplo Beta S.A.', cnpj: null, city: null };

const cliente = (id: number, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  cnpj: '11222333000181',
  city: 'Itajaí, SC',
  ownerName: null,
  pipedriveOrgId: null,
  supplierRuleMode: 'LIVRE',
  ruleReason: null,
  isActive: true,
  createdAt: '2026-11-12T12:00:00.000Z',
  updatedAt: '2026-11-12T12:00:00.000Z',
  supplierRules: [],
  ...extra,
});

const CLIENTES = [
  cliente(7001, 'Cliente Exemplo Alfa Matriz Ltda'),
  cliente(7002, 'Cliente Exemplo Sem CNPJ', { cnpj: null, city: null }),
  cliente(7003, 'Cliente Exemplo Outro CNPJ', { cnpj: '11444777000161', city: 'Joinville, SC' }),
  cliente(7004, 'Cliente Exemplo Ligado', { pipedriveOrgId: 900999 }),
];

function listaDe(data: unknown[], totalItems = data.length) {
  return { data, pagination: { page: 1, pageSize: 20, totalItems, totalPages: 1 }, counts: { todos: totalItems, semCnpj: 0 } };
}

let resposta: ReturnType<typeof listaDe> = listaDe(CLIENTES);

interface HostProps {
  candidato: typeof ORG_COM_CNPJ | typeof ORG_SEM_CNPJ | null;
  titulo?: string;
  onLinked?: (resultado: unknown) => void;
}

// Quem abre o modal: o botao "Abrir" tem de receber o foco de volta (restoreFocus).
function Host({ candidato, titulo = 'Cliente Exemplo Alfa Ltda', onLinked = () => undefined }: HostProps) {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setAberto(true)}>
        Abrir
      </button>
      {aberto && <IndentVincularModal pendenciaId={501} titulo={titulo} candidato={candidato} onClose={() => setAberto(false)} onLinked={onLinked} />}
    </>
  );
}

function abrir(props: HostProps) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tela = render(
    <QueryClientProvider client={qc}>
      <Host {...props} />
    </QueryClientProvider>,
  );
  const origem = screen.getByRole('button', { name: 'Abrir' });
  origem.focus();
  fireEvent.click(origem);
  return { ...tela, origem };
}

const dialogo = () => screen.getByRole('dialog');

beforeEach(() => {
  resposta = listaDe(CLIENTES);
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset();
  vi.mocked(api.get).mockImplementation((async (url: string) => (url === CLIENTS_URL ? resposta : {})) as typeof api.get);
});

describe('IndentVincularModal: foco e cabecalho', () => {
  it('foco inicial na busca (atributo data-autofocus, lido pelo Modal); eyebrow "Fila de vínculo" e titulo = nome da organizacao', async () => {
    abrir({ candidato: ORG_COM_CNPJ });
    const busca = await screen.findByPlaceholderText('Buscar cliente por nome ou CNPJ');
    expect(busca.hasAttribute('data-autofocus')).toBe(true);
    expect(document.activeElement).toBe(busca);
    expect(screen.getByRole('dialog', { name: 'Cliente Exemplo Alfa Ltda' })).toBeTruthy();
    expect(dialogo().querySelector('.modal-eyebrow')?.textContent).toBe('Fila de vínculo');
    expect(busca.closest('label')?.textContent).toContain('Buscar cliente por nome ou CNPJ');
    expect(dialogo().querySelector('form.indent-form > .modal-actions:last-child')).not.toBeNull();
    expect(screen.getByText('Org #900201 · CNPJ 11.222.333/0001-81')).toBeTruthy();
  });

  it('foco devolvido ao botao que abriu quando o modal fecha: Cancelar, Esc (cancel do dialog) e botao Fechar', async () => {
    const { origem } = abrir({ candidato: ORG_COM_CNPJ });
    await screen.findByText('Cliente Exemplo Alfa Matriz Ltda');
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(origem);

    fireEvent.click(origem);
    await screen.findByText('Cliente Exemplo Alfa Matriz Ltda');
    dialogo().dispatchEvent(new Event('cancel', { cancelable: true }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(origem);

    fireEvent.click(origem);
    await screen.findByText('Cliente Exemplo Alfa Matriz Ltda');
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(origem);
  });

  it('foco: Enter na busca nao envia o formulario', async () => {
    abrir({ candidato: ORG_COM_CNPJ });
    const busca = await screen.findByPlaceholderText('Buscar cliente por nome ou CNPJ');
    await screen.findByText('Cliente Exemplo Alfa Matriz Ltda');
    fireEvent.click(screen.getByRole('radio', { name: /Alfa Matriz/ }));
    const evento = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    busca.dispatchEvent(evento);
    expect(evento.defaultPrevented).toBe(true);
    expect(api.post).not.toHaveBeenCalled();
  });
});

describe('IndentVincularModal: busca e escolha', () => {
  it('lista com radio por cliente (nome + CNPJ mascarado ou "CNPJ pendente" + cidade) e botao Vincular so com cliente escolhido', async () => {
    abrir({ candidato: ORG_COM_CNPJ });
    const grupo = await screen.findByRole('radiogroup', { name: 'Clientes' });
    const radios = await within(grupo).findAllByRole('radio');
    expect(radios).toHaveLength(4);
    const alfa = radios[0]?.closest('label') as HTMLElement;
    expect(alfa.textContent).toContain('Cliente Exemplo Alfa Matriz Ltda');
    expect(alfa.textContent).toContain('11.222.333/0001-81');
    expect(alfa.textContent).toContain('Itajaí, SC');
    const semCnpj = radios[1]?.closest('label') as HTMLElement;
    expect(within(semCnpj).getByText('CNPJ pendente').className).toContain('indent-tag--manual');
    expect(api.get).toHaveBeenCalledWith(CLIENTS_URL, { q: undefined, page: 1, pageSize: 20, inativos: undefined, semCnpj: undefined });
    const vincular = screen.getByRole('button', { name: 'Vincular' }) as HTMLButtonElement;
    expect(vincular.disabled).toBe(true);
    fireEvent.click(radios[0] as HTMLElement);
    expect(vincular.disabled).toBe(false);
  });

  it('a busca vai ao servidor (por nome ou CNPJ) depois de uma pausa na digitacao', async () => {
    abrir({ candidato: ORG_COM_CNPJ });
    await screen.findByText('Cliente Exemplo Alfa Matriz Ltda');
    resposta = listaDe([cliente(7009, 'Cliente Exemplo Filtrado')]);
    fireEvent.change(screen.getByPlaceholderText('Buscar cliente por nome ou CNPJ'), { target: { value: '  11.444  ' } });
    // nada e pedido a cada tecla: so depois da pausa
    expect(vi.mocked(api.get).mock.calls.filter((c) => (c[1] as { q?: string } | undefined)?.q === '11.444')).toHaveLength(0);
    expect(await screen.findByText('Cliente Exemplo Filtrado')).toBeTruthy();
    expect(api.get).toHaveBeenCalledWith(CLIENTS_URL, { q: '11.444', page: 1, pageSize: 20, inativos: undefined, semCnpj: undefined });
    expect(screen.queryByText('Cliente Exemplo Alfa Matriz Ltda')).toBeNull();
  });

  it('sem resultado: "Nenhum cliente encontrado."; lista cortada: dica para refinar a busca; erro: alerta', async () => {
    resposta = listaDe([]);
    const { unmount } = abrir({ candidato: ORG_COM_CNPJ });
    expect(await screen.findByText('Nenhum cliente encontrado.')).toBeTruthy();
    unmount();

    resposta = listaDe(CLIENTES, 57);
    const cortada = abrir({ candidato: ORG_COM_CNPJ });
    expect(await screen.findByText('Mostrando 20 de 57 clientes. Refine a busca para achar o cliente.')).toBeTruthy();
    cortada.unmount();

    vi.mocked(api.get).mockImplementation((async () => {
      throw new ApiError(500, { message: 'Falha interna.' }, 'Falha interna.');
    }) as typeof api.get);
    abrir({ candidato: ORG_COM_CNPJ });
    expect((await screen.findByText(/Não foi possível carregar os clientes: Falha interna\./)).getAttribute('role')).toBe('alert');
  });

  it('cliente ja ligado a OUTRA organizacao fica desabilitado, com o motivo', async () => {
    abrir({ candidato: ORG_COM_CNPJ });
    const ligado = (await screen.findByRole('radio', { name: /Cliente Exemplo Ligado/ })) as HTMLInputElement;
    expect(ligado.disabled).toBe(true);
    expect(screen.getByText('Já vinculado à Org #900999')).toBeTruthy();
    expect((screen.getByRole('radio', { name: /Alfa Matriz/ }) as HTMLInputElement).disabled).toBe(false);
  });

  it('o MESMO cliente ja ligado a esta organizacao continua escolhivel', async () => {
    resposta = listaDe([cliente(7008, 'Cliente Exemplo Mesmo Org', { pipedriveOrgId: 900201 })]);
    abrir({ candidato: ORG_COM_CNPJ });
    expect(((await screen.findByRole('radio', { name: /Mesmo Org/ })) as HTMLInputElement).disabled).toBe(false);
  });
});

describe('IndentVincularModal: avisos de CNPJ (nao bloqueiam)', () => {
  it('CNPJ do cliente diferente do da organizacao: aviso visivel ANTES de confirmar e o botao segue habilitado', async () => {
    abrir({ candidato: ORG_COM_CNPJ });
    fireEvent.click(await screen.findByRole('radio', { name: /Outro CNPJ/ }));
    const aviso = await screen.findByText(/é diferente do CNPJ da organização do Pipedrive/);
    expect(aviso.textContent).toContain('11.444.777/0001-61');
    expect(aviso.textContent).toContain('11.222.333/0001-81');
    expect(aviso.getAttribute('role')).toBe('status');
    expect(aviso.className).toContain('alert--warning');
    expect((screen.getByRole('button', { name: 'Vincular' }) as HTMLButtonElement).disabled).toBe(false);
    // escolher o cliente com o mesmo CNPJ some com o aviso
    fireEvent.click(screen.getByRole('radio', { name: /Alfa Matriz/ }));
    expect(screen.queryByText(/é diferente do CNPJ/)).toBeNull();
  });

  it('cliente sem CNPJ e organizacao com CNPJ: aviso informativo de que o CNPJ sera preenchido (P5)', async () => {
    abrir({ candidato: ORG_COM_CNPJ });
    fireEvent.click(await screen.findByRole('radio', { name: /Sem CNPJ/ }));
    const info = await screen.findByText(/será preenchido no cadastro dele/);
    expect(info.textContent).toContain('11.222.333/0001-81');
    expect(info.textContent).toContain('se ainda não estiver em outro cadastro');
    expect(info.className).toContain('alert--info');
  });

  it('organizacao sem CNPJ: nenhum aviso de CNPJ, seja qual for o cliente', async () => {
    abrir({ candidato: ORG_SEM_CNPJ, titulo: 'Cliente Exemplo Beta S.A.' });
    fireEvent.click(await screen.findByRole('radio', { name: /Outro CNPJ/ }));
    expect(screen.queryByText(/é diferente do CNPJ/)).toBeNull();
    expect(screen.queryByText(/será preenchido/)).toBeNull();
    expect(screen.getByText('Org #900202 · sem CNPJ')).toBeTruthy();
  });
});

describe('IndentVincularModal: vincular', () => {
  const resultado = {
    client: { id: 7001, name: 'Cliente Exemplo Alfa Matriz Ltda', cnpj: '11222333000181', city: 'Itajaí, SC', pipedriveOrgId: 900201 },
    cnpjCompleted: false,
    cnpjDivergente: false,
    resolved: [{ id: 501, requestId: 11 }],
  };

  it('Vincular envia a organizacao e o cliente escolhidos e entrega o resultado a tela (que fecha o modal)', async () => {
    vi.mocked(api.post).mockResolvedValueOnce(resultado);
    const aoVincular = vi.fn();
    abrir({ candidato: ORG_COM_CNPJ, onLinked: aoVincular });
    fireEvent.click(await screen.findByRole('radio', { name: /Alfa Matriz/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Vincular' }));
    await waitFor(() => expect(aoVincular).toHaveBeenCalledWith(resultado));
    expect(api.post).toHaveBeenCalledWith(LINK_URL, { orgId: 900201, clientId: 7001 });
  });

  it('negocio sem organizacao: so o cliente vai no corpo (sem orgId) e nao ha linha de Org #', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ ...resultado, resolved: [] });
    abrir({ candidato: null, titulo: 'Solicitação 278/26' });
    expect(await screen.findByRole('dialog', { name: 'Solicitação 278/26' })).toBeTruthy();
    expect(screen.queryByText(/^Org #/)).toBeNull();
    fireEvent.click(await screen.findByRole('radio', { name: /Alfa Matriz/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Vincular' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith(LINK_URL, { clientId: 7001 }));
    // sem organizacao nao ha cliente "ligado a outra": todos escolhiveis
    expect((screen.getByRole('radio', { name: /Cliente Exemplo Ligado/ }) as HTMLInputElement).disabled).toBe(false);
  });

  it('erro do backend (409) fica no modal como alerta, o modal continua aberto e da para tentar de novo', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new ApiError(409, { message: 'Organização do Pipedrive já vinculada a outro cliente.' }, 'x'));
    const aoVincular = vi.fn();
    abrir({ candidato: ORG_COM_CNPJ, onLinked: aoVincular });
    fireEvent.click(await screen.findByRole('radio', { name: /Alfa Matriz/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Vincular' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Organização do Pipedrive já vinculada a outro cliente.');
    expect(aoVincular).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
    // escolher outro cliente limpa o erro
    fireEvent.click(screen.getByRole('radio', { name: /Outro CNPJ/ }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('em andamento o botao fica aria-disabled (foco preservado) e o segundo envio e ignorado', async () => {
    let terminar: (valor: unknown) => void = () => undefined;
    vi.mocked(api.post).mockImplementationOnce(() => new Promise((resolve) => (terminar = resolve)));
    abrir({ candidato: ORG_COM_CNPJ });
    fireEvent.click(await screen.findByRole('radio', { name: /Alfa Matriz/ }));
    const botao = screen.getByRole('button', { name: 'Vincular' });
    botao.focus();
    fireEvent.click(botao);
    await waitFor(() => expect(botao.getAttribute('aria-disabled')).toBe('true'));
    expect(botao.hasAttribute('disabled')).toBe(false);
    expect(document.activeElement).toBe(botao);
    fireEvent.click(botao);
    expect(api.post).toHaveBeenCalledTimes(1);
    terminar(resultado);
  });
});
