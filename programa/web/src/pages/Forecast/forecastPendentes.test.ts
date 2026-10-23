import { describe, expect, it } from 'vitest';
import type { ForecastFonte } from '@/services/forecastFontes';
import type { ForecastProdutoCadastro } from '@/services/forecastPendentes';
import {
  contagemTexto,
  criterioTexto,
  filtrarProdutos,
  fontesAtivas,
  historicoAusenteTexto,
  lerLeadTime,
  mensagemCadastroGravado,
  mensagemCadastroNaPrevia,
  montarCorpoNovoProduto,
  nenhumPendenteTexto,
  normalizarCodigo,
  primeiroCampoComErro,
  produtoCheio,
  rotuloDaFonte,
  semLeadTime,
  semVendaRecenteTexto,
  situacaoTexto,
  soSaldoTexto,
  textoEntradaNoCalculo,
  textoForaDoCalculoPrevia,
  textoProdutoInativo,
  vagasTexto,
  validarNovoProduto,
  type FormNovoProduto,
} from './forecastPendentes';

// Dados 100% sinteticos.
const fonte = (over: Partial<ForecastFonte> = {}): ForecastFonte => ({
  id: 3,
  name: 'FONTE 001',
  leadTimeDays: 45,
  clearanceDays: null,
  isActive: true,
  ...over,
});

const form = (over: Partial<FormNovoProduto> = {}): FormNovoProduto => ({
  nome: 'PRODUTO 901',
  codigos: ['TST0901'],
  sourceId: 3,
  familyId: 4,
  leadTimeTexto: '',
  ...over,
});

const produto = (id: number, name: string, codes: string[]): ForecastProdutoCadastro => ({
  id,
  name,
  isActive: true,
  codes: codes.map((code, i) => ({ id: id * 10 + i, position: i + 1, code })),
});

