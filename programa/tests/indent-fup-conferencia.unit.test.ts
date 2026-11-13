// Conferencia da FUP Indent: cruzamento com cadastros e de-para, plano, vinculos por janela, reconciliacao e relatorio.
// Fixture 100% SINTETICA (tests/helpers/indentFupFixture.ts); nenhum dado real.
import ExcelJS from 'exceljs';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  DATA_REFERENCIA_FIXTURE,
  LINHAS_SINTETICAS,
  esperadoPorMes,
  montarFupSintetica,
  type OpcoesFup,
} from './helpers/indentFupFixture';
import {
  type Cadastros,
  type Conferencia,
  type EntradaDePara,
  conferir,
  reconciliar,
} from '../src/utils/indentFupConferencia';
import { MOTIVO_COMPOSTO, MOTIVO_QUANTIDADE } from '../src/utils/indentFupNormalize';
import { type FupArquivo, lerFupDeWorkbook } from '../src/utils/indentFupParse';
import {
  ABA_DEPARA,
  lerDeParaDeWorkbook,
  montarDryRun,
  montarRelatorioConferencia,
  montarRelatorioReconciliacao,
} from '../src/utils/indentFupRelatorio';

const idx = (n: number): number => n - 1; // spec n (1-based) -> indice em `linhas`

async function fupDe(opcoes: OpcoesFup = {}): Promise<FupArquivo> {
  return lerFupDeWorkbook(await montarFupSintetica(opcoes));
}
function conferirComum(
  fup: FupArquivo,
  extra: { cadastros?: Cadastros; dePara?: EntradaDePara[]; janelaMeses?: number } = {},
): Conferencia {
  return conferir({ linhas: fup.linhas, dash: fup.dash, dataReferencia: DATA_REFERENCIA_FIXTURE, ...extra });
}

let fup: FupArquivo;
let conf: Conferencia;
beforeAll(async () => {
  fup = await fupDe();
  conf = conferirComum(fup);
});

