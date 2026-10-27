import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

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

import { ApiError } from '@/api/client';
import type { ForecastOcasiao, ForecastOcasiaoNova } from '@/services/forecastOcasioes';
import type { ValoresOcasiao } from './forecastOcasioes';
import {
  ALVOS_MAX,
  agruparEventos,
  chaveDoGrupo,
  corposPorAlvo,
  criarEmSequencia,
  deveParar,
  executarEmSequencia,
  resumoDoSalvamento,
  resumoEmLote,
  rotuloDoAlvo,
  selecaoDoModelo,
  situacaoDoGrupo,
  textoAplicaA,
  validarAlvos,
  type AlvoEvento,
  type FonteAtiva,
  type ItemAlvo,
  type ResultadoAlvo,
  type SelecaoAlvos,
} from './forecastEventosAlvos';

// Nomes de pais sinteticos: a logica pura nao depende do Intl.
const nomeP = (c: string) => `Pais ${c}`;

const F1: FonteAtiva = { id: 1, nome: 'FONTE 001', countryCode: 'XA' };
const F2: FonteAtiva = { id: 2, nome: 'FONTE 002', countryCode: 'XB' };
const F3: FonteAtiva = { id: 3, nome: 'FONTE 003', countryCode: null };
const FONTES = [F1, F2, F3];
const MAPA = new Map(FONTES.map((f) => [f.id, f]));

const sel = (parcial: Partial<SelecaoAlvos>): SelecaoAlvos => ({ modo: 'escolhidos', paises: [], fontes: [], ...parcial });

const VALORES: ValoresOcasiao = {
  nome: 'EVENTO 001',
  escopo: 'global',
  pais: null,
  fonteId: null,
  inicio: '2027-02-01',
  fim: '2027-02-03',
  anual: false,
  etapa: 'prontidao',
  dias: 3,
  observacao: null,
};

function oc(parcial: Partial<ForecastOcasiao>): ForecastOcasiao {
  return {
    id: 1,
    name: 'EVENTO 001',
    scopeType: 'global',
    countryCode: null,
    sourceId: null,
    source: null,
    startDate: '2027-02-17',
    endDate: '2027-02-25',
    recurrence: 'nenhuma',
    component: 'total',
    effectKind: 'dias',
    effectValue: 3,
    notes: null,
    isActive: true,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ocorrencias: null,
    ...parcial,
  };
}

describe('selecaoDoModelo', () => {
  const base = {
    modeloId: 'm',
    nome: 'EVENTO 001',
    inicio: '2027-01-01',
    fim: '2027-01-02',
    anual: false,
    movel: false,
    etapa: 'total' as const,
    dias: 1,
    avisos: [],
  };
  it('sem modelo ou global = todas as fontes', () => {
    expect(selecaoDoModelo()).toEqual({ modo: 'todas', paises: [], fontes: [] });
    expect(selecaoDoModelo({ ...base, escopo: 'global', pais: null })).toEqual({ modo: 'todas', paises: [], fontes: [] });
  });
  it('pais marca o pais do modelo (ou nada, quando o modelo pede para escolher)', () => {
    expect(selecaoDoModelo({ ...base, escopo: 'pais', pais: 'XA' })).toEqual({ modo: 'escolhidos', paises: ['XA'], fontes: [] });
    expect(selecaoDoModelo({ ...base, escopo: 'pais', pais: null })).toEqual({ modo: 'escolhidos', paises: [], fontes: [] });
  });
  it('fonte = escolhidos sem nada marcado', () => {
    expect(selecaoDoModelo({ ...base, escopo: 'fonte', pais: null })).toEqual({ modo: 'escolhidos', paises: [], fontes: [] });
  });
});