describe('textos', () => {
  it('contagemTexto: singular e plural', () => {
    expect(contagemTexto(1, 'código', 'códigos')).toBe('1 código');
    expect(contagemTexto(0, 'código', 'códigos')).toBe('0 códigos');
    expect(contagemTexto(2, 'código', 'códigos')).toBe('2 códigos');
  });

  it('situacaoTexto', () => {
    expect(situacaoTexto({ situacao: 'sem_cadastro', produtoInativo: null })).toBe('Sem cadastro');
    expect(situacaoTexto({ situacao: 'produto_inativo', produtoInativo: { id: 1, nome: 'PRODUTO 001' } })).toBe(
      'Produto inativo',
    );
  });

  it('produto inativo: explica que e preciso reativar (com e sem o nome)', () => {
    expect(textoProdutoInativo('PRODUTO 009')).toBe(
      'O produto “PRODUTO 009” está inativo no cadastro. Reative o produto para o código voltar ao cálculo.',
    );
    expect(textoProdutoInativo(null)).toContain('Reative o produto');
  });

  it('textoEntradaNoCalculo cita a quinzena e quando o codigo entra', () => {
    expect(textoEntradaNoCalculo('10-2', 3)).toBe(
      'Esses códigos ficaram FORA do cálculo da quinzena 10-2. Depois de completar o cadastro, eles entram a partir da próxima quinzena importada.',
    );
  });

  it('textos fixos de "FORA do calculo": singular com 1 pendente, plural nos demais', () => {
    expect(textoEntradaNoCalculo('10-2', 1)).toBe(
      'Este código ficou FORA do cálculo da quinzena 10-2. Depois de completar o cadastro, ele entra a partir da próxima quinzena importada.',
    );
    expect(textoForaDoCalculoPrevia(1)).toBe(
      'Fica FORA do cálculo. Complete o cadastro e pré-visualize de novo para que entre nesta quinzena.',
    );
    expect(textoForaDoCalculoPrevia(2)).toBe(
      'Ficam FORA do cálculo. Complete o cadastro e pré-visualize de novo para que entrem nesta quinzena.',
    );
  });

  it('soSaldoTexto: so quando ha codigos; singular', () => {
    const kg = (n: number) => String(n);
    expect(soSaldoTexto({ codigos: 0, kg: 0 }, kg)).toBeNull();
    expect(soSaldoTexto({ codigos: 1, kg: 30 }, kg)).toBe('Só saldo (não listados): 1 código · 30 kg');
    expect(soSaldoTexto({ codigos: 5, kg: 300 }, kg)).toBe('Só saldo (não listados): 5 códigos · 300 kg');
  });

  it('criterioTexto: meses da regra, compra em aberto do FUP; sem regra (backend antigo) nao afirma nada', () => {
    const regra = { mesesVenda: ['2026-07', '2026-08', '2026-09'], historicoAusente: [], compras: 'fup_em_aberto' as const };
    expect(criterioTexto(regra)).toBe(
      'Entram na lista: venda em jul/2026, ago/2026 ou set/2026, programação pendente ou compra em aberto no FUP.',
    );
    expect(criterioTexto({ ...regra, compras: 'chegadas' })).toBe(
      'Entram na lista: venda em jul/2026, ago/2026 ou set/2026, programação pendente ou chegada prevista no FUP.',
    );
    expect(criterioTexto({ ...regra, mesesVenda: ['2026-12'] })).toContain('venda em dez/2026, programação');
    expect(criterioTexto(undefined)).toBeNull();
    expect(criterioTexto({ ...regra, mesesVenda: [] })).toBeNull();
  });

  it('semVendaRecenteTexto: so com codigos; singular; kg so quando ha venda anual', () => {
    const kg = (n: number) => String(n);
    expect(semVendaRecenteTexto(undefined, kg)).toBeNull();
    expect(semVendaRecenteTexto({ codigos: 0, vendasAnual: 0 }, kg)).toBeNull();
    expect(semVendaRecenteTexto({ codigos: 1, vendasAnual: 900 }, kg)).toBe(
      'Sem venda nos últimos 3 meses (não listados): 1 código · 900 kg de venda anual',
    );
    expect(semVendaRecenteTexto({ codigos: 12, vendasAnual: 0 }, kg)).toBe(
      'Sem venda nos últimos 3 meses (não listados): 12 códigos',
    );
  });

  it('historicoAusenteTexto: avisa que a lista pode estar incompleta', () => {
    const base = { mesesVenda: ['2026-07', '2026-08', '2026-09'], compras: 'fup_em_aberto' as const };
    expect(historicoAusenteTexto({ ...base, historicoAusente: [] })).toBeNull();
    expect(historicoAusenteTexto(undefined)).toBeNull();
    expect(historicoAusenteTexto({ ...base, historicoAusente: ['2026-08'] })).toBe(
      'Sem histórico de vendas gravado em ago/2026: a lista pode estar incompleta.',
    );
    expect(historicoAusenteTexto({ ...base, historicoAusente: ['2026-07', '2026-08'] })).toBe(
      'Sem histórico de vendas gravado em jul/2026 e ago/2026: a lista pode estar incompleta.',
    );
  });

  it('nenhumPendenteTexto: cita o criterio so quando o backend informa a regra', () => {
    const regra = { mesesVenda: ['2026-07', '2026-08', '2026-09'], historicoAusente: [], compras: 'fup_em_aberto' as const };
    expect(nenhumPendenteTexto(regra)).toBe(
      'Pendentes de cadastro: nenhum código com venda nos últimos 3 meses, programação ou compra em aberto no FUP fora do cadastro nesta quinzena.',
    );
    // Quinzena antiga (sem `comprasEmAberto`): o criterio cita a chegada prevista, como o criterioTexto.
    expect(nenhumPendenteTexto({ ...regra, compras: 'chegadas' })).toBe(
      'Pendentes de cadastro: nenhum código com venda nos últimos 3 meses, programação ou chegada prevista no FUP fora do cadastro nesta quinzena.',
    );
    expect(nenhumPendenteTexto(undefined)).toBe('Pendentes de cadastro: nenhum código fora do cadastro nesta quinzena.');
  });

  it('mensagens de gravacao: o aviso da planilha so vem para codigo em produto da planilha', () => {
    expect(mensagemCadastroGravado({ tipo: 'novo' })).toBe('Cadastro gravado.');
    expect(mensagemCadastroGravado({ tipo: 'codigo', produtoOrigem: 'dbcorp' })).toBe('Cadastro gravado.');
    expect(mensagemCadastroGravado({ tipo: 'codigo', produtoOrigem: 'planilha' })).toBe(
      'Cadastro gravado. Inclua o código também na planilha PO.COMP.01: o próximo import da planilha remove os códigos que não estão nela.',
    );
  });

  it('mensagemCadastroNaPrevia: 3 estados', () => {
    expect(mensagemCadastroNaPrevia({ tipo: 'novo' }, 'atualizando')).toBe(
      'Cadastro gravado. Atualizando a pré-visualização…',
    );
    expect(mensagemCadastroNaPrevia({ tipo: 'novo' }, 'atualizada')).toBe('Cadastro gravado. Pré-visualização atualizada.');
    expect(mensagemCadastroNaPrevia({ tipo: 'novo' }, 'falhou')).toBe(
      'Cadastro gravado. A pré-visualização anterior foi descartada: pré-visualize de novo para poder confirmar.',
    );
    expect(mensagemCadastroNaPrevia({ tipo: 'codigo', produtoOrigem: 'planilha' }, 'atualizada')).toContain(
      'Inclua o código também na planilha',
    );
  });
});

