import { describe, expect, it } from 'vitest';
import type { ForecastItemRelatorio, ForecastRelatorioCompras, ForecastUrgencia } from '@/services/forecast';
import {
  APOIO_SEM_CONSUMO,
  URGENCIAS,
  badgeDaUrgencia,
  filtrosVisiveis,
  gruposFiltrados,
  itensPorUrgencia,
  paragrafoSemConsumo,
  paragrafoUrgencia,
  resumoDeUrgencia,
  resumoSemConsumo,
  rotuloUrgencia,
  temSemConsumo,
  temUrgencia,
  textoDiasAteRuptura,
  textoMostrando,
  textoMotivos,
  tituloSemConsumo,
} from './forecastRelatorioUrgencia';

// Dados 100% sinteticos.
function item(linha: number, urgencia: ForecastUrgencia, posicaoUrgencia: number, over: Partial<ForecastItemRelatorio> = {}) {
  return {
    linha,
    n: linha,
    item: `PRODUTO ${String(linha).padStart(3, '0')}`,
    codigos: [`C${String(linha).padStart(4, '0')}`],
    status: 'nao',
    demanda: -10,
    quantidadeSugerida: 10,
    embalagem: { usada: null, cadastradas: [], multiplas: false },
    quantidadeEmbalagens: null,
    quantidadeFinal: 10,
    naoFraciona: false,
    ruptura: null,
    dataLimite: null,
    vencida: false,
    leadTimeDias: 30,
    emAndamento: { chegadas: [], programacoes: [] },
    urgencia,
    diasAteRuptura: null,
    posicaoUrgencia,
    ...over,
  } as ForecastItemRelatorio;
}

function relatorio(): ForecastRelatorioCompras {
  const a = item(1, 'sem-estoque', 0, { vencida: true, dataLimite: '2026-09-15' });
  const b = item(2, 'critico', 1);
  const c = item(3, 'atrasado', 2, { vencida: true, dataLimite: '2026-10-01' });
  const d = item(4, 'no-prazo', 3, { dataLimite: '2026-12-01' });
  return {
    quinzena: { id: 7, label: '10-2', baseDate: '2026-10-15', half: 2, origin: 'planilha', hoje: '2026-10-20' },
    totais: {
      itens: 4,
      fontes: 2,
      vencidas: 2,
      semEmbalagem: 4,
      multiplasEmbalagens: 0,
      porUrgencia: { 'sem-estoque': 1, critico: 1, atrasado: 1, 'no-prazo': 1 },
    },
    fora: { semLeadTime: 0, semConsumoSemFalta: 0, semConsumoSemMovimento: 0 },
    urgencia: { diasCritico: 15 },
    semConsumo: { itens: [] },
    grupos: [
      { fonte: 'FONTE 001', leadTimeDias: 30, dataLimiteMaisUrgente: '2026-09-15', vencidas: 2, itens: [a, c] },
      { fonte: 'FONTE 002', leadTimeDias: 30, dataLimiteMaisUrgente: '2026-12-01', vencidas: 0, itens: [d, b] },
    ],
  };
}

describe('textos da urgencia', () => {
  it('rotulos das 4 faixas e ordem de prioridade', () => {
    expect(URGENCIAS).toEqual(['sem-estoque', 'critico', 'atrasado', 'no-prazo']);
    expect(URGENCIAS.map((u) => rotuloUrgencia(u, 15))).toEqual([
      'Sem estoque agora',
      'Ruptura em até 15 dias',
      'Atrasado',
      'No prazo',
    ]);
    expect(rotuloUrgencia('critico', 7)).toBe('Ruptura em até 7 dias');
  });

  it('resumo: plural de atrasado e N = 0 some com o trecho da ruptura', () => {
    expect(resumoDeUrgencia({ 'sem-estoque': 29, critico: 23, atrasado: 39, 'no-prazo': 6 }, 15)).toBe(
      'Urgência: 29 sem estoque agora · 23 com ruptura em até 15 dias · 39 atrasados · 6 no prazo',
    );
    expect(resumoDeUrgencia({ 'sem-estoque': 1, critico: 1, atrasado: 1, 'no-prazo': 1 }, 15)).toBe(
      'Urgência: 1 sem estoque agora · 1 com ruptura em até 15 dias · 1 atrasado · 1 no prazo',
    );
    expect(resumoDeUrgencia({ 'sem-estoque': 2, critico: 0, atrasado: 3, 'no-prazo': 0 }, 0)).toBe(
      'Urgência: 2 sem estoque agora · 3 atrasados · 0 no prazo',
    );
  });

  it('regra da urgencia: com e sem a faixa critica', () => {
    expect(paragrafoUrgencia(15)).toBe(
      'Urgência: "Sem estoque agora" = a ruptura cai na data-base ou já passou na data de hoje; "Ruptura em até 15 dias" = ainda há estoque e a ruptura estimada cai nos próximos 15 dias; "Atrasado" = a data-limite do pedido já passou; "No prazo" = o restante, inclusive sem ruptura em 6 meses. A lista segue essa ordem e, dentro de cada faixa, os dias até a ruptura e depois a data-limite.',
    );
    expect(paragrafoUrgencia(0)).not.toContain('Ruptura em até');
    expect(paragrafoUrgencia(0)).toContain('"Sem estoque agora" = a ruptura cai na data-base ou já passou na data de hoje; "Atrasado"');
  });

  it('dias ate a ruptura', () => {
    expect(textoDiasAteRuptura(null)).toBe('—');
    expect(textoDiasAteRuptura(undefined)).toBe('—');
    expect(textoDiasAteRuptura(0)).toBe('ruptura hoje');
    expect(textoDiasAteRuptura(1)).toBe('ruptura em 1 dia');
    expect(textoDiasAteRuptura(12)).toBe('ruptura em 12 dias');
    expect(textoDiasAteRuptura(-1)).toBe('ruptura há 1 dia');
    expect(textoDiasAteRuptura(-5)).toBe('ruptura há 5 dias');
  });

  it('badge: vermelho so nas 2 criticas, neutro nas outras', () => {
    expect(badgeDaUrgencia('sem-estoque')).toBe('badge badge--danger');
    expect(badgeDaUrgencia('critico')).toBe('badge badge--danger');
    expect(badgeDaUrgencia('atrasado')).toBe('badge badge--muted');
    expect(badgeDaUrgencia('no-prazo')).toBe('badge badge--muted');
  });
});