describe('rotuloDoAlvo', () => {
  it('global, pais e fonte', () => {
    expect(rotuloDoAlvo({ tipo: 'global' }, nomeP)).toBe('Todas as fontes');
    expect(rotuloDoAlvo({ tipo: 'pais', codigo: 'XA' }, nomeP)).toBe('Pais XA');
    expect(rotuloDoAlvo({ tipo: 'fonte', id: 1, nome: 'FONTE 001' }, nomeP)).toBe('FONTE 001');
  });
});

describe('validarAlvos', () => {
  it('todas as fontes = um alvo global, sem olhar o resto', () => {
    expect(validarAlvos({ modo: 'todas', paises: ['XA'], fontes: [1] }, MAPA, nomeP)).toEqual({
      erros: {},
      alvos: [{ tipo: 'global' }],
    });
  });

  it('nada marcado', () => {
    expect(validarAlvos(sel({}), MAPA, nomeP)).toEqual({ erros: { escopo: 'Marque ao menos um país ou uma fonte.' }, alvos: null });
  });

  it('31 alvos: erro (o limite e 30)', () => {
    expect(ALVOS_MAX).toBe(30);
    const muitas = new Map<number, FonteAtiva>();
    for (let i = 1; i <= 31; i += 1) muitas.set(i, { id: i, nome: `FONTE ${i}`, countryCode: null });
    const r = validarAlvos(sel({ fontes: [...muitas.keys()] }), muitas, nomeP);
    expect(r.erros.escopo).toBe('Marque no máximo 30 países e fontes por vez.');
    expect(r.alvos).toBeNull();
    const trinta = validarAlvos(sel({ fontes: [...muitas.keys()].slice(0, 30) }), muitas, nomeP);
    expect(trinta.erros).toEqual({});
    expect(trinta.alvos).toHaveLength(30);
  });

  it('fonte fora das ativas', () => {
    const r = validarAlvos(sel({ fontes: [99] }), MAPA, nomeP);
    expect(r.erros.fonte).toBe('Fonte não encontrada ou inativa.');
    expect(r.alvos).toBeNull();
  });

  it('fonte e o proprio pais marcados: nao soma duas vezes na mesma fonte', () => {
    const r = validarAlvos(sel({ paises: ['XA'], fontes: [1] }), MAPA, nomeP);
    expect(r.erros.fonte).toBe('FONTE 001 já recebe este evento pelo país Pais XA: desmarque a fonte ou o país.');
    expect(r.alvos).toBeNull();
  });

  it('fonte de outro pais, ou sem pais, junto de um pais marcado: valido', () => {
    const r = validarAlvos(sel({ paises: ['XA'], fontes: [2, 3] }), MAPA, nomeP);
    expect(r.erros).toEqual({});
    expect(r.alvos).toHaveLength(3);
  });

  it('ordem: paises por nome e depois fontes por nome; duplicatas somem', () => {
    const r = validarAlvos(sel({ paises: ['XB', 'XA', 'XB'], fontes: [3, 3] }), MAPA, nomeP);
    expect(r.alvos).toEqual<AlvoEvento[]>([
      { tipo: 'pais', codigo: 'XA' },
      { tipo: 'pais', codigo: 'XB' },
      { tipo: 'fonte', id: 3, nome: 'FONTE 003' },
    ]);
  });
});

describe('corposPorAlvo', () => {
  it('um corpo exato por alvo (global, pais, fonte)', () => {
    const itens = corposPorAlvo(
      VALORES,
      [{ tipo: 'global' }, { tipo: 'pais', codigo: 'XA' }, { tipo: 'fonte', id: 3, nome: 'FONTE 003' }],
      nomeP,
    );
    const comum = {
      name: 'EVENTO 001',
      startDate: '2027-02-01',
      endDate: '2027-02-03',
      recurrence: 'nenhuma',
      component: 'prontidao',
      effectKind: 'dias',
      effectValue: 3,
      notes: null,
    };
    expect(itens.map((i) => i.rotulo)).toEqual(['Todas as fontes', 'Pais XA', 'FONTE 003']);
    expect(itens[0]?.corpo).toEqual({ ...comum, scopeType: 'global', countryCode: null, sourceId: null });
    expect(itens[1]?.corpo).toEqual({ ...comum, scopeType: 'pais', countryCode: 'XA', sourceId: null });
    expect(itens[2]?.corpo).toEqual({ ...comum, scopeType: 'fonte', countryCode: null, sourceId: 3 });
  });
});