describe('rejeicoes e plano', () => {
  it('rejeita so o que o plano manda, com o motivo certo', () => {
    const motivos = (n: number): string[] => conf.linhas[idx(n)].motivos;
    expect(motivos(6)).toEqual([MOTIVO_COMPOSTO]);
    for (const n of [11, 12, 13]) expect(motivos(n)).toEqual([MOTIVO_QUANTIDADE]);
    expect(motivos(25)).toEqual(['DATA PO inválida ou ausente']);
    expect(motivos(26)).toEqual(['DATA PO inválida ou ausente']);
    expect(motivos(33)).toEqual(['fornecedor ausente']);
    expect(motivos(34)).toEqual(['cliente ausente']);
    expect(motivos(35)).toEqual(['PO ausente']);
    expect(motivos(36)).toEqual(['produto ausente']);
    expect(conf.resumo.linhasRejeitadas).toBe(12);
    expect(conf.resumo.linhasAceitas).toBe(LINHAS_SINTETICAS.length - 12);
    expect(conf.plano.rejeicoesPorMotivo).toMatchObject({
      [MOTIVO_COMPOSTO]: 1,
      [MOTIVO_QUANTIDADE]: 4,
      'DATA PO inválida ou ausente': 3,
    });
  });

  it('plano em H1: tudo que passa seria criado; historico so contado, sem atualizar', () => {
    expect(conf.plano.fornecedores).toEqual({ criar: 3, usar: 0 });
    expect(conf.plano.clientes).toEqual({ criar: 3, usar: 0 });
    expect(conf.plano.produtos).toEqual({ criar: 13, usar: 0 });
    expect(conf.plano.historico).toMatchObject({ linhas: 39, rejeitadas: 12, amostras: 1, atualizadas: 0, semMudanca: 0 });
    expect(conf.plano.historico.pedidos).toBeGreaterThan(0);
  });

  it('fornecedores: variantes viram um so, fabrica vira atributo, composto fica de fora', () => {
    expect(conf.resumo.fornecedoresTextos).toBe(8); // inclui o texto que so aparece em linha rejeitada
    expect(conf.resumo.fornecedoresDepois).toBe(3);
    expect(conf.resumo.fornecedoresAgrupados).toBe(3);
    expect(conf.resumo.fornecedoresCompostos).toBe(1);
    const alfa = conf.cadastros.FORNECEDOR.find((c) => c.nome === 'FORN ALFA');
    expect(alfa?.plants).toEqual(['FAB 1', 'FAB 2']);
    expect(alfa?.textos).toBe(3);
    const beta = conf.cadastros.FORNECEDOR.find((c) => c.nome === 'FORN BETA');
    expect(beta?.plants).toEqual(['2']);
  });

  it('caixa/acento/espacos: mesma chave de cliente; quase-duplicata de produto listada e nao agrupada', () => {
    expect(conf.cadastros.CLIENTE.map((c) => c.nome).sort()).toEqual(['CLIENTE DOIS', 'CLIENTE TRES', 'CLIENTE UM']);
    expect(conf.itens.CLIENTE.find((i) => i.texto === 'cliente  úm')?.resolvido?.ref).toBe(
      conf.itens.CLIENTE.find((i) => i.texto === 'CLIENTE UM')?.resolvido?.ref,
    );
    const nomes = conf.cadastros.PRODUTO.map((c) => c.nome);
    expect(nomes).toContain('PRODUTO X-100');
    expect(nomes).toContain('PRODUTO X 100');
    const grupo = conf.quaseDuplicidades.filter((q) => q.kind === 'PRODUTO' && q.tipo === 'MESMA_CHAVE_APROXIMADA');
    expect(grupo.map((q) => q.texto).sort()).toEqual(['PRODUTO X 100', 'PRODUTO X-100']);
    expect(new Set(grupo.map((q) => q.grupo)).size).toBe(1);
  });

  it('NCM: produto com dois NCMs validos e conflito; invalido e hifen nao contam', () => {
    const x = conf.produtosNcm.find((p) => p.nome === 'PRODUTO X-100');
    expect(x?.conflito).toBe(true);
    expect(x?.ncms.map((n) => n.ncm).sort()).toEqual(['11112233', '99998877']);
    expect(conf.produtosNcm.find((p) => p.nome === 'PRODUTO N-700')).toBeUndefined();
    expect(conf.resumo.produtosNcmMultiplo).toBe(1);
  });

  it('linha rejeitada nunca cria cadastro nem vinculo (entidades exclusivas da rejeitada)', () => {
    const exclusivos = ['FORN SO REJEITADA', 'CLIENTE SO REJEITADO', 'PRODUTO SO REJEITADO', 'PRODUTO SO REJEITADO 2'];
    expect(conf.linhas[idx(50)].motivos).toEqual([MOTIVO_QUANTIDADE]);
    expect(conf.linhas[idx(51)].motivos).toEqual(['DATA PO inválida ou ausente']);
    const nomes = [
      ...conf.cadastros.FORNECEDOR,
      ...conf.cadastros.CLIENTE,
      ...conf.cadastros.PRODUTO,
    ].map((c) => c.nome);
    for (const e of exclusivos) {
      expect(nomes, e).not.toContain(e);
      expect(conf.paresFornecedorProduto.some((p) => p.fornecedor === e || p.produto === e), e).toBe(false);
      expect(conf.paresClienteFornecedor.some((p) => p.fornecedor === e || p.cliente === e), e).toBe(false);
    }
    // Os numeros do plano nao mudaram por causa delas.
    expect(conf.plano.fornecedores.criar).toBe(3);
    expect(conf.plano.clientes.criar).toBe(3);
    expect(conf.plano.produtos.criar).toBe(13);
    expect(conf.plano.vinculos.entram + conf.plano.vinculos.jaExistem + conf.plano.vinculos.foraDaJanela).toBe(
      conf.paresFornecedorProduto.length,
    );
    // Mas aparecem na aba de textos/de-para (o Lucas precisa ver o que foi rejeitado).
    expect(conf.itens.FORNECEDOR.some((i) => i.texto === 'FORN SO REJEITADA')).toBe(true);
  });

  it('chaves: PO + produto repetido ganha ordinal; mesmo PO com clientes diferentes gera ordens diferentes', () => {
    expect(conf.linhas[idx(16)].lineKey).toBe('produto w-400#1');
    expect(conf.linhas[idx(17)].lineKey).toBe('produto w-400#2');
    expect(conf.linhas[idx(16)].orderKey).toBe(conf.linhas[idx(17)].orderKey);
    expect(conf.linhas[idx(14)].orderKey).not.toBe(conf.linhas[idx(15)].orderKey);
    expect(conf.linhas[idx(14)].alertas).toContain('PO repetido em combinações diferentes');
    expect(conf.linhas[idx(15)].alertas).toContain('PO repetido em combinações diferentes');
  });
});