describe('textos do sem consumo', () => {
  it('motivos, resumo, regra, titulo e apoio', () => {
    expect(textoMotivos(['estoque'])).toBe('tem estoque');
    expect(textoMotivos(['programacao'])).toBe('tem programação');
    expect(textoMotivos(['programacao', 'estoque'])).toBe('tem programação · tem estoque');
    expect(resumoSemConsumo(50, 46)).toBe(
      'Sem consumo: 50 em atenção (com estoque ou programação, fora da lista de compra) · 46 sem estoque nem programação',
    );
    expect(paragrafoSemConsumo()).toBe(
      'Atenção: sem consumo = média trimestral zero, fora da lista de compra, mas com estoque ou programação. Aparece só para conferência, sem quantidade sugerida. Itens sem consumo, estoque nem programação ficam fora e só entram na contagem.',
    );
    expect(tituloSemConsumo(1)).toBe('Atenção: sem consumo · 1 item');
    expect(tituloSemConsumo(2)).toBe('Atenção: sem consumo · 2 itens');
    expect(APOIO_SEM_CONSUMO).toBe(
      'Não entram na lista de compra: sem consumo nos últimos 3 meses, mas com estoque ou programação.',
    );
  });
});

describe('ordem e filtro', () => {
  it('itensPorUrgencia achata os grupos na ordem global e filtra por faixa', () => {
    const r = relatorio();
    expect(itensPorUrgencia(r, 'todas').map((x) => [x.item.item, x.fonte])).toEqual([
      ['PRODUTO 001', 'FONTE 001'],
      ['PRODUTO 002', 'FONTE 002'],
      ['PRODUTO 003', 'FONTE 001'],
      ['PRODUTO 004', 'FONTE 002'],
    ]);
    expect(itensPorUrgencia(r, 'atrasado').map((x) => x.item.item)).toEqual(['PRODUTO 003']);
    expect(itensPorUrgencia(r, 'no-prazo')).toHaveLength(1);
  });

  it('gruposFiltrados remove o grupo que fica vazio e acompanha as contagens do grupo ao filtro', () => {
    const r = relatorio();
    expect(gruposFiltrados(r, 'todas')).toBe(r.grupos);
    const criticos = gruposFiltrados(r, 'critico');
    expect(criticos.map((g) => g.fonte)).toEqual(['FONTE 002']);
    expect(criticos[0]!.itens.map((i) => i.item)).toEqual(['PRODUTO 002']);
    expect(criticos[0]!.vencidas).toBe(0);
    expect(criticos[0]!.dataLimiteMaisUrgente).toBeNull();
    const atrasados = gruposFiltrados(r, 'atrasado');
    expect(atrasados).toHaveLength(1);
    expect(atrasados[0]!.vencidas).toBe(1);
    expect(atrasados[0]!.dataLimiteMaisUrgente).toBe('2026-10-01');
    expect(atrasados[0]!.porUrgencia).toEqual({ 'sem-estoque': 0, critico: 0, atrasado: 1, 'no-prazo': 0 });
    expect(gruposFiltrados({ ...r, grupos: [] }, 'critico')).toEqual([]);
  });

  it('filtrosVisiveis: N = 0 esconde a faixa critica', () => {
    expect(filtrosVisiveis(15)).toEqual(['sem-estoque', 'critico', 'atrasado', 'no-prazo']);
    expect(filtrosVisiveis(0)).toEqual(['sem-estoque', 'atrasado', 'no-prazo']);
  });

  it('linha "Mostrando"', () => {
    expect(textoMostrando(4, 4, 'todas', 'urgencia', 15)).toBe('Mostrando 4 de 4 itens · todas as faixas · por urgência');
    expect(textoMostrando(1, 4, 'atrasado', 'urgencia', 15)).toBe('Mostrando 1 de 4 itens · Atrasado · por urgência');
    expect(textoMostrando(1, 1, 'critico', 'fonte', 15)).toBe('Mostrando 1 de 1 item · Ruptura em até 15 dias · por fonte');
  });
});

describe('payload de backend antigo (modo legado)', () => {
  it('temUrgencia e temSemConsumo ficam falsos sem os campos novos e verdadeiros com eles', () => {
    const novo = relatorio();
    expect(temUrgencia(novo)).toBe(true);
    expect(temSemConsumo(novo)).toBe(true);
    const { urgencia: _u, semConsumo: _s, ...resto } = novo;
    const antigo = {
      ...resto,
      totais: { itens: 4, fontes: 2, vencidas: 2, semEmbalagem: 4, multiplasEmbalagens: 0 },
      fora: { semLeadTime: 0, semConsumoSemFalta: 0 },
    } as ForecastRelatorioCompras;
    expect(temUrgencia(antigo)).toBe(false);
    expect(temSemConsumo(antigo)).toBe(false);
  });
});