describe('deveParar', () => {
  it('para em 401, 403 e erro que nao e ApiError; segue em 400, 409 e 500', () => {
    expect(deveParar(new ApiError(401, null))).toBe(true);
    expect(deveParar(new ApiError(403, null))).toBe(true);
    expect(deveParar(new Error('rede'))).toBe(true);
    expect(deveParar(new ApiError(400, null))).toBe(false);
    expect(deveParar(new ApiError(409, null))).toBe(false);
    expect(deveParar(new ApiError(500, null))).toBe(false);
  });
});

describe('executarEmSequencia', () => {
  it('ordem estrita: a 2a chamada so comeca depois da 1a resolver', async () => {
    const resolvers: Array<() => void> = [];
    const chamadas: number[] = [];
    const acao = (n: number) =>
      new Promise<void>((resolve) => {
        chamadas.push(n);
        resolvers.push(resolve);
      });
    const fim = executarEmSequencia([1, 2, 3], acao);
    await Promise.resolve();
    expect(chamadas).toEqual([1]);
    resolvers[0]?.();
    await vi.waitFor(() => expect(chamadas).toEqual([1, 2]));
    resolvers[1]?.();
    await vi.waitFor(() => expect(chamadas).toEqual([1, 2, 3]));
    resolvers[2]?.();
    const r = await fim;
    expect(r.map((x) => [x.item, x.erro, x.naoEnviado])).toEqual([
      [1, null, false],
      [2, null, false],
      [3, null, false],
    ]);
  });

  it.each([
    ['401', new ApiError(401, null)],
    ['403', new ApiError(403, null)],
    ['sem ApiError', new Error('rede')],
  ])('para em %s: os restantes ficam nao enviados', async (_nome, erro) => {
    const acao = vi.fn(async (n: number) => {
      if (n === 1) throw erro;
    });
    const r = await executarEmSequencia([1, 2, 3], acao);
    expect(acao).toHaveBeenCalledTimes(1);
    expect(r.map((x) => [x.item, x.erro !== null, x.naoEnviado])).toEqual([
      [1, true, false],
      [2, false, true],
      [3, false, true],
    ]);
  });

  it.each([400, 409, 500])('nao para em %i', async (status) => {
    const acao = vi.fn(async (n: number) => {
      if (n === 1) throw new ApiError(status, null);
    });
    const r = await executarEmSequencia([1, 2, 3], acao);
    expect(acao).toHaveBeenCalledTimes(3);
    expect(r.map((x) => x.naoEnviado)).toEqual([false, false, false]);
    expect(r[0]?.erro).toBeInstanceOf(ApiError);
  });
});

describe('criarEmSequencia', () => {
  const itens: ItemAlvo[] = corposPorAlvo(
    VALORES,
    [{ tipo: 'pais', codigo: 'XA' }, { tipo: 'pais', codigo: 'XB' }, { tipo: 'fonte', id: 3, nome: 'FONTE 003' }],
    nomeP,
  );
  let criar: Mock<(c: ForecastOcasiaoNova) => Promise<unknown>>;
  beforeEach(() => {
    criar = vi.fn<(c: ForecastOcasiaoNova) => Promise<unknown>>();
  });

  it('409 = duplicado (sem mensagem); outro erro = erro com a mensagem; sucesso = criado', async () => {
    criar
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new ApiError(409, { message: 'x' }))
      .mockRejectedValueOnce(new ApiError(500, null));
    const r = await criarEmSequencia(itens, criar);
    expect(r.map((x) => [x.rotulo, x.status, x.mensagem])).toEqual([
      ['Pais XA', 'criado', null],
      ['Pais XB', 'duplicado', null],
      ['FONTE 003', 'erro', 'Não foi possível salvar o evento (HTTP 500).'],
    ]);
  });

  it('401 no 1o: 1 chamada, o erro e os nao enviados', async () => {
    criar.mockRejectedValue(new ApiError(401, null));
    const r = await criarEmSequencia(itens, criar);
    expect(criar).toHaveBeenCalledTimes(1);
    expect(r.map((x) => x.status)).toEqual(['erro', 'nao-enviado', 'nao-enviado']);
  });
});