describe('normalizacao por linha e alertas', () => {
  const l = (n: number) => conf.linhas[idx(n)];

  it('numeros: ponto flutuante, preco 0 x preco vazio', () => {
    expect(l(27).quantidadeKg).toBe(3280);
    expect(l(9).precoFornecedor).toBe(0);
    expect(l(9).alertas).not.toContain('preço do fornecedor ausente');
    expect(l(10).precoFornecedor).toBeNull();
    expect(l(10).alertas).toContain('preço do fornecedor ausente');
  });

  it('datas: texto invalido vira null + datesRaw + alerta; hifen sem alerta; texto valido vira data', () => {
    expect(l(21).eta).toBeNull();
    expect(l(21).datesRaw).toEqual({ eta: '31/11/24' });
    expect(l(21).alertas).toContain('data inválida: ETA');
    expect(l(22).eta).toBeNull();
    expect(l(22).alertas.filter((a) => a.includes('ETA'))).toEqual([]);
    expect(l(22).etd).toBe('2025-02-05');
    expect(l(23).alertas).toContain('data inválida: ETD');
    expect(l(24).alertas).toContain('data inválida: DUE DATE');
    expect(l(24).closing).toBe('2025-01-10');
    expect(l(19).dataPo).toBe('2024-12-31');
  });

  it('alertas de coerencia, SUBTOTAL J*I e NCM', () => {
    expect(l(43).alertas).toContain('ano da DATA PO difere do AA do PO');
    expect(l(44).alertas).toEqual(expect.arrayContaining(['ETD anterior à DATA PO', 'ETA anterior ao ETD']));
    expect(l(29).alertas).toContain('SUBTOTAL calculado com o preço do fornecedor');
    expect(l(30).alertas).toContain('NCM inválido');
    expect(l(30).ncm.ncm).toBeNull();
    expect(l(31).alertas).not.toContain('NCM inválido');
  });

  it('comissao nunca vira alerta por linha (formula sem resultado so no perfil)', () => {
    expect(l(28).alertas.some((a) => /comiss/i.test(a))).toBe(false);
    expect(conf.alertas.some((a) => /comiss/i.test(a.alerta))).toBe(false);
  });

  it('incoterm, origem, destino, pagamento e amostra', () => {
    expect(l(1).incoterm).toMatchObject({ incoterm: 'CFR', local: 'SANTOS' });
    expect(l(37).incoterm).toMatchObject({ incoterm: 'FOB', local: 'SHANGHAI' });
    expect(l(38).incoterm).toMatchObject({ incoterm: 'DAP', local: 'LOCAL Z' });
    expect(l(38).alertas).toContain('incoterm não estava no início do texto');
    expect(l(39).incoterm.incoterm).toBeNull();
    expect(l(39).alertas).toContain('incoterm não reconhecido');
    expect(l(2).origem).toMatchObject({ pais: 'TAIWAN', detalhe: 'LUZHU' });
    expect(l(40).origem).toMatchObject({ pais: 'CHINA', detalhe: 'NINGBO' });
    expect(l(40).destino.destino).toBe('ITAJAI');
    expect(l(42).alertas).toContain('origem não reconhecida');
    expect(l(41).pagamento).toMatchObject({ dias: 0, base: 'ADVANCE' });
    expect(l(41).destino.destino).toBe('CALLAO');
    expect(l(1).pagamento).toMatchObject({ dias: 90, base: 'B/L DATE' });
    expect(l(18).isSample).toBe(true);
    expect(l(1).isSample).toBe(false);
  });

  it('tabelas de normalizacao trazem texto -> valor e contagem', () => {
    const f = conf.normalizacao.incoterm.find((i) => i.texto === 'FCL - CFR SANTOS');
    expect(f?.valor).toBe('CFR / SANTOS');
    expect(f?.linhas).toBeGreaterThan(1);
    expect(conf.alertasPorTipo['SUBTOTAL calculado com o preço do fornecedor']).toBe(1);
  });
});

