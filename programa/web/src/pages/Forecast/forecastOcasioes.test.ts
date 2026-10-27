import { describe, expect, it } from 'vitest';
import type { ForecastOcasiao } from '@/services/forecastOcasioes';
import {
  CAMPOS_VAZIOS,
  FILTROS_PADRAO,
  anosDoFiltro,
  camposDaOcasiao,
  chaveDataLocal,
  colunasDosMeses,
  contarSemPais,
  diasEntre,
  filtrarOcasioes,
  lerCodigoPais,
  lerDiasOcasiao,
  montarCorpoNovo,
  montarEdicao,
  nomeDoPais,
  opcoesDePais,
  ordenarOcasioes,
  paisPorFonte,
  posicaoDeHoje,
  segmentoNoAno,
  situacaoDaOcasiao,
  somarDias,
  textoAlcance,
  textoEfeito,
  textoFontesSemPais,
  textoPeriodo,
  validarOcasiao,
  type CamposOcasiao,
  type ContextoValidacao,
} from './forecastOcasioes';

const HOJE = '2026-10-27';

function oc(parcial: Partial<ForecastOcasiao> = {}): ForecastOcasiao {
  return {
    id: 1,
    name: 'OCASIAO SINTETICA 1',
    scopeType: 'global',
    countryCode: null,
    sourceId: null,
    source: null,
    startDate: '2027-02-01',
    endDate: '2027-02-03',
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

const CTX: ContextoValidacao = { efeitoBloqueado: false, fontesAtivas: new Set([1, 2]), fonteOriginal: null };

function campos(parcial: Partial<CamposOcasiao> = {}): CamposOcasiao {
  return { ...CAMPOS_VAZIOS, nome: 'OCASIAO SINTETICA 1', inicio: '2027-02-01', fim: '2027-02-03', dias: '3', ...parcial };
}

describe('validarOcasiao', () => {
  it('campos validos geram os valores', () => {
    const r = validarOcasiao(campos({ observacao: '  nota  ' }), CTX);
    expect(r.erros).toEqual({});
    expect(r.valores).toMatchObject({ nome: 'OCASIAO SINTETICA 1', escopo: 'global', dias: 3, observacao: 'nota' });
  });

  it('vazio: uma mensagem exata por campo', () => {
    const r = validarOcasiao(CAMPOS_VAZIOS, CTX);
    expect(r.valores).toBeNull();
    expect(r.erros).toEqual({
      nome: 'Informe o nome do evento.',
      inicio: 'Informe a data de início.',
      fim: 'Informe a data de fim.',
      dias: 'Informe os dias como inteiro de 0 a 120.',
    });
  });

  it('nome: 120 passa, 121 falha', () => {
    expect(validarOcasiao(campos({ nome: 'a'.repeat(120) }), CTX).erros.nome).toBeUndefined();
    expect(validarOcasiao(campos({ nome: 'a'.repeat(121) }), CTX).erros.nome).toBe('O nome aceita no máximo 120 caracteres.');
  });

  it('observacao: 300 passa, 301 falha', () => {
    expect(validarOcasiao(campos({ observacao: 'a'.repeat(300) }), CTX).erros.observacao).toBeUndefined();
    expect(validarOcasiao(campos({ observacao: 'a'.repeat(301) }), CTX).erros.observacao).toBe(
      'A observação aceita no máximo 300 caracteres.',
    );
  });

  it('escopo global ignora pais e fonte preenchidos', () => {
    const r = validarOcasiao(campos({ escopo: 'global', pais: 'xx', fonte: '99' }), CTX);
    expect(r.erros).toEqual({});
    expect(r.valores?.pais).toBeNull();
    expect(r.valores?.fonteId).toBeNull();
  });

  it('escopo pais: as tres mensagens do codigo', () => {
    expect(validarOcasiao(campos({ escopo: 'pais', pais: '' }), CTX).erros.pais).toBe('Informe o país do evento.');
    expect(validarOcasiao(campos({ escopo: 'pais', pais: 'C' }), CTX).erros.pais).toBe(
      'O código do país deve ter 2 letras (ISO 3166-1 alfa-2, ex.: CN).',
    );
    expect(validarOcasiao(campos({ escopo: 'pais', pais: 'xx' }), CTX).erros.pais).toBe(
      'Código de país não reconhecido. Confira o código ISO de 2 letras.',
    );
    expect(validarOcasiao(campos({ escopo: 'pais', pais: 'cn' }), CTX).valores?.pais).toBe('CN');
  });

  it('escopo fonte: vazio, inativa e a fonte original continua valida', () => {
    expect(validarOcasiao(campos({ escopo: 'fonte', fonte: '' }), CTX).erros.fonte).toBe('Informe a fonte do evento.');
    expect(validarOcasiao(campos({ escopo: 'fonte', fonte: '9' }), CTX).erros.fonte).toBe('Fonte não encontrada ou inativa.');
    expect(validarOcasiao(campos({ escopo: 'fonte', fonte: '9' }), { ...CTX, fonteOriginal: 9 }).erros.fonte).toBeUndefined();
    expect(validarOcasiao(campos({ escopo: 'fonte', fonte: '2' }), CTX).valores?.fonteId).toBe(2);
  });

  it('periodo: fim antes do inicio, 120 passa e 121 falha, data invalida', () => {
    expect(validarOcasiao(campos({ inicio: '2027-02-10', fim: '2027-02-09' }), CTX).erros.fim).toBe(
      'O fim não pode ser anterior ao início.',
    );
    // 2027-01-01 .. 2027-04-30 = 120 dias inclusivos
    expect(validarOcasiao(campos({ inicio: '2027-01-01', fim: '2027-04-30' }), CTX).erros.fim).toBeUndefined();
    expect(validarOcasiao(campos({ inicio: '2027-01-01', fim: '2027-05-01' }), CTX).erros.fim).toBe(
      'O período aceita no máximo 120 dias.',
    );
    expect(validarOcasiao(campos({ inicio: '2027-02-30' }), CTX).erros.inicio).toBe('Informe a data de início.');
  });

  it('dias: 0 e 120 passam; 121, -1, 1,5 e abc falham', () => {
    for (const ok of ['0', '120']) expect(validarOcasiao(campos({ dias: ok }), CTX).erros.dias).toBeUndefined();
    for (const ruim of ['121', '-1', '1,5', 'abc', '']) {
      expect(validarOcasiao(campos({ dias: ruim }), CTX).erros.dias).toBe('Informe os dias como inteiro de 0 a 120.');
    }
  });

  it('efeito bloqueado pula os dias', () => {
    const r = validarOcasiao(campos({ dias: '' }), { ...CTX, efeitoBloqueado: true });
    expect(r.erros).toEqual({});
    expect(r.valores?.dias).toBeNull();
  });
});

describe('lerDiasOcasiao', () => {
  it('so inteiro de 0 a 120', () => {
    expect(lerDiasOcasiao(' 7 ')).toBe(7);
    expect(lerDiasOcasiao('0')).toBe(0);
    expect(lerDiasOcasiao('121')).toBeNull();
    expect(lerDiasOcasiao('1000')).toBeNull();
  });
});

describe('montarCorpoNovo', () => {
  it('nulls fora do escopo, effectKind dias, sem isActive nem coverWithStock', () => {
    const r = validarOcasiao(campos({ escopo: 'global', pais: 'CN', fonte: '1', anual: true, observacao: '' }), CTX);
    const corpo = montarCorpoNovo(r.valores!);
    expect(corpo).toEqual({
      name: 'OCASIAO SINTETICA 1',
      scopeType: 'global',
      countryCode: null,
      sourceId: null,
      startDate: '2027-02-01',
      endDate: '2027-02-03',
      recurrence: 'anual',
      component: 'total',
      effectKind: 'dias',
      effectValue: 3,
      notes: null,
    });
    expect(corpo).not.toHaveProperty('isActive');
    expect(corpo).not.toHaveProperty('coverWithStock');
  });

  it('escopos pais e fonte levam so o seu alvo', () => {
    const pais = montarCorpoNovo(validarOcasiao(campos({ escopo: 'pais', pais: 'de' }), CTX).valores!);
    expect(pais).toMatchObject({ scopeType: 'pais', countryCode: 'DE', sourceId: null });
    const fonte = montarCorpoNovo(validarOcasiao(campos({ escopo: 'fonte', fonte: '2' }), CTX).valores!);
    expect(fonte).toMatchObject({ scopeType: 'fonte', countryCode: null, sourceId: 2 });
  });
});

describe('montarEdicao', () => {
  const valoresDe = (original: ForecastOcasiao, mudar: Partial<CamposOcasiao> = {}, ctx: Partial<ContextoValidacao> = {}) => {
    const r = validarOcasiao({ ...camposDaOcasiao(original), ...mudar }, { ...CTX, fonteOriginal: original.sourceId, ...ctx });
    expect(r.erros).toEqual({});
    return r.valores!;
  };

  it('nada mudou = null', () => {
    const o = oc();
    expect(montarEdicao(o, valoresDe(o))).toBeNull();
  });

  it('so o nome', () => {
    const o = oc();
    expect(montarEdicao(o, valoresDe(o, { nome: 'OUTRO NOME' }))).toEqual({ name: 'OUTRO NOME' });
  });

  it('bloco de escopo completo quando qualquer parte muda', () => {
    const o = oc();
    expect(montarEdicao(o, valoresDe(o, { escopo: 'pais', pais: 'cn' }))).toEqual({
      scopeType: 'pais',
      countryCode: 'CN',
      sourceId: null,
    });
    const f = oc({ scopeType: 'fonte', sourceId: 1, source: { id: 1, name: 'FONTE A', isActive: true } });
    expect(montarEdicao(f, valoresDe(f, { fonte: '2' }))).toEqual({ scopeType: 'fonte', countryCode: null, sourceId: 2 });
  });

  it('so o nome de ocasiao de fonte inativada nao reenvia o escopo', () => {
    const f = oc({ scopeType: 'fonte', sourceId: 7, source: { id: 7, name: 'FONTE X', isActive: false } });
    expect(montarEdicao(f, valoresDe(f, { nome: 'NOVO' }))).toEqual({ name: 'NOVO' });
  });

  it('bloco de periodo leva as duas datas', () => {
    const o = oc();
    expect(montarEdicao(o, valoresDe(o, { fim: '2027-02-05' }))).toEqual({ startDate: '2027-02-01', endDate: '2027-02-05' });
  });

  it('recorrencia, etapa, dias e observacao', () => {
    const o = oc({ notes: 'antiga' });
    expect(
      montarEdicao(o, valoresDe(o, { anual: true, etapa: 'embarque', dias: '9', observacao: '' })),
    ).toEqual({ recurrence: 'anual', component: 'embarque', effectKind: 'dias', effectValue: 9, notes: null });
  });

  it('percentual nunca envia o efeito', () => {
    const p = oc({ effectKind: 'percentual', effectValue: 12.5 });
    const v = valoresDe(p, { nome: 'NOVO', dias: '' }, { efeitoBloqueado: true });
    expect(montarEdicao(p, v)).toEqual({ name: 'NOVO' });
  });
});

describe('situacaoDaOcasiao', () => {
  it('passada so sem recorrencia com fim antes de hoje; anual nunca; inativa vence', () => {
    expect(situacaoDaOcasiao(oc({ endDate: '2026-10-26' }), HOJE)).toBe('passada');
    expect(situacaoDaOcasiao(oc({ endDate: '2026-10-27' }), HOJE)).toBe('ativa');
    expect(situacaoDaOcasiao(oc({ startDate: '2020-01-01', endDate: '2020-01-03', recurrence: 'anual' }), HOJE)).toBe('ativa');
    expect(situacaoDaOcasiao(oc({ endDate: '2020-01-03', isActive: false }), HOJE)).toBe('inativa');
  });
});

describe('filtrarOcasioes e ordenarOcasioes', () => {
  const lista = [
    oc({ id: 1, name: 'B GLOBAL', startDate: '2027-03-01', endDate: '2027-03-02' }),
    oc({ id: 2, name: 'A PAIS', scopeType: 'pais', countryCode: 'CN', startDate: '2027-03-01', endDate: '2027-03-02' }),
    oc({ id: 3, name: 'PASSADA', startDate: '2026-01-01', endDate: '2026-01-02' }),
    oc({ id: 4, name: 'INATIVA', isActive: false, startDate: '2027-05-01', endDate: '2027-05-02' }),
    oc({
      id: 5,
      name: 'FONTE',
      scopeType: 'fonte',
      sourceId: 1,
      source: { id: 1, name: 'FONTE A', isActive: true },
      startDate: '2027-04-01',
      endDate: '2027-04-02',
    }),
    oc({ id: 6, name: 'ANUAL', recurrence: 'anual', startDate: '2026-12-20', endDate: '2027-01-05' }),
  ];
  const ids = (l: ForecastOcasiao[]) => l.map((o) => o.id);

  it('padrao: so ativas (em vigor ou futuras)', () => {
    expect(ids(filtrarOcasioes(lista, FILTROS_PADRAO, HOJE))).toEqual([1, 2, 5, 6]);
  });

  it('situacao passada, inativa e todas', () => {
    expect(ids(filtrarOcasioes(lista, { ...FILTROS_PADRAO, situacao: 'passada' }, HOJE))).toEqual([3]);
    expect(ids(filtrarOcasioes(lista, { ...FILTROS_PADRAO, situacao: 'inativa' }, HOJE))).toEqual([4]);
    expect(filtrarOcasioes(lista, { ...FILTROS_PADRAO, situacao: 'todas' }, HOJE)).toHaveLength(6);
  });

  it('alcance, pais e fonte', () => {
    expect(ids(filtrarOcasioes(lista, { ...FILTROS_PADRAO, escopo: 'pais' }, HOJE))).toEqual([2]);
    expect(ids(filtrarOcasioes(lista, { ...FILTROS_PADRAO, pais: 'CN' }, HOJE))).toEqual([2]);
    expect(ids(filtrarOcasioes(lista, { ...FILTROS_PADRAO, pais: 'DE' }, HOJE))).toEqual([]);
    expect(ids(filtrarOcasioes(lista, { ...FILTROS_PADRAO, fonte: '1' }, HOJE))).toEqual([5]);
    expect(ids(filtrarOcasioes(lista, { ...FILTROS_PADRAO, fonte: '2' }, HOJE))).toEqual([]);
  });

  it('ano: anual vale em qualquer ano; as demais pela sobreposicao', () => {
    const todas = { ...FILTROS_PADRAO, situacao: 'todas' as const };
    expect(ids(filtrarOcasioes(lista, { ...todas, ano: 2026 }, HOJE))).toEqual([3, 6]);
    expect(ids(filtrarOcasioes(lista, { ...todas, ano: 2027 }, HOJE))).toEqual([1, 2, 4, 5, 6]);
    expect(ids(filtrarOcasioes(lista, { ...todas, ano: 2030 }, HOJE))).toEqual([6]);
  });

  it('ordena por inicio, nome pt-BR e id, sem mutar a entrada', () => {
    const entrada = [
      oc({ id: 9, name: 'Zeta', startDate: '2027-01-01' }),
      oc({ id: 8, name: 'Álamo', startDate: '2027-02-01' }),
      oc({ id: 7, name: 'Beta', startDate: '2027-02-01' }),
      oc({ id: 6, name: 'Beta', startDate: '2027-02-01' }),
    ];
    const copia = [...entrada];
    expect(ids(ordenarOcasioes(entrada))).toEqual([9, 8, 6, 7]);
    expect(entrada).toEqual(copia);
  });

  it('anosDoFiltro: ano anterior ate +2', () => {
    expect(anosDoFiltro(HOJE)).toEqual([2025, 2026, 2027, 2028]);
  });
});

describe('textos de linha', () => {
  it('periodo', () => {
    expect(textoPeriodo(oc({ startDate: '2027-02-17', endDate: '2027-02-25' }))).toBe('17/02/2027 a 25/02/2027');
    expect(textoPeriodo(oc({ startDate: '2027-02-17', endDate: '2027-02-17' }))).toBe('17/02/2027');
    expect(textoPeriodo(oc({ recurrence: 'anual', startDate: '2026-12-20', endDate: '2027-01-05' }))).toBe('20/12 a 05/01, todo ano');
    expect(textoPeriodo(oc({ recurrence: 'anual', startDate: '2026-05-01', endDate: '2026-05-01' }))).toBe('01/05, todo ano');
  });

  it('efeito', () => {
    expect(textoEfeito({ effectKind: 'dias', effectValue: 1 })).toBe('+1 dia');
    expect(textoEfeito({ effectKind: 'dias', effectValue: 14 })).toBe('+14 dias');
    expect(textoEfeito({ effectKind: 'dias', effectValue: 0 })).toBe('+0 dias');
    expect(textoEfeito({ effectKind: 'percentual', effectValue: 12.5 })).toBe('+12,5% da etapa');
    expect(textoEfeito({ effectKind: 'percentual', effectValue: 20 })).toBe('+20% da etapa');
  });

  it('alcance', () => {
    expect(textoAlcance(oc(), nomeDoPais)).toBe('Todas as fontes');
    expect(textoAlcance(oc({ scopeType: 'pais', countryCode: 'CN' }), nomeDoPais)).toBe('País: China (CN)');
    expect(textoAlcance(oc({ scopeType: 'fonte', source: { id: 1, name: 'FONTE A', isActive: true } }), nomeDoPais)).toBe('Fonte: FONTE A');
    expect(textoAlcance(oc({ scopeType: 'fonte', source: { id: 1, name: 'FONTE A', isActive: false } }), nomeDoPais)).toBe(
      'Fonte: FONTE A (inativa)',
    );
    expect(textoAlcance(oc({ scopeType: 'fonte', source: null }), nomeDoPais)).toBe('Fonte removida');
  });
});

describe('paises', () => {
  it('lerCodigoPais', () => {
    expect(lerCodigoPais(' cn ')).toEqual({ codigo: 'CN' });
    expect('erro' in lerCodigoPais('XX')).toBe(true);
    expect(lerCodigoPais('C')).toEqual({ erro: 'O código do país deve ter 2 letras (ISO 3166-1 alfa-2, ex.: CN).' });
    expect(lerCodigoPais('')).toEqual({ erro: 'Informe o país do evento.' });
  });

  it('nomeDoPais', () => {
    expect(nomeDoPais(null)).toBe('—');
    expect(nomeDoPais(undefined)).toBe('—');
    expect(nomeDoPais('')).toBe('—');
    expect(nomeDoPais('CN')).toBe('China (CN)');
    expect(nomeDoPais('DE')).toBe('Alemanha (DE)');
  });

  it('opcoesDePais: uniao sem repetir, ordenada por nome', () => {
    const o = opcoesDePais(['CN', 'PT', '']);
    const codigos = o.map((x) => x.codigo);
    expect(codigos).toContain('PT');
    expect(codigos.filter((c) => c === 'CN')).toHaveLength(1);
    expect(codigos).toHaveLength(13);
    const nomes = o.map((x) => x.nome);
    expect([...nomes].sort((a, b) => a.localeCompare(b, 'pt-BR'))).toEqual(nomes);
  });

  it('paisPorFonte: lista vira mapa; o que nao e lista vira null', () => {
    const mapa = paisPorFonte([
      { id: 1, countryCode: 'CN' },
      { id: 2, countryCode: null },
      { id: 3 },
    ]);
    expect(mapa?.get(1)).toBe('CN');
    expect(mapa?.get(2)).toBeNull();
    expect(mapa?.get(3)).toBeNull();
    expect(paisPorFonte({ fontes: [] })).toBeNull();
    expect(paisPorFonte(undefined)).toBeNull();
  });

  it('contarSemPais e textoFontesSemPais', () => {
    const mapa = new Map<number, string | null>([[1, 'CN'], [2, null]]);
    expect(contarSemPais([1, 2, 3], mapa)).toBe(2);
    expect(textoFontesSemPais(0)).toBeNull();
    expect(textoFontesSemPais(1)).toBe('1 fonte sem país: eventos por país não a alcançam.');
    expect(textoFontesSemPais(3)).toBe('3 fontes sem país: eventos por país não as alcançam.');
  });
});

describe('datas', () => {
  it('chaveDataLocal usa a data local', () => {
    expect(chaveDataLocal(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(chaveDataLocal(new Date(2026, 11, 31, 23, 59))).toBe('2026-12-31');
  });

  it('somarDias e diasEntre: virada de ano e bissexto', () => {
    expect(somarDias('2026-12-31', 1)).toBe('2027-01-01');
    expect(somarDias('2027-01-01', -1)).toBe('2026-12-31');
    expect(somarDias('2028-02-28', 1)).toBe('2028-02-29');
    expect(somarDias('2027-02-28', 1)).toBe('2027-03-01');
    expect(diasEntre('2026-12-20', '2027-01-05')).toBe(16);
    expect(diasEntre('2028-02-28', '2028-03-01')).toBe(2);
    expect(diasEntre('2027-02-03', '2027-02-01')).toBe(-2);
  });
});

describe('linha do tempo', () => {
  it('colunasDosMeses: fevereiro 28 ou 29', () => {
    expect(colunasDosMeses(2027)).toBe('31fr 28fr 31fr 30fr 31fr 30fr 31fr 31fr 30fr 31fr 30fr 31fr');
    expect(colunasDosMeses(2028).split(' ')[1]).toBe('29fr');
  });

  it('segmentoNoAno: dentro, recortado nas duas pontas e fora', () => {
    expect(segmentoNoAno({ inicio: '2027-01-01', fim: '2027-01-05' }, 2027)).toEqual({
      esquerdaPct: 0,
      larguraPct: Math.round((5 / 365) * 10000) / 100,
    });
    const dentro = segmentoNoAno({ inicio: '2027-07-02', fim: '2027-07-02' }, 2027)!;
    expect(dentro.esquerdaPct).toBe(Math.round((182 / 365) * 10000) / 100);
    expect(dentro.larguraPct).toBe(Math.round((1 / 365) * 10000) / 100);
    // atravessa a virada: no ano 2027 so conta de 01/01 a 05/01 e, em 2026, de 20/12 a 31/12
    expect(segmentoNoAno({ inicio: '2026-12-20', fim: '2027-01-05' }, 2027)).toEqual({
      esquerdaPct: 0,
      larguraPct: Math.round((5 / 365) * 10000) / 100,
    });
    const fim2026 = segmentoNoAno({ inicio: '2026-12-20', fim: '2027-01-05' }, 2026)!;
    expect(fim2026.larguraPct).toBe(Math.round((12 / 365) * 10000) / 100);
    // recortada nas duas pontas
    expect(segmentoNoAno({ inicio: '2026-06-01', fim: '2028-06-01' }, 2027)).toEqual({ esquerdaPct: 0, larguraPct: 100 });
    expect(segmentoNoAno({ inicio: '2028-01-01', fim: '2028-01-02' }, 2027)).toBeNull();
    expect(segmentoNoAno({ inicio: '2026-01-01', fim: '2026-12-31' }, 2027)).toBeNull();
  });

  it('posicaoDeHoje: no ano certo, ou null', () => {
    const pct = posicaoDeHoje(HOJE, 2026)!;
    expect(pct).toBeGreaterThan(80);
    expect(pct).toBeLessThan(85);
    expect(posicaoDeHoje(HOJE, 2027)).toBeNull();
  });
});

describe('validarOcasiao: o que nao mudou na edicao nao e reconferido', () => {
  const doPais = (countryCode: string) => oc({ scopeType: 'pais', countryCode });

  it('pais valido no backend mas desconhecido do Intl passa se nao mudou', () => {
    const original = doPais('XX');
    const ctx = { ...CTX, escopoOriginal: 'pais' as const, paisOriginal: 'XX' };
    const r = validarOcasiao({ ...camposDaOcasiao(original), nome: 'NOME NOVO' }, ctx);
    expect(r.erros).toEqual({});
    expect(r.valores?.pais).toBe('XX');
    expect(montarEdicao(original, r.valores!)).toEqual({ name: 'NOME NOVO' });
  });

  it('trocar o pais volta a conferir (e minusculas casam com o original)', () => {
    const original = doPais('XX');
    const ctx = { ...CTX, escopoOriginal: 'pais' as const, paisOriginal: 'XX' };
    expect(validarOcasiao({ ...camposDaOcasiao(original), pais: 'QQ' }, ctx).erros.pais).toBe(
      'Código de país não reconhecido. Confira o código ISO de 2 letras.',
    );
    expect(validarOcasiao({ ...camposDaOcasiao(original), pais: 'xx' }, ctx).erros.pais).toBeUndefined();
    // sem o contexto da edicao, a conferencia continua valendo (nova ocasiao)
    expect(validarOcasiao({ ...camposDaOcasiao(original) }, CTX).erros.pais).toBeDefined();
  });

  it('fonte removida (sem id) e escopo intacto: nao exige escolher fonte', () => {
    const original = oc({ scopeType: 'fonte', sourceId: null, source: null });
    const ctx = { ...CTX, escopoOriginal: 'fonte' as const, fonteOriginal: null };
    const r = validarOcasiao({ ...camposDaOcasiao(original), nome: 'NOME NOVO' }, ctx);
    expect(r.erros).toEqual({});
    expect(montarEdicao(original, r.valores!)).toEqual({ name: 'NOME NOVO' });
    // numa ocasiao nova, a fonte continua obrigatoria
    expect(validarOcasiao(campos({ escopo: 'fonte', fonte: '' }), CTX).erros.fonte).toBe('Informe a fonte do evento.');
  });
});