describe('resumoDoSalvamento', () => {
  const r = (...status: ResultadoAlvo['status'][]): ResultadoAlvo[] =>
    status.map((s, i) => ({ alvo: { tipo: 'global' }, rotulo: `A${i}`, status: s, mensagem: null }));

  it('plurais, ordem e zeros omitidos', () => {
    expect(resumoDoSalvamento('EVENTO 001', r('criado', 'criado', 'criado', 'duplicado'))).toBe(
      'Evento EVENTO 001: 3 criados, 1 já existia.',
    );
    expect(resumoDoSalvamento('EVENTO 001', r('criado'))).toBe('Evento EVENTO 001: 1 criado.');
    expect(resumoDoSalvamento('EVENTO 001', r('criado', 'duplicado', 'duplicado', 'erro', 'nao-enviado', 'nao-enviado'))).toBe(
      'Evento EVENTO 001: 1 criado, 2 já existiam, 1 com erro, 2 não enviados.',
    );
    expect(resumoDoSalvamento('EVENTO 001', r('erro', 'nao-enviado'))).toBe('Evento EVENTO 001: 1 com erro, 1 não enviado.');
  });

  it('tudo duplicado: nada foi criado', () => {
    expect(resumoDoSalvamento('EVENTO 001', r('duplicado', 'duplicado'))).toBe(
      'Evento EVENTO 001: 2 já existiam. Nada foi criado.',
    );
  });
});

describe('resumoEmLote', () => {
  it('sem falha', () => {
    expect(resumoEmLote('EVENTO 001', 'inativado', 3, 0, null)).toBe('Evento EVENTO 001 inativado em 3 alvos.');
    expect(resumoEmLote('EVENTO 001', 'excluído', 2, 0, null)).toBe('Evento EVENTO 001 excluído em 2 alvos.');
  });
  it('com falha, singular e plural, com ou sem mensagem', () => {
    expect(resumoEmLote('EVENTO 001', 'inativado', 1, 2, 'Sua sessão expirou. Entre de novo.')).toBe(
      'Evento EVENTO 001: 1 inativado, 2 com erro. Sua sessão expirou. Entre de novo.',
    );
    expect(resumoEmLote('EVENTO 001', 'reativado', 2, 1, null)).toBe('Evento EVENTO 001: 2 reativados, 1 com erro.');
  });
});