describe('de-para', () => {
  const dp = (kind: EntradaDePara['kind'], texto: string, decisao: string, plant = ''): EntradaDePara => ({
    kind,
    texto,
    decisao,
    plant,
  });

  it('composto com CRIAR: fornecedor = antes da barra, fabrica = depois; sem decisao continua rejeitado', () => {
    const c = conferirComum(fup, { dePara: [dp('FORNECEDOR', 'FORN GAMA/FORN DELTA', 'CRIAR')] });
    const l = c.linhas[idx(6)];
    expect(l.rejeitada).toBe(false);
    expect(l.fornecedor).toMatchObject({ nome: 'FORN GAMA', plant: 'FORN DELTA', acao: 'CRIAR' });
    expect(conf.linhas[idx(6)].rejeitada).toBe(true);
  });

  it('plant do de-para tem prioridade; AGRUPAR resolve para o alvo', () => {
    const c = conferirComum(fup, {
      dePara: [
        dp('FORNECEDOR', 'FORN GAMA/FORN DELTA', 'AGRUPAR:FORN ALFA', 'FAB 9'),
        dp('FORNECEDOR', 'FORN LIM', 'AGRUPAR:FORN BETA'),
      ],
    });
    expect(c.linhas[idx(6)].fornecedor).toMatchObject({ nome: 'FORN ALFA', plant: 'FAB 9' });
    expect(c.linhas[idx(46)].fornecedor?.nome).toBe('FORN BETA');
    expect(c.cadastros.FORNECEDOR.map((x) => x.nome).sort()).toEqual(['FORN ALFA', 'FORN BETA']);
  });

  it('IGNORAR rejeita a linha; USAR com id inexistente, decisao invalida e AGRUPAR circular tambem', () => {
    const c = conferirComum(fup, {
      dePara: [
        dp('PRODUTO', 'PRODUTO S-500', 'IGNORAR'),
        dp('PRODUTO', 'PRODUTO Z-300', 'USAR:99'),
        dp('PRODUTO', 'PRODUTO F-600', 'TALVEZ'),
        dp('FORNECEDOR', 'FORN LIM', 'AGRUPAR:FORN LIM'),
      ],
    });
    expect(c.linhas[idx(18)].motivos).toEqual(['produto ignorado no de-para']);
    expect(c.linhas[idx(9)].motivos).toEqual(['de-para aponta para cadastro inexistente']);
    expect(c.linhas[idx(27)].motivos).toEqual(['decisão do de-para inválida']);
    expect(c.linhas[idx(46)].motivos).toEqual(['de-para AGRUPAR circular']);
  });

  it('cadastros existentes: casa por chave (USAR) e por id; pares com regra do cliente', () => {
    const cadastros: Cadastros = {
      fornecedores: [
        { id: 5, name: 'Forn Alfa Cadastrado', nameKey: 'forn alfa' },
        { id: 6, name: 'FORN ZETA', nameKey: 'forn zeta' },
      ],
      clientes: [{ id: 1, name: 'cliente um', supplierRuleMode: 'APROVADOS' }],
      produtos: [{ id: 8, name: 'PRODUTO Q-999', nameKey: 'produto q-999' }],
      vinculos: [],
      regras: [{ clientId: 1, supplierId: 6 }],
    };
    const c = conferirComum(fup, { cadastros, dePara: [dp('PRODUTO', 'PRODUTO Z-300', 'USAR:8')] });
    expect(c.plano.fornecedores).toEqual({ criar: 2, usar: 1 });
    expect(c.plano.clientes).toEqual({ criar: 2, usar: 1 });
    expect(c.linhas[0].fornecedor).toMatchObject({ acao: 'USAR', id: 5, nome: 'Forn Alfa Cadastrado' });
    expect(c.linhas[idx(9)].produto).toMatchObject({ acao: 'USAR', id: 8 });
    const compradoFora = c.paresClienteFornecedor.find((p) => p.fornecedor === 'Forn Alfa Cadastrado' && p.cliente === 'cliente um');
    expect(compradoFora?.situacao).toBe('comprado fora da lista APROVADOS');
    const semCompra = c.paresClienteFornecedor.find((p) => p.fornecedor === 'FORN ZETA');
    expect(semCompra).toMatchObject({ linhas: 0, situacao: 'aprovado sem compra' });
  });

  it('quase-duplicata contra cadastro existente (mesma chave aproximada)', () => {
    const c = conferirComum(fup, {
      cadastros: {
        fornecedores: [],
        clientes: [{ id: 3, name: 'Cliente-Um.' }],
        produtos: [],
        vinculos: [],
        regras: [],
      },
    });
    const g = c.quaseDuplicidades.filter((q) => q.kind === 'CLIENTE');
    expect(g.some((q) => q.origem === 'CADASTRO' && q.texto === 'Cliente-Um.')).toBe(true);
  });
});