describe('fontes', () => {
  it('semLeadTime / rotuloDaFonte marcam a fonte sem lead time', () => {
    expect(semLeadTime(fonte({ leadTimeDays: null }))).toBe(true);
    expect(semLeadTime(fonte({ leadTimeDays: 0 }))).toBe(false);
    expect(rotuloDaFonte(fonte())).toBe('FONTE 001 · 45 dias');
    expect(rotuloDaFonte(fonte({ leadTimeDays: 1 }))).toBe('FONTE 001 · 1 dia');
    expect(rotuloDaFonte(fonte({ leadTimeDays: null }))).toBe('FONTE 001 · sem lead time');
  });

  it('fontesAtivas: filtra inativas e ordena por nome sem mutar a entrada', () => {
    const entrada = [fonte({ id: 2, name: 'Zeta' }), fonte({ id: 1, name: 'Alfa' }), fonte({ id: 3, name: 'X', isActive: false })];
    expect(fontesAtivas(entrada).map((f) => f.name)).toEqual(['Alfa', 'Zeta']);
    expect(entrada.map((f) => f.id)).toEqual([2, 1, 3]);
  });
});

describe('validarNovoProduto', () => {
  it('formulario valido: corpo com nome sem espacos duplos e codigos em maiusculas', () => {
    const r = validarNovoProduto(form({ nome: '  PRODUTO   901 ', codigos: [' tst0901 ', 'Tst0902', '  '] }), fonte());
    expect(r).toEqual({
      ok: true,
      corpo: { nome: 'PRODUTO 901', codigos: ['TST0901', 'TST0902'], sourceId: 3, familyId: 4 },
      leadTimeDias: null,
    });
  });

  it('tudo vazio: nome, codigos, fonte e familia obrigatorios (mensagens iguais as do backend)', () => {
    const r = validarNovoProduto(form({ nome: ' ', codigos: [' '], sourceId: null, familyId: null }), null);
    expect(r).toEqual({
      ok: false,
      erros: {
        nome: 'Informe o nome do produto.',
        codigos: 'Informe ao menos um código.',
        fonte: 'Escolha a fonte.',
        familia: 'Escolha a família.',
      },
    });
  });

  it('limites: nome > 200, codigo > 40, 8 codigos, codigo repetido apos maiusculas', () => {
    expect(validarNovoProduto(form({ nome: 'A'.repeat(201) }), fonte())).toMatchObject({
      ok: false,
      erros: { nome: 'O nome aceita no máximo 200 caracteres.' },
    });
    expect(validarNovoProduto(form({ codigos: ['A'.repeat(41)] }), fonte())).toMatchObject({
      ok: false,
      erros: { codigos: 'O código aceita no máximo 40 caracteres.' },
    });
    const oito = Array.from({ length: 8 }, (_, i) => `TST090${i}`);
    expect(validarNovoProduto(form({ codigos: oito }), fonte())).toMatchObject({
      ok: false,
      erros: { codigos: 'Informe no máximo 7 códigos.' },
    });
    expect(validarNovoProduto(form({ codigos: ['TST0901', 'tst0901'] }), fonte())).toMatchObject({
      ok: false,
      erros: { codigos: 'Código repetido na lista: TST0901.' },
    });
  });

  it('fonte sem lead time: exige inteiro 1..999 e devolve os dias a gravar na fonte', () => {
    const semLt = fonte({ leadTimeDays: null });
    for (const texto of ['', 'abc', '0', '1000', '4,5', '-3']) {
      expect(validarNovoProduto(form({ leadTimeTexto: texto }), semLt)).toMatchObject({
        ok: false,
        erros: { leadTime: 'Informe o lead time da fonte em dias (1 a 999).' },
      });
    }
    expect(validarNovoProduto(form({ leadTimeTexto: ' 45 ' }), semLt)).toMatchObject({ ok: true, leadTimeDias: 45 });
    expect(validarNovoProduto(form({ leadTimeTexto: '999' }), semLt)).toMatchObject({ ok: true, leadTimeDias: 999 });
    // Fonte com lead time: o campo nao existe, o texto digitado e ignorado.
    expect(validarNovoProduto(form({ leadTimeTexto: 'lixo' }), fonte())).toMatchObject({ ok: true, leadTimeDias: null });
  });

  it('codigo de produto inativo conhecido: avisa antes do 409 do backend', () => {
    const r = validarNovoProduto(form({ codigos: ['TST0901', 'TST0902'] }), fonte(), { TST0902: 'PRODUTO 009' });
    expect(r).toMatchObject({
      ok: false,
      erros: {
        codigos:
          'O código TST0902 pertence ao produto inativo “PRODUTO 009”. Reative o produto para o código voltar ao cálculo.',
      },
    });
  });

  it('montarCorpoNovoProduto e primeiroCampoComErro (ordem do formulario)', () => {
    expect(montarCorpoNovoProduto(form({ codigos: [' tst1 '] }))).toEqual({
      nome: 'PRODUTO 901',
      codigos: ['TST1'],
      sourceId: 3,
      familyId: 4,
    });
    expect(primeiroCampoComErro({})).toBeNull();
    expect(primeiroCampoComErro({ familia: 'x', fonte: 'y', nome: 'z' })).toBe('nome');
    expect(primeiroCampoComErro({ familia: 'x', leadTime: 'y' })).toBe('leadTime');
  });

  it('normalizarCodigo e lerLeadTime', () => {
    expect(normalizarCodigo('  ab1 ')).toBe('AB1');
    expect(lerLeadTime('12')).toBe(12);
    expect(lerLeadTime('0012')).toBeNull();
    expect(lerLeadTime('')).toBeNull();
  });
});

describe('produto existente', () => {
  const lista = [produto(1, 'Ácido Cítrico 001', ['TST0001', 'TST0002']), produto(2, 'PRODUTO 002', ['TST0003'])];

  it('filtrarProdutos: nome sem acento/caixa, codigo e termo vazio', () => {
    expect(filtrarProdutos(lista, '').map((p) => p.id)).toEqual([1, 2]);
    expect(filtrarProdutos(lista, 'acido citrico').map((p) => p.id)).toEqual([1]);
    expect(filtrarProdutos(lista, 'tst0003').map((p) => p.id)).toEqual([2]);
    expect(filtrarProdutos(lista, 'xyz')).toEqual([]);
  });

  it('vagasTexto e produtoCheio (limite de 7 codigos)', () => {
    expect(vagasTexto(lista[0] as ForecastProdutoCadastro)).toBe('2/7 códigos');
    expect(produtoCheio(lista[0] as ForecastProdutoCadastro)).toBe(false);
    const cheio = produto(3, 'PRODUTO 003', ['A', 'B', 'C', 'D', 'E', 'F', 'G']);
    expect(vagasTexto(cheio)).toBe('7/7 códigos');
    expect(produtoCheio(cheio)).toBe(true);
  });
});
