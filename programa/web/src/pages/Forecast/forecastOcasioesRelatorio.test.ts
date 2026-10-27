import { describe, expect, it } from 'vitest';
import {
  APOIO_OCASIOES,
  AVISO_ANTES_DE_HOJE,
  AVISO_COMPONENTES_AUSENTES,
  NOTA_OSCILOU,
  PARAGRAFO_OCASIOES,
  ROTULO_ESTIMATIVA,
  ROTULO_ETAPA_OCASIAO,
  TEXTO_OCASIOES_INDISPONIVEIS,
  ariaSeloOcasiao,
  resumoFontesSemPais,
  resumoOcasioes,
  resumoOcasioesAntesDeHoje,
  resumoSemFonteCadastrada,
  textoLeadTimeAjustado,
  textoMemoriaOcasioes,
  textoOcasiaoDaLista,
  textoOcasioesDoGrupo,
  textoSeloOcasiao,
} from './forecastOcasioesRelatorio';

describe('textos das ocasioes no relatorio de compras', () => {
  it('rotulos de etapa e estimativa', () => {
    expect(ROTULO_ETAPA_OCASIAO).toEqual({
      total: 'Lead time inteiro',
      prontidao: 'Prontidão',
      embarque: 'Embarque',
      transito: 'Trânsito',
      liberacao: 'Liberação',
    });
    expect(ROTULO_ESTIMATIVA).toBe('estimativa');
  });

  it('selo e aria: singular, plural e 0 dias', () => {
    expect(textoSeloOcasiao(5)).toBe('Ocasião: +5 d');
    expect(textoSeloOcasiao(0)).toBe('Ocasião: +0 d');
    expect(ariaSeloOcasiao(1)).toBe('Ocasião no lead time: 1 dia a mais (estimativa, só informa)');
    expect(ariaSeloOcasiao(5)).toBe('Ocasião no lead time: 5 dias a mais (estimativa, só informa)');
    expect(ariaSeloOcasiao(0)).toBe('Ocasião no lead time: 0 dias a mais (estimativa, só informa)');
  });

  it('ocasiao na lista, com o rotulo de cada etapa', () => {
    expect(textoOcasiaoDaLista({ nome: 'OCASIAO 001', dias: 5, etapa: 'total' })).toBe(
      'OCASIAO 001 · +5 d (Lead time inteiro)',
    );
    expect(textoOcasiaoDaLista({ nome: 'OCASIAO 002', dias: 0, etapa: 'prontidao' })).toBe(
      'OCASIAO 002 · +0 d (Prontidão)',
    );
    expect(textoOcasiaoDaLista({ nome: 'OCASIAO 003', dias: 2, etapa: 'liberacao' })).toBe(
      'OCASIAO 003 · +2 d (Liberação)',
    );
  });

  it('lead time ajustado', () => {
    expect(textoLeadTimeAjustado(30, 5)).toBe('30 + 5 = 35 dias');
    expect(textoLeadTimeAjustado(30, 0)).toBe('30 + 0 = 30 dias');
  });

  it('avisos, apoio e paragrafo', () => {
    expect(AVISO_ANTES_DE_HOJE).toBe('A ocasião antecipa a data-limite para antes de hoje.');
    expect(AVISO_COMPONENTES_AUSENTES).toBe(
      'Etapas da fonte não cadastradas (ou somam mais que o lead time): cada ocasião foi comparada com o lead time inteiro.',
    );
    expect(NOTA_OSCILOU).toBe('A estimativa não estabilizou: vale o maior acréscimo.');
    expect(TEXTO_OCASIOES_INDISPONIVEIS).toBe('Ocasiões do lead time indisponíveis agora: o relatório saiu sem elas.');
    expect(APOIO_OCASIOES).toContain('Estimativa; só informa (não muda data-limite, urgência nem quantidades).');
    expect(PARAGRAFO_OCASIOES).toContain('a folga da fonte fica no fim e não cruza ocasiões.');
    expect(PARAGRAFO_OCASIOES).toContain('As ocasiões vêm do cadastro atual (não ficam congeladas na quinzena).');
  });

  it('resumo: 0, 1 e n', () => {
    expect(resumoOcasioes(0)).toBe('Nenhum item cruza as ocasiões cadastradas');
    expect(resumoOcasioes(1)).toBe('1 item com ocasião no lead time (estimativa)');
    expect(resumoOcasioes(7)).toBe('7 itens com ocasião no lead time (estimativa)');
    expect(resumoOcasioesAntesDeHoje(1)).toBe('1 item com a data-limite ajustada já vencida');
    expect(resumoOcasioesAntesDeHoje(3)).toBe('3 itens com a data-limite ajustada já vencida');
    expect(resumoSemFonteCadastrada(1)).toBe('1 item com fonte fora do cadastro de lead time: ocasiões não avaliadas');
    expect(resumoSemFonteCadastrada(2)).toBe('2 itens com fonte fora do cadastro de lead time: ocasiões não avaliadas');
    expect(resumoFontesSemPais(1)).toBe('1 fonte sem país: ocasiões por país não as alcançam');
    expect(resumoFontesSemPais(4)).toBe('4 fontes sem país: ocasiões por país não as alcançam');
  });

  it('cabecalho do grupo', () => {
    expect(textoOcasioesDoGrupo({ ocasioes: [{ nome: 'OCASIAO 001' }], itensAfetados: 1 })).toBe(
      'Ocasiões: OCASIAO 001 · 1 item',
    );
    expect(
      textoOcasioesDoGrupo({ ocasioes: [{ nome: 'OCASIAO 001' }, { nome: 'OCASIAO 002' }], itensAfetados: 3 }),
    ).toBe('Ocasiões: OCASIAO 001, OCASIAO 002 · 3 itens');
  });

  it('memoria de calculo: data em dd/mm/aaaa, dia no singular e no plural', () => {
    expect(
      textoMemoriaOcasioes({
        chegadaEstimada: '2026-11-24',
        extraDias: 5,
        ocasioes: [{ nome: 'OCASIAO 001' }, { nome: 'OCASIAO 002' }],
      }),
    ).toBe('Com ocasiões: chega em 24/11/2026 (+5 dias: OCASIAO 001, OCASIAO 002)');
    expect(
      textoMemoriaOcasioes({ chegadaEstimada: '2026-11-20', extraDias: 1, ocasioes: [{ nome: 'OCASIAO 001' }] }),
    ).toBe('Com ocasiões: chega em 20/11/2026 (+1 dia: OCASIAO 001)');
  });
});