describe('vinculos fornecedor-produto por janela (D9)', () => {
  const par = (c: Conferencia, produto: string) =>
    c.paresFornecedorProduto.find((p) => p.fornecedor === 'FORN LIM' && p.produto === produto);

  it('referencia 2026-11-13, 24 meses: o limite 2024-11-13 entra e 2024-11-12 fica fora', () => {
    expect(conf.janela).toEqual({ start: '2024-11-13', end: '2026-11-13', months: 24 });
    expect(par(conf, 'PRODUTO L-1')).toMatchObject({ situacao: 'ENTRA', ultimaDataPo: '2024-11-13' });
    expect(par(conf, 'PRODUTO L-2')).toMatchObject({ situacao: 'FORA DA JANELA', ultimaDataPo: '2024-11-12' });
    expect(par(conf, 'PRODUTO L-3')?.situacao).toBe('ENTRA');
    expect(par(conf, 'PRODUTO L-4')?.situacao).toBe('ENTRA');
  });

  it('janela de 12 meses muda a contagem (limite 2025-11-13)', () => {
    const c12 = conferirComum(fup, { janelaMeses: 12 });
    expect(c12.janela.start).toBe('2025-11-13');
    expect(par(c12, 'PRODUTO L-1')?.situacao).toBe('FORA DA JANELA');
    expect(par(c12, 'PRODUTO L-2')?.situacao).toBe('FORA DA JANELA');
    expect(par(c12, 'PRODUTO L-3')?.situacao).toBe('ENTRA');
    expect(par(c12, 'PRODUTO L-4')?.situacao).toBe('FORA DA JANELA');
    expect(c12.plano.vinculos.entram).toBeLessThan(conf.plano.vinculos.entram);
    expect(c12.plano.vinculos.foraDaJanela).toBeGreaterThan(conf.plano.vinculos.foraDaJanela);
  });

  it('vinculo ja existente e JA EXISTE mesmo antigo; a linha antiga continua no historico', () => {
    const c = conferirComum(fup, {
      cadastros: {
        fornecedores: [{ id: 1, name: 'FORN LIM', nameKey: 'forn lim' }],
        clientes: [],
        produtos: [{ id: 2, name: 'PRODUTO L-2', nameKey: 'produto l-2' }],
        vinculos: [{ supplierId: 1, productId: 2 }],
        regras: [],
      },
    });
    expect(par(c, 'PRODUTO L-2')?.situacao).toBe('JA EXISTE');
    expect(c.linhas[idx(47)].rejeitada).toBe(false);
    expect(c.plano.vinculos.jaExistem).toBe(1);
  });

  it('totais fecham: entram + ja existem + fora da janela = pares', () => {
    const v = conf.plano.vinculos;
    expect(v.entram + v.jaExistem + v.foraDaJanela).toBe(conf.paresFornecedorProduto.length);
    expect(v.jaExistem).toBe(0);
    // Par so com compras antigas (2024-02) fica fora; par com compra recente entra.
    const antigo = conf.paresFornecedorProduto.find((p) => p.fornecedor === 'FORN BETA' && p.produto === 'PRODUTO Y-200');
    expect(antigo?.situacao).toBe('FORA DA JANELA');
  });

  it('referencia invalida: erro (a CLI valida antes)', () => {
    expect(() => conferir({ linhas: fup.linhas, dash: null, dataReferencia: '2026-02-30' })).toThrow();
  });
});