describe('agrupamento', () => {
  const A = oc({ id: 1, scopeType: 'pais', countryCode: 'XB' });
  const B = oc({ id: 2, scopeType: 'pais', countryCode: 'XA' });
  const C = oc({ id: 3, scopeType: 'fonte', sourceId: 1, source: { id: 1, name: 'FONTE 001', isActive: true } });
  const G = oc({ id: 4 });

  it('chaveDoGrupo muda com nome, periodo, recorrencia, etapa, dias, efeito e observacao', () => {
    const base = chaveDoGrupo(oc({}));
    expect(chaveDoGrupo(oc({ id: 9, scopeType: 'pais', countryCode: 'XA' }))).toBe(base);
    for (const parcial of [
      { name: 'EVENTO 002' },
      { startDate: '2027-02-18' },
      { endDate: '2027-02-26' },
      { recurrence: 'anual' as const },
      { component: 'embarque' as const },
      { effectValue: 4 },
      { effectKind: 'percentual' as const },
      { notes: 'obs' },
    ]) {
      expect(chaveDoGrupo(oc(parcial)), JSON.stringify(parcial)).not.toBe(base);
    }
    expect(chaveDoGrupo(oc({ notes: null }))).toBe(chaveDoGrupo(oc({ notes: '' })));
  });

  it('mesmo conteudo junta; membros: global, pais por nome, fonte por nome, desempate por id', () => {
    const grupos = agruparEventos([A, C, B, G], nomeP);
    expect(grupos).toHaveLength(1);
    expect(grupos[0]?.membros.map((m) => m.id)).toEqual([4, 2, 1, 3]);
    expect(grupos[0]?.nome).toBe('EVENTO 001');
  });

  it('conteudo diferente separa, na ordem do 1o membro de cada grupo', () => {
    const X = oc({ id: 10, name: 'EVENTO 002' });
    const Y = oc({ id: 11, notes: 'obs' });
    const grupos = agruparEventos([A, X, B, Y], nomeP);
    expect(grupos.map((g) => g.membros.map((m) => m.id))).toEqual([[2, 1], [10], [11]]);
    expect(grupos[2]?.notas).toBe('obs');
  });
});

describe('situacaoDoGrupo', () => {
  const HOJE = '2026-10-27';
  const grupo = (...membros: ForecastOcasiao[]) => ({ chave: 'k', nome: 'EVENTO 001', notas: null, membros });

  it('todos iguais: rotulo e classe da situacao, sem detalhe', () => {
    expect(situacaoDoGrupo(grupo(oc({ id: 1 }), oc({ id: 2 })), HOJE)).toEqual({ rotulo: 'Ativo', classe: 'badge', detalhe: null });
    expect(situacaoDoGrupo(grupo(oc({ isActive: false })), HOJE)).toEqual({
      rotulo: 'Inativo',
      classe: 'badge badge--warning',
      detalhe: null,
    });
    expect(situacaoDoGrupo(grupo(oc({ startDate: '2026-01-01', endDate: '2026-01-02' })), HOJE)).toEqual({
      rotulo: 'Passado',
      classe: 'badge badge--muted',
      detalhe: null,
    });
  });

  it('misto: ativos, passados e inativos, omitindo zeros', () => {
    const g = grupo(oc({ id: 1 }), oc({ id: 2 }), oc({ id: 3, isActive: false }));
    expect(situacaoDoGrupo(g, HOJE)).toEqual({ rotulo: 'Misto', classe: 'badge badge--info', detalhe: '2 ativos, 1 inativo' });
    const h = grupo(oc({ id: 1 }), oc({ id: 2, startDate: '2026-01-01', endDate: '2026-01-02' }), oc({ id: 3, isActive: false }));
    expect(situacaoDoGrupo(h, HOJE).detalhe).toBe('1 ativo, 1 passado, 1 inativo');
  });
});

describe('textoAplicaA', () => {
  it('todas as fontes', () => {
    expect(textoAplicaA({ modo: 'todas', paises: [], fontes: [] }, FONTES, nomeP)).toBe('Vale para todas as fontes ativas (3).');
  });
  it('escolhidos sem nada', () => {
    expect(textoAplicaA(sel({}), FONTES, nomeP)).toBe('Marque os países e/ou as fontes a que o evento se aplica.');
  });
  it('escolhidos: paises e depois fontes, com a contagem de registros', () => {
    expect(textoAplicaA(sel({ paises: ['XB', 'XA'], fontes: [3] }), FONTES, nomeP)).toBe(
      'Vale para: Pais XA, Pais XB, FONTE 003. Ao salvar, cria 3 registros (um por país ou fonte).',
    );
    expect(textoAplicaA(sel({ fontes: [2] }), FONTES, nomeP)).toBe(
      'Vale para: FONTE 002. Ao salvar, cria 1 registro (um por país ou fonte).',
    );
  });
});