describe('reconciliacao planilha x DASH', () => {
  it('soma por ano-mes de volume, faturamento e comissao da fixture = DASH sintetico', () => {
    const rec = conf.reconciliacao;
    expect(rec).not.toBeNull();
    expect(rec?.ok).toBe(true);
    const esperado = esperadoPorMes();
    for (const m of rec?.meses ?? []) {
      const e = esperado[`${m.ano}-${String(m.mes).padStart(2, '0')}`] ?? { comissao: 0, faturamento: 0, volume: 0 };
      expect(m.planilha.faturamento).toBeCloseTo(e.faturamento, 6);
      expect(m.planilha.volume).toBeCloseTo(e.volume, 6);
      expect(m.planilha.comissao).toBeCloseTo(e.comissao, 6);
      expect(m.status).toBe('OK');
    }
    expect(rec?.meses).toHaveLength(24);
    expect(rec?.totais.every((t) => t.status === 'OK')).toBe(true);
  });

  it('usa toda linha com DATA PO valida (como o DASH), inclusive as que a carga rejeitaria', () => {
    const marco = conf.reconciliacao?.meses.find((m) => m.ano === 2024 && m.mes === 3);
    // 2024-03 tem linhas rejeitadas (quantidade invalida, composto): "carregavel" e menor que "planilha".
    expect(marco?.carregavel.faturamento).not.toBe(marco?.planilha.faturamento);
    expect(marco?.planilha.faturamento).toBeCloseTo(esperadoPorMes()['2024-03'].faturamento, 6);
  });

  it('31/12 e 01/01 caem no mes certo (UTC) e linhas sem DATA PO valida sao contadas a parte', () => {
    const rec = conf.reconciliacao;
    const dez = rec?.meses.find((m) => m.ano === 2024 && m.mes === 12);
    const jan = rec?.meses.find((m) => m.ano === 2025 && m.mes === 1);
    expect(dez?.planilha.volume).toBe(esperadoPorMes()['2024-12'].volume);
    expect(jan?.planilha.volume).toBe(esperadoPorMes()['2025-01'].volume);
    expect(rec?.linhasSemData).toBe(3);
    expect(rec?.anosForaDoDash.map((a) => a.ano)).toEqual([2023]);
  });

  it('DASH alterado em 1 USD: falha apontando o mes (e o total do ano)', async () => {
    const f = await fupDe({ ajusteDash: { '2024-03': { faturamento: 1 } } });
    const rec = conferirComum(f).reconciliacao;
    expect(rec?.ok).toBe(false);
    const ruins = rec?.meses.filter((m) => !m.ok) ?? [];
    expect(ruins.map((m) => [m.ano, m.mes, m.status])).toEqual([[2024, 3, 'DIFERE']]);
    expect(ruins[0].diferenca.faturamento).toBeCloseTo(-1, 6);
    expect(rec?.totais.find((t) => t.ano === 2024)?.status).toBe('DIFERE');
  });

  it('volume e comissao tambem reprovam; tolerancia de 0,01', async () => {
    const vol = (await fupDe({ ajusteDash: { '2025-02': { volume: 0.5 } } })).dash;
    expect(conferir({ linhas: fup.linhas, dash: vol, dataReferencia: DATA_REFERENCIA_FIXTURE }).reconciliacao?.ok).toBe(false);
    const dentro = await fupDe({ ajusteDash: { '2025-02': { comissao: 0.005 } } });
    expect(conferirComum(dentro).reconciliacao?.ok).toBe(true);
    const fora = await fupDe({ ajusteDash: { '2025-02': { comissao: 0.02 } } });
    expect(conferirComum(fora).reconciliacao?.ok).toBe(false);
  });

  it('DASH zerado onde ha movimento = tabela desatualizada: informado, nao reprova', async () => {
    const f = await fupDe({ zerarDash: ['2025-03'] });
    const rec = conferirComum(f).reconciliacao;
    expect(rec?.ok).toBe(true);
    expect(rec?.meses.find((m) => m.ano === 2025 && m.mes === 3)?.status).toBe('DASH_DESATUALIZADO');
    expect(rec?.totais.find((t) => t.ano === 2025)?.status).toBe('DASH_DESATUALIZADO');
    expect(rec?.desatualizados).toBe(2);
  });

  it('DASH PARCIAL (so 1 ou 2 dos 3 campos zerados) e divergencia real: reprova, nunca "desatualizado"', async () => {
    const casos: ('comissao' | 'faturamento' | 'volume')[][] = [
      ['comissao'],
      ['faturamento'],
      ['volume'],
      ['comissao', 'volume'],
      ['faturamento', 'volume'],
    ];
    for (const campos of casos) {
      const f = await fupDe({ zerarMetricaDash: { '2025-03': campos } });
      const rec = conferirComum(f).reconciliacao;
      const mes = rec?.meses.find((m) => m.ano === 2025 && m.mes === 3);
      expect(mes?.status, campos.join('+')).toBe('DIFERE');
      expect(rec?.ok, campos.join('+')).toBe(false);
      expect(rec?.desatualizados, campos.join('+')).toBe(0);
    }
  });

  it('mes sem movimento na planilha e DASH zerado continua OK (nao conta como desatualizado)', () => {
    const jul = conf.reconciliacao?.meses.find((m) => m.ano === 2024 && m.mes === 7);
    expect(jul?.planilha).toEqual({ comissao: 0, faturamento: 0, volume: 0 });
    expect(jul?.status).toBe('OK');
    expect(conf.reconciliacao?.desatualizados).toBe(0);
  });

  it('Total Geral: so a diferenca EXATAMENTE igual aos meses desatualizados e aceita; qualquer excesso reprova', async () => {
    const exato = conferirComum(await fupDe({ zerarDash: ['2025-03'] })).reconciliacao;
    expect(exato?.totais.find((t) => t.ano === 2025)?.status).toBe('DASH_DESATUALIZADO');
    expect(exato?.ok).toBe(true);
    for (const metrica of ['faturamento', 'volume', 'comissao'] as const) {
      const alem = conferirComum(
        await fupDe({ zerarDash: ['2025-03'], ajusteTotalDash: { '2025': { [metrica]: 1 } } }),
      ).reconciliacao;
      expect(alem?.totais.find((t) => t.ano === 2025)?.status, metrica).toBe('DIFERE');
      expect(alem?.ok, metrica).toBe(false);
      // O mes desatualizado continua sendo so "desatualizado": o que reprova e o total.
      expect(alem?.meses.find((m) => m.ano === 2025 && m.mes === 3)?.status).toBe('DASH_DESATUALIZADO');
    }
    // Sem nenhum mes desatualizado, qualquer diferenca no total reprova.
    const semMes = conferirComum(await fupDe({ ajusteTotalDash: { '2024': { faturamento: 1 } } })).reconciliacao;
    expect(semMes?.totais.find((t) => t.ano === 2024)?.status).toBe('DIFERE');
    expect(semMes?.ok).toBe(false);
  });

  it('DASH sem nenhum mes reconhecido: a leitura devolve null e a reconciliacao nunca sai ok', async () => {
    const rotulos = Array.from({ length: 12 }, (_, i) => `M${i + 1}`);
    const f = await fupDe({ rotulosMesDash: rotulos });
    expect(f.dash).toBeNull();
    // Defesa em profundidade: mesmo um DashFup vazio reprova com mensagem clara.
    const rec = reconciliar(conf.linhas, { anos: [2024], meses: {}, totais: {} });
    expect(rec.ok).toBe(false);
    expect(rec.mensagem).toMatch(/nenhum mês reconhecido/);
    expect(rec.desatualizados).toBe(0);
  });

  it('sem DASH: reconciliacao nula', () => {
    expect(conferir({ linhas: fup.linhas, dash: null, dataReferencia: DATA_REFERENCIA_FIXTURE }).reconciliacao).toBeNull();
  });
});

describe('relatorios XLSX', () => {
  const ABAS = [
    'Resumo',
    'Perfil de colunas',
    'Fornecedores',
    'Clientes',
    'Produtos',
    'Quase-duplicidades',
    'Pares cliente-fornecedor',
    'Vínculos fornecedor-produto',
    'Normalização',
    'Alertas por linha',
    'Rejeições',
    'Reconciliação',
    ABA_DEPARA,
  ];

  function celulas(ws: ExcelJS.Worksheet): string[] {
    const out: string[] = [];
    ws.eachRow((row) => {
      row.eachCell((c) => {
        out.push(String(typeof c.value === 'object' && c.value !== null ? JSON.stringify(c.value) : c.value));
      });
    });
    return out;
  }

  it('tem todas as abas do plano', () => {
    const wb = montarRelatorioConferencia(conf, fup.perfil);
    expect(wb.worksheets.map((w) => w.name)).toEqual(ABAS);
  });

  it('comissao so aparece agregada na aba de reconciliacao (nenhuma aba por linha a expoe)', () => {
    const wb = montarRelatorioConferencia(conf, fup.perfil);
    for (const nome of ['Resumo', 'Fornecedores', 'Clientes', 'Produtos', 'Quase-duplicidades', 'Pares cliente-fornecedor', 'Vínculos fornecedor-produto', 'Normalização', 'Alertas por linha', 'Rejeições', ABA_DEPARA]) {
      const ws = wb.getWorksheet(nome) as ExcelJS.Worksheet;
      expect(celulas(ws).some((c) => /comiss/i.test(c)), nome).toBe(false);
    }
    const rec = wb.getWorksheet('Reconciliação') as ExcelJS.Worksheet;
    expect(String(rec.getRow(1).getCell(3).value)).toMatch(/Comissão/);
    // So uma linha por mes/total/ano: nada de linha da planilha.
    expect(rec.rowCount).toBe(1 + 24 + 2 + 1);
  });

  it('vinculos: aba traz situacao por par e os totais', () => {
    const wb = montarRelatorioConferencia(conf, fup.perfil);
    const ws = wb.getWorksheet('Vínculos fornecedor-produto') as ExcelJS.Worksheet;
    const texto = celulas(ws);
    expect(texto).toContain('ENTRA');
    expect(texto).toContain('FORA DA JANELA');
    expect(texto.some((t) => t.startsWith('Janela: 2024-11-13 a 2026-11-13'))).toBe(true);
    const resumo = celulas(wb.getWorksheet('Resumo') as ExcelJS.Worksheet);
    expect(resumo).toContain('Data de referência da janela de vínculos');
    expect(resumo).toContain('2026-11-13');
  });

  it('de-para: ida e volta pelo arquivo; decisao editada e lida; abas ausentes e tipo invalido dao erro', async () => {
    const wb = montarRelatorioConferencia(conf, fup.perfil);
    const ws = wb.getWorksheet(ABA_DEPARA) as ExcelJS.Worksheet;
    let linhaComposto = 0;
    ws.eachRow((row, n) => {
      if (row.getCell(2).value === 'FORN GAMA/FORN DELTA') linhaComposto = n;
    });
    expect(linhaComposto).toBeGreaterThan(1);
    ws.getCell(linhaComposto, 5).value = 'CRIAR';
    const buf = await wb.xlsx.writeBuffer();
    const lido = new ExcelJS.Workbook();
    await lido.xlsx.load(buf);
    const r = lerDeParaDeWorkbook(lido);
    expect(r).toEqual({
      ok: true,
      entradas: [{ kind: 'FORNECEDOR', texto: 'FORN GAMA/FORN DELTA', decisao: 'CRIAR', plant: '' }],
    });
    if (r.ok) {
      const c = conferirComum(fup, { dePara: r.entradas });
      expect(c.linhas[idx(6)].rejeitada).toBe(false);
    }
    expect(lerDeParaDeWorkbook(new ExcelJS.Workbook())).toMatchObject({ ok: false });
    (lido.getWorksheet(ABA_DEPARA) as ExcelJS.Worksheet).getCell(linhaComposto, 1).value = 'OUTRO';
    expect(lerDeParaDeWorkbook(lido)).toMatchObject({ ok: false });
  });

  it('de-para: linha com so a fabrica (plant) editada, sem decisao, tambem e lida e aplicada', async () => {
    const wb = montarRelatorioConferencia(conf, fup.perfil);
    const ws = wb.getWorksheet(ABA_DEPARA) as ExcelJS.Worksheet;
    let linhaLim = 0;
    ws.eachRow((row, n) => {
      if (row.getCell(2).value === 'FORN LIM') linhaLim = n;
    });
    expect(linhaLim).toBeGreaterThan(1);
    ws.getCell(linhaLim, 6).value = 'fab x';
    const lido = new ExcelJS.Workbook();
    await lido.xlsx.load(await wb.xlsx.writeBuffer());
    const r = lerDeParaDeWorkbook(lido);
    expect(r).toEqual({
      ok: true,
      entradas: [{ kind: 'FORNECEDOR', texto: 'FORN LIM', decisao: '', plant: 'fab x' }],
    });
    if (r.ok) {
      const c = conferirComum(fup, { dePara: r.entradas });
      expect(c.linhas[idx(46)].fornecedor?.plant).toBe('FAB X');
      expect(c.cadastros.FORNECEDOR.find((x) => x.nome === 'FORN LIM')?.plants).toEqual(['FAB X']);
      expect(c.linhas[idx(46)].rejeitada).toBe(false);
    }
  });

  it('dry-run e relatorio so de reconciliacao', () => {
    const dry = montarDryRun(conf);
    expect(dry.worksheets.map((w) => w.name)).toEqual(['Resumo', 'Cadastros a criar', 'Rejeições']);
    const rec = montarRelatorioReconciliacao(conf.reconciliacao as NonNullable<Conferencia['reconciliacao']>);
    expect(rec.worksheets.map((w) => w.name)).toEqual(['Reconciliação']);
  });
});
