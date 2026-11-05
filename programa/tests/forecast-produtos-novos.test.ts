import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { LinhaProposta } from '../src/utils/forecastCatalogoBackfill';
import {
  agruparProdutosNovos,
  chaveDeNome,
  codigoDeSaida,
  contarResultados,
  fontesParaCsv,
  lerArgumentosProdutosNovos,
  lerLeadTimeDias,
  lerListaDaCelula,
  lerPlanilhaProdutosNovos,
  LoteInterrompido,
  modeloParaCsv,
  relatorioParaCsv,
  resolverPorNome,
  resumoDeLeituraSomente,
  resumoDeLoteInterrompido,
  resumoDoRelatorio,
  type LinhaLida,
  type LinhaProdutoNovo,
  type RelatorioProdutosNovos,
  type ResultadoProdutoNovo,
} from '../src/utils/forecastProdutosNovos';

// Dados SINTETICOS (repo publico): nada aqui vem de planilha, banco ou catalogo reais.

const BOM = '\uFEFF';

// Cabecalho no formato REAL do contrato (colunas informativas incluidas; so algumas sao lidas).
const CABECALHO_REAL = [
  'produtoNovo',
  'codigos',
  'embalagens',
  'familia',
  'catalogItemIds',
  'nomesDeMercado',
  'fonteSugerida',
  'fonteId',
  'leadTimeDaFonte',
  'confianca',
  'evidencia',
  'candidatas',
  'fonte',
  'leadTimeDias',
  'observacao',
  'criar',
];

type CamposReais = Partial<Record<(typeof CABECALHO_REAL)[number], string>>;

// CSV no formato real: BOM, `;`, CRLF e TODAS as celulas entre aspas duplas.
function csvReal(linhas: CamposReais[], cabecalho: string[] = CABECALHO_REAL): string {
  const quote = (valor: string) => `"${valor.replace(/"/g, '""')}"`;
  const corpo = [
    cabecalho.map(quote).join(';'),
    ...linhas.map((l) => cabecalho.map((c) => quote(l[c] ?? '')).join(';')),
  ];
  return `${BOM}${corpo.join('\r\n')}\r\n`;
}

function linhaOk(extra: CamposReais = {}): CamposReais {
  return {
    produtoNovo: 'FIC PRODUTO A',
    codigos: 'FIC-001 | FIC-002',
    embalagens: 'BLD 18KG | TBR 175KG',
    familia: 'FIC Familia',
    catalogItemIds: '11 | 12',
    nomesDeMercado: 'FIC MERCADO A | FIC MERCADO B',
    fonteSugerida: 'FIC Sugerida',
    fonteId: '99',
    leadTimeDaFonte: '10',
    confianca: 'baixa',
    evidencia: 'texto informativo',
    candidatas: 'FIC Outra',
    fonte: 'FIC Fonte (Ação) - 1',
    leadTimeDias: '',
    observacao: '',
    criar: 'sim',
    ...extra,
  };
}

function ler(linhas: CamposReais[], cabecalho?: string[]): LinhaLida[] {
  const leitura = lerPlanilhaProdutosNovos(csvReal(linhas, cabecalho));
  if (!leitura.ok) throw new Error(`leitura invalida: ${leitura.erros.join(' / ')}`);
  return leitura.linhas;
}

function motivoDe(l: LinhaLida): string | null {
  return l.status === 'pronta' ? null : l.motivo;
}

function dadosDe(l: LinhaLida): LinhaProdutoNovo {
  if (l.status !== 'pronta') throw new Error(`linha ${l.linha} nao esta pronta (${l.status})`);
  return l.dados;
}

describe('chaveDeNome / resolverPorNome', () => {
  it('ignora caixa, acento e espacos repetidos', () => {
    expect(chaveDeNome(' Fonte  Sintética fic ')).toBe('FONTE SINTETICA FIC');
    const fontes = [{ nome: 'FONTE SINTETICA FIC', id: 1 }, { nome: 'FIC Outra', id: 2 }];
    expect(resolverPorNome(fontes, ' Fonte  Sintética fic ')).toEqual({ tipo: 'unico', item: fontes[0] });
  });

  it('parenteses e hifen fazem parte do nome', () => {
    const fontes = [{ nome: 'FIC FONTE - PI (XY)' }, { nome: 'FIC FONTE - PI' }];
    expect(resolverPorNome(fontes, 'fic fonte - pi (xy)')).toMatchObject({ tipo: 'unico' });
  });

  it('duas fontes com a mesma chave sao ambiguas (nunca escolhe a primeira)', () => {
    expect(resolverPorNome([{ nome: 'FIC Ação' }, { nome: 'FIC ACAO' }], 'fic acao')).toEqual({ tipo: 'ambiguo' });
  });

  it('nome que nao existe -> nenhum', () => {
    expect(resolverPorNome([{ nome: 'FIC A' }], 'FIC B')).toEqual({ tipo: 'nenhum' });
    expect(resolverPorNome([], 'FIC B')).toEqual({ tipo: 'nenhum' });
  });
});

describe('lerListaDaCelula / lerLeadTimeDias', () => {
  it('lista separada por " | " na ordem, com trim', () => {
    expect(lerListaDaCelula('a | b|c ')).toEqual(['a', 'b', 'c']);
    expect(lerListaDaCelula('')).toEqual([]);
    expect(lerListaDaCelula('  ')).toEqual([]);
    expect(lerListaDaCelula('a |  | c')).toBeNull();
    expect(lerListaDaCelula('a | ')).toBeNull();
  });

  it('lead time: vazio, 1..999; o resto e invalido', () => {
    expect(lerLeadTimeDias('')).toEqual({ ok: true, valor: null });
    expect(lerLeadTimeDias('45')).toEqual({ ok: true, valor: 45 });
    expect(lerLeadTimeDias(' 45 ')).toEqual({ ok: true, valor: 45 });
    expect(lerLeadTimeDias('999')).toEqual({ ok: true, valor: 999 });
    for (const ruim of ['0', '1000', '4,5', '4.5', 'abc', '-3', '0045x']) {
      expect(lerLeadTimeDias(ruim)).toEqual({ ok: false });
    }
  });
});

describe('lerPlanilhaProdutosNovos - formato real do contrato', () => {
  it('le BOM + aspas em todos os campos + CRLF + acentos + parenteses; colunas informativas nao decidem nada', () => {
    const [linha] = ler([linhaOk({ leadTimeDias: '45' })]);
    expect(linha.status).toBe('pronta');
    expect(dadosDe(linha)).toEqual({
      linha: 2,
      nome: 'FIC PRODUTO A',
      codigos: ['FIC-001', 'FIC-002'],
      catalogItemIds: [11, 12],
      fonte: 'FIC Fonte (Ação) - 1',
      chaveFonte: 'FIC FONTE (ACAO) - 1',
      familia: 'FIC Familia',
      leadTimeDias: 45,
      leadTimeDaFonteNoArquivo: 45,
    });
  });

  it('fonteSugerida / fonteId / leadTimeDaFonte nao substituem a coluna fonte nem o leadTimeDias', () => {
    const [semFonte, semLead] = ler([
      linhaOk({ fonte: '', fonteSugerida: 'FIC Sugerida', fonteId: '5', produtoNovo: 'FIC X', codigos: 'FIC-X1 | FIC-X2', catalogItemIds: '21 | 22' }),
      linhaOk({ leadTimeDias: '', leadTimeDaFonte: '77', produtoNovo: 'FIC Y', codigos: 'FIC-Y1 | FIC-Y2', catalogItemIds: '31 | 32' }),
    ]);
    expect(motivoDe(semFonte)).toBe('fonte_vazia');
    expect(dadosDe(semLead).leadTimeDias).toBeNull();
    expect(dadosDe(semLead).leadTimeDaFonteNoArquivo).toBeNull();
  });

  it('criar: so `sim` (sem caixa, sem espacos) aprova; o resto e ignorado', () => {
    const linhas = ler([
      linhaOk({ criar: 'SIM', produtoNovo: 'FIC P1', codigos: 'FIC-A1 | FIC-A2', catalogItemIds: '1 | 2' }),
      linhaOk({ criar: ' sim ', produtoNovo: 'FIC P2', codigos: 'FIC-B1 | FIC-B2', catalogItemIds: '3 | 4' }),
      linhaOk({ criar: 'nao', produtoNovo: 'FIC P3', codigos: 'FIC-C1 | FIC-C2', catalogItemIds: '5 | 6' }),
      linhaOk({ criar: '', produtoNovo: 'FIC P4', codigos: 'FIC-D1 | FIC-D2', catalogItemIds: '7 | 8' }),
      linhaOk({ criar: 'sim, por favor', produtoNovo: 'FIC P5', codigos: 'FIC-E1 | FIC-E2', catalogItemIds: '9 | 10' }),
    ]);
    expect(linhas.map((l) => l.status)).toEqual(['pronta', 'pronta', 'ignorado', 'ignorado', 'ignorado']);
    expect(linhas.map((l) => l.linha)).toEqual([2, 3, 4, 5, 6]);
    expect(linhas[2]).toEqual({ linha: 4, status: 'ignorado', motivo: 'nao_aprovado' });
  });

  it('linha ignorada nao e validada (lixo em linha nao aprovada nao vira erro)', () => {
    const [l] = ler([linhaOk({ criar: '', codigos: '', catalogItemIds: 'abc', leadTimeDias: 'xx', fonte: '' })]);
    expect(l.status).toBe('ignorado');
  });

  it('sem a coluna criar: erro do D2 (nunca "tudo aprovado" por omissao)', () => {
    const cabecalho = CABECALHO_REAL.filter((c) => c !== 'criar');
    const leitura = lerPlanilhaProdutosNovos(csvReal([linhaOk()], cabecalho));
    expect(leitura).toEqual({
      ok: false,
      erros: ['Coluna criar ausente: acrescente a coluna criar e escreva sim nas linhas a criar.'],
    });
  });

  it('coluna obrigatoria faltando: lista os nomes das colunas', () => {
    const cabecalho = CABECALHO_REAL.filter((c) => c !== 'fonte' && c !== 'leadTimeDias');
    expect(lerPlanilhaProdutosNovos(csvReal([linhaOk()], cabecalho))).toEqual({
      ok: false,
      erros: ['Colunas ausentes no cabecalho: fonte, leadTimeDias.'],
    });
  });

  it('arquivo vazio', () => {
    expect(lerPlanilhaProdutosNovos('')).toEqual({ ok: false, erros: ['Arquivo vazio.'] });
    expect(lerPlanilhaProdutosNovos(BOM)).toEqual({ ok: false, erros: ['Arquivo vazio.'] });
  });

  it('caractere de substituicao (CSV salvo em ANSI) -> pede UTF-8', () => {
    const texto = csvReal([linhaOk({ fonte: 'FIC Fonte A\uFFFDo' })]);
    expect(lerPlanilhaProdutosNovos(texto)).toEqual({ ok: false, erros: ['Salve a planilha como CSV UTF-8.'] });
  });

  it('colunas em outra ordem e coluna extra desconhecida', () => {
    const cabecalho = ['criar', 'colunaExtraQualquer', 'leadTimeDias', 'fonte', 'catalogItemIds', 'familia', 'codigos', 'produtoNovo'];
    const [l] = ler([{ ...linhaOk({ leadTimeDias: '30' }), colunaExtraQualquer: 'ignorar' }], cabecalho);
    expect(dadosDe(l)).toMatchObject({ nome: 'FIC PRODUTO A', codigos: ['FIC-001', 'FIC-002'], catalogItemIds: [11, 12], leadTimeDias: 30 });
  });

  it('tambem le LF puro e sem aspas', () => {
    const texto = `produtoNovo;codigos;familia;catalogItemIds;fonte;leadTimeDias;criar\nFIC Z;fic-z1;;5;FIC F;;sim\n`;
    const leitura = lerPlanilhaProdutosNovos(texto);
    expect(leitura.ok).toBe(true);
    if (leitura.ok) expect(dadosDe(leitura.linhas[0])).toMatchObject({ codigos: ['FIC-Z1'], familia: '', catalogItemIds: [5] });
  });

  it('codigos na ordem da planilha, em maiusculas', () => {
    const [l] = ler([linhaOk({ codigos: 'fic-002 | fic-001', catalogItemIds: '12 | 11' })]);
    expect(dadosDe(l).codigos).toEqual(['FIC-002', 'FIC-001']);
    expect(dadosDe(l).catalogItemIds).toEqual([12, 11]);
  });

  it('nome com espacos nas pontas e trim', () => {
    const [l] = ler([linhaOk({ produtoNovo: '  FIC PRODUTO A  ' })]);
    expect(dadosDe(l).nome).toBe('FIC PRODUTO A');
  });

  describe('validacao por linha (1o erro vence)', () => {
    const um = (extra: CamposReais) => motivoDe(ler([linhaOk(extra)])[0]);
    const oito = Array.from({ length: 8 }, (_, i) => `FIC-M${i + 1}`);

    it('8 codigos -> codigos_mais_de_7 (sem o Zod, passaria)', () => {
      expect(um({ codigos: oito.join(' | '), catalogItemIds: '1 | 2 | 3 | 4 | 5 | 6 | 7 | 8' })).toBe('codigos_mais_de_7');
      const sete = oito.slice(0, 7);
      expect(um({ codigos: sete.join(' | '), catalogItemIds: '1 | 2 | 3 | 4 | 5 | 6 | 7' })).toBeNull();
    });

    it('codigo repetido, vazio, > 40 caracteres ou sem codigo -> codigos_invalidos', () => {
      expect(um({ codigos: 'FIC-1 | fic-1', catalogItemIds: '1 | 2' })).toBe('codigos_invalidos');
      expect(um({ codigos: `${'X'.repeat(41)} | FIC-2`, catalogItemIds: '1 | 2' })).toBe('codigos_invalidos');
      expect(um({ codigos: 'FIC-1 |  | FIC-3', catalogItemIds: '1 | 2 | 3' })).toBe('codigos_invalidos');
      expect(um({ codigos: '', catalogItemIds: '' })).toBe('codigos_invalidos');
    });

    it('nome vazio ou com mais de 200 caracteres -> nome_invalido', () => {
      expect(um({ produtoNovo: '' })).toBe('nome_invalido');
      expect(um({ produtoNovo: '   ' })).toBe('nome_invalido');
      expect(um({ produtoNovo: 'N'.repeat(201) })).toBe('nome_invalido');
      expect(um({ produtoNovo: 'N'.repeat(200) })).toBeNull();
    });

    it('quantidade de codigos diferente da de ids -> colunas_desalinhadas', () => {
      expect(um({ codigos: 'FIC-1 | FIC-2', catalogItemIds: '1' })).toBe('colunas_desalinhadas');
      expect(um({ codigos: 'FIC-1', catalogItemIds: '1 | 2' })).toBe('colunas_desalinhadas');
      expect(um({ codigos: 'FIC-1', catalogItemIds: '' })).toBe('colunas_desalinhadas');
    });

    it('id 0, texto ou parte vazia -> catalog_item_id_invalido', () => {
      expect(um({ catalogItemIds: '0 | 2' })).toBe('catalog_item_id_invalido');
      expect(um({ catalogItemIds: 'abc | 2' })).toBe('catalog_item_id_invalido');
      expect(um({ catalogItemIds: '1 |  ' })).toBe('catalog_item_id_invalido');
      expect(um({ catalogItemIds: '1,5 | 2' })).toBe('catalog_item_id_invalido');
    });

    it('fonte vazia -> fonte_vazia', () => {
      expect(um({ fonte: '' })).toBe('fonte_vazia');
      expect(um({ fonte: '   ' })).toBe('fonte_vazia');
    });

    it('lead time: vazio e 45 ok; 0, 1000, 4,5 e abc -> lead_time_invalido', () => {
      expect(um({ leadTimeDias: '' })).toBeNull();
      expect(um({ leadTimeDias: '45' })).toBeNull();
      expect(um({ leadTimeDias: ' 45 ' })).toBeNull();
      for (const ruim of ['0', '1000', '4,5', 'abc']) expect(um({ leadTimeDias: ruim })).toBe('lead_time_invalido');
    });

    it('a ordem de verificacao e a do plano', () => {
      expect(um({ catalogItemIds: 'x | y', produtoNovo: '' })).toBe('catalog_item_id_invalido');
      expect(um({ produtoNovo: '', codigos: '' })).toBe('nome_invalido');
      expect(um({ codigos: 'FIC-1', catalogItemIds: '1 | 2', fonte: '' })).toBe('colunas_desalinhadas');
      expect(um({ fonte: '', leadTimeDias: 'abc' })).toBe('fonte_vazia');
    });
  });

  describe('validacao ENTRE linhas aprovadas', () => {
    const outra = (extra: CamposReais): CamposReais => linhaOk({
      produtoNovo: 'FIC PRODUTO B',
      codigos: 'FIC-101 | FIC-102',
      catalogItemIds: '21 | 22',
      ...extra,
    });

    it('nome repetido (caixa/espacos diferentes) -> ambas duplicado_no_arquivo', () => {
      const linhas = ler([linhaOk(), outra({ produtoNovo: '  fic   produto a ' })]);
      expect(linhas.map(motivoDe)).toEqual(['duplicado_no_arquivo', 'duplicado_no_arquivo']);
    });

    it('codigo repetido entre linhas -> ambas duplicado_no_arquivo', () => {
      const linhas = ler([linhaOk(), outra({ codigos: 'fic-102 | FIC-001' })]);
      expect(linhas.map(motivoDe)).toEqual(['duplicado_no_arquivo', 'duplicado_no_arquivo']);
    });

    it('catalogItemId repetido entre linhas -> ambas duplicado_no_arquivo', () => {
      const linhas = ler([linhaOk(), outra({ catalogItemIds: '21 | 12' })]);
      expect(linhas.map(motivoDe)).toEqual(['duplicado_no_arquivo', 'duplicado_no_arquivo']);
    });

    it('so as aprovadas contam: duplicata com linha NAO aprovada nao faz mal', () => {
      const linhas = ler([linhaOk(), outra({ produtoNovo: 'FIC PRODUTO A', criar: '' })]);
      expect(linhas.map((l) => l.status)).toEqual(['pronta', 'ignorado']);
    });

    it('mesma fonte com 30 e 45 -> todas as linhas da fonte lead_time_divergente_no_arquivo', () => {
      const linhas = ler([
        linhaOk({ leadTimeDias: '30' }),
        outra({ leadTimeDias: '45', fonte: ' fic fonte (acao) - 1 ' }),
        outra({ produtoNovo: 'FIC PRODUTO C', codigos: 'FIC-201', catalogItemIds: '31', leadTimeDias: '' }),
        outra({ produtoNovo: 'FIC PRODUTO D', codigos: 'FIC-301', catalogItemIds: '41', fonte: 'FIC Outra Fonte', leadTimeDias: '20' }),
      ]);
      expect(linhas.map(motivoDe)).toEqual([
        'lead_time_divergente_no_arquivo',
        'lead_time_divergente_no_arquivo',
        'lead_time_divergente_no_arquivo',
        null,
      ]);
      expect(dadosDe(linhas[3]).leadTimeDaFonteNoArquivo).toBe(20);
    });

    it('mesma fonte com 30 e vazio -> ambas prontas com leadTimeDaFonteNoArquivo = 30', () => {
      const linhas = ler([linhaOk({ leadTimeDias: '30' }), outra({ leadTimeDias: '' })]);
      expect(linhas.map((l) => dadosDe(l).leadTimeDaFonteNoArquivo)).toEqual([30, 30]);
      expect(linhas.map((l) => dadosDe(l).leadTimeDias)).toEqual([30, null]);
    });

    it('mesma fonte com o mesmo valor repetido nao diverge', () => {
      const linhas = ler([linhaOk({ leadTimeDias: '30' }), outra({ leadTimeDias: '30' })]);
      expect(linhas.map(motivoDe)).toEqual([null, null]);
    });

    it('linha NAO aprovada com lead time diferente nao interfere', () => {
      const linhas = ler([linhaOk({ leadTimeDias: '30' }), outra({ leadTimeDias: '99', criar: 'nao' })]);
      expect(linhas.map((l) => l.status)).toEqual(['pronta', 'ignorado']);
      expect(dadosDe(linhas[0]).leadTimeDaFonteNoArquivo).toBe(30);
    });

    it('linha com erro de validacao propria nao entra no calculo do lead time da fonte', () => {
      const linhas = ler([linhaOk({ leadTimeDias: '30' }), outra({ leadTimeDias: '45', codigos: '' })]);
      expect(linhas.map((l) => l.status)).toEqual(['pronta', 'erro']);
      expect(dadosDe(linhas[0]).leadTimeDaFonteNoArquivo).toBe(30);
    });
  });

  it('a leitura nao devolve valor de celula nas mensagens de erro de cabecalho', () => {
    const leitura = lerPlanilhaProdutosNovos(csvReal([linhaOk()], ['produtoNovo', 'codigos']));
    expect(leitura.ok).toBe(false);
    if (!leitura.ok) expect(JSON.stringify(leitura.erros)).not.toMatch(/FIC/);
  });
});

function proposta(
  catalogItemId: number,
  nomeComercial: string,
  extra: Partial<LinhaProposta> = {},
): LinhaProposta {
  return {
    codigo: `FIC-${catalogItemId}`,
    catalogItemId,
    nomeComercial,
    familiaItem: 'FIC Familia',
    produtoSugeridoId: null,
    produtoSugeridoNome: null,
    produtoAtivo: null,
    codigosNoProduto: null,
    vagasAposSugestoes: null,
    criterio: 'nenhum',
    confianca: 'sem_sugestao',
    motivo: 'nenhum produto parecido no Forecast',
    alternativas: [],
    aprovado: '',
    ...extra,
  };
}

describe('agruparProdutosNovos', () => {
  it('2 itens do mesmo nome base viram 1 linha, codigos/ids na ordem e embalagens por posicao', () => {
    const modelo = agruparProdutosNovos([
      proposta(2, 'FIC PROD - TBR 175KG'),
      proposta(1, 'FIC PROD - BLD 18KG'),
    ]);
    expect(modelo).toHaveLength(1);
    expect(modelo[0]).toEqual({
      produtoNovo: 'FIC PROD',
      codigos: ['FIC-1', 'FIC-2'],
      embalagens: ['BLD 18KG', 'TBR 175KG'],
      familia: 'FIC Familia',
      catalogItemIds: [1, 2],
      fonte: '',
      leadTimeDias: '',
      observacao: '',
      criar: '',
    });
  });

  it('so entram os sem_sugestao (alta, media, baixa e bloqueada ficam fora)', () => {
    const modelo = agruparProdutosNovos([
      proposta(1, 'FIC AAA - X', { confianca: 'alta' }),
      proposta(2, 'FIC BBB - X', { confianca: 'media' }),
      proposta(3, 'FIC CCC - X', { confianca: 'baixa' }),
      proposta(4, 'FIC DDD - X', { confianca: 'bloqueada' }),
      proposta(5, 'FIC EEE - X'),
    ]);
    expect(modelo.map((m) => m.produtoNovo)).toEqual(['FIC EEE']);
  });

  it('nome base vazio fica fora', () => {
    expect(agruparProdutosNovos([proposta(1, ''), proposta(2, '   ')])).toEqual([]);
  });

  it('o nome base ignora acento e caixa (mesma regra do backfill)', () => {
    const modelo = agruparProdutosNovos([proposta(1, 'Fic Ação - A'), proposta(2, 'FIC ACAO - B')]);
    expect(modelo).toHaveLength(1);
    expect(modelo[0].produtoNovo).toBe('FIC ACAO');
  });

  it('familias diferentes -> familia vazia + observacao', () => {
    const modelo = agruparProdutosNovos([
      proposta(1, 'FIC PROD - A', { familiaItem: 'FIC F1' }),
      proposta(2, 'FIC PROD - B', { familiaItem: 'FIC F2' }),
    ]);
    expect(modelo[0].familia).toBe('');
    expect(modelo[0].observacao).toBe('familias diferentes no grupo');
  });

  it('sem familia em nenhum item: familia vazia e sem observacao', () => {
    const [m] = agruparProdutosNovos([proposta(1, 'FIC PROD - A', { familiaItem: null })]);
    expect(m.familia).toBe('');
    expect(m.observacao).toBe('');
  });

  it('8 itens -> observacao de mais de 7 codigos; 7 itens nao', () => {
    const itens = (n: number) => Array.from({ length: n }, (_, i) => proposta(i + 1, `FIC GRANDE - EMB ${i + 1}`));
    expect(agruparProdutosNovos(itens(8))[0].observacao).toBe('mais de 7 codigos: divida em produtos');
    expect(agruparProdutosNovos(itens(7))[0].observacao).toBe('');
  });

  it('familias diferentes e 8 itens: as duas observacoes', () => {
    const itens = Array.from({ length: 8 }, (_, i) =>
      proposta(i + 1, `FIC GRANDE - EMB ${i + 1}`, { familiaItem: i === 0 ? 'FIC F2' : 'FIC F1' }),
    );
    expect(agruparProdutosNovos(itens)[0].observacao).toBe('familias diferentes no grupo; mais de 7 codigos: divida em produtos');
  });

  it('item sem embalagem no nome: embalagens vazias; grupos ordenados por produtoNovo', () => {
    const modelo = agruparProdutosNovos([proposta(1, 'FIC ZETA'), proposta(2, 'FIC ALFA')]);
    expect(modelo.map((m) => m.produtoNovo)).toEqual(['FIC ALFA', 'FIC ZETA']);
    expect(modelo.every((m) => m.embalagens.length === 0)).toBe(true);
  });
});

describe('modeloParaCsv / fontesParaCsv', () => {
  it('modelo: BOM, cabecalho, CRLF, listas com " | " e criar/fonte/leadTimeDias vazios', () => {
    const csv = modeloParaCsv(agruparProdutosNovos([proposta(1, 'FIC PROD - BLD'), proposta(2, 'FIC PROD - TBR')]));
    expect(csv.startsWith(BOM)).toBe(true);
    expect(csv.endsWith('\r\n')).toBe(true);
    const [cabecalho, linha] = csv.slice(1).split('\r\n');
    expect(cabecalho).toBe('produtoNovo;codigos;embalagens;familia;catalogItemIds;fonte;leadTimeDias;observacao;criar');
    expect(linha).toBe('FIC PROD;FIC-1 | FIC-2;BLD | TBR;FIC Familia;1 | 2;;;;');
  });

  it('ida e volta: modelo -> humano preenche fonte/leadTimeDias/criar -> leitura = prontas', () => {
    const csv = modeloParaCsv(
      agruparProdutosNovos([
        proposta(1, 'FIC PROD - BLD'),
        proposta(2, 'FIC PROD - TBR'),
        proposta(3, 'FIC OUTRO - UN'),
      ]),
    );
    const [cab, ...linhas] = csv.slice(1).trimEnd().split('\r\n').map((l) => l.split(';'));
    const colunas = cab;
    const preenchida = [cab, ...linhas].map((cels, i) => {
      if (i === 0) return cels;
      const copia = [...cels];
      copia[colunas.indexOf('fonte')] = 'FIC Fonte (Ação)';
      copia[colunas.indexOf('leadTimeDias')] = i === 1 ? '30' : '';
      copia[colunas.indexOf('criar')] = i === 1 ? 'sim' : 'nao';
      return copia;
    });
    const leitura = lerPlanilhaProdutosNovos(`${BOM}${preenchida.map((c) => c.join(';')).join('\r\n')}\r\n`);
    expect(leitura.ok).toBe(true);
    if (!leitura.ok) return;
    expect(leitura.linhas.map((l) => l.status)).toEqual(['pronta', 'ignorado']);
    expect(dadosDe(leitura.linhas[0])).toMatchObject({
      nome: 'FIC OUTRO',
      codigos: ['FIC-3'],
      catalogItemIds: [3],
      fonte: 'FIC Fonte (Ação)',
      leadTimeDias: 30,
    });
  });

  it('modelo com aspas e ponto e virgula no texto: celula entre aspas duplas', () => {
    const csv = modeloParaCsv([
      {
        produtoNovo: 'FIC "ASPAS"; X',
        codigos: ['FIC-Q1'],
        embalagens: [],
        familia: '',
        catalogItemIds: [9],
        fonte: '',
        leadTimeDias: '',
        observacao: '',
        criar: '',
      },
    ]);
    expect(csv).toContain('"FIC ""ASPAS""; X"');
  });

  it('fontes: id;nome;leadTimeDias;ativa, lead time nulo vazio', () => {
    const csv = fontesParaCsv([
      { id: 1, nome: 'FIC Fonte (Ação)', leadTimeDays: 30, ativa: true },
      { id: 2, nome: 'FIC Sem Lead Time', leadTimeDays: null, ativa: false },
    ]);
    expect(csv).toBe(`${BOM}id;nome;leadTimeDias;ativa\r\n1;FIC Fonte (Ação);30;sim\r\n2;FIC Sem Lead Time;;nao\r\n`);
  });

  it('resumo dos modos de leitura nao traz nome nem codigo', () => {
    expect(resumoDeLeituraSomente('fontes', 12)).toBe('Fontes exportadas (somente leitura): 12.');
    expect(resumoDeLeituraSomente('modelo', 3, 7)).toBe('Modelo gerado (somente leitura): 3 produtos novos, 7 itens.');
  });
});

describe('lerArgumentosProdutosNovos', () => {
  const raizRepo = path.resolve('C:\\fic-repo');
  const fora = (nome: string) => path.resolve('C:\\fic-fora', nome);
  const databaseUrl = 'postgresql://usuario:senha-fic@127.0.0.1:5433/fic_banco';
  const BANCO = '127.0.0.1:5433/fic_banco';
  const ctx = { raizRepo, databaseUrl, existe: () => false };
  const ler1 = (argv: string[], extra: Partial<typeof ctx> = {}) =>
    lerArgumentosProdutosNovos(argv, { ...ctx, ...extra });
  const erro = (argv: string[], extra: Partial<typeof ctx> = {}) => {
    const r = ler1(argv, extra);
    if (r.ok) throw new Error('esperava erro');
    return r;
  };

  it('modo ausente ou duplo', () => {
    expect(erro([]).codigo).toBe(2);
    expect(erro(['--saida', fora('a.csv')]).erro).toMatch(/Informe o modo/);
    expect(erro(['--fontes', '--modelo', '--saida', fora('a.csv')]).erro).toMatch(/so um modo/);
    expect(erro(['--modelo', '--criar', '--entrada', fora('a.csv')]).erro).toMatch(/so um modo/);
  });

  it('argumento desconhecido, repetido ou sem valor', () => {
    expect(erro(['--fontes', '--xpto']).erro).toMatch(/desconhecido/);
    expect(erro(['--fontes', '--fontes', '--saida', fora('a.csv')]).erro).toMatch(/repetido/);
    expect(erro(['--fontes', '--saida', fora('a.csv'), '--saida', fora('b.csv')]).erro).toMatch(/repetido/);
    expect(erro(['--fontes', '--saida']).erro).toMatch(/Falta o valor/);
    expect(erro(['--fontes', '--saida', '--gravar']).erro).toMatch(/Falta o valor/);
  });

  it('--fontes e --modelo: so --saida .csv fora do repo e que nao existe', () => {
    expect(ler1(['--fontes', '--saida', fora('f.csv')])).toEqual({ ok: true, modo: 'fontes', saida: fora('f.csv') });
    expect(ler1(['--modelo', '--saida', fora('m.csv')])).toEqual({ ok: true, modo: 'modelo', saida: fora('m.csv') });
    expect(erro(['--fontes']).erro).toMatch(/Informe --saida/);
    expect(erro(['--fontes', '--saida', path.join(raizRepo, 'programa', 'f.csv')]).erro).toMatch(/dentro do repositorio/);
    expect(erro(['--modelo', '--saida', raizRepo]).erro).toMatch(/\.csv|dentro do repositorio/);
    expect(erro(['--modelo', '--saida', fora('m.xlsx')]).erro).toMatch(/\.csv/);
  });

  it('--saida que ja existe e recusada (protege a planilha preenchida)', () => {
    const r = erro(['--modelo', '--saida', fora('m.csv')], { existe: () => true });
    expect(r.erro).toMatch(/ja existe/);
    expect(erro(['--fontes', '--saida', fora('f.csv')], { existe: () => true }).erro).toMatch(/ja existe/);
  });

  it('--fontes/--modelo recusam --gravar, --entrada, --relatorio e --confirmo-banco', () => {
    for (const modo of ['--fontes', '--modelo']) {
      expect(erro([modo, '--saida', fora('a.csv'), '--gravar']).erro).toMatch(/somente leitura/);
      expect(erro([modo, '--saida', fora('a.csv'), '--entrada', fora('e.csv')]).erro).toMatch(/somente leitura/);
      expect(erro([modo, '--saida', fora('a.csv'), '--relatorio', fora('r.csv')]).erro).toMatch(/somente leitura/);
      expect(erro([modo, '--saida', fora('a.csv'), '--confirmo-banco', BANCO]).erro).toMatch(/somente leitura/);
    }
  });

  it('--criar sem --gravar e dry-run', () => {
    expect(ler1(['--criar', '--entrada', fora('e.csv')])).toEqual({
      ok: true,
      modo: 'criar',
      entrada: fora('e.csv'),
      relatorio: null,
      gravar: false,
    });
  });

  it('--criar: --entrada obrigatoria, .csv, fora do repo; a entrada JA existe (nao e checada); --saida recusada', () => {
    expect(erro(['--criar']).erro).toMatch(/Informe --entrada/);
    expect(erro(['--criar', '--entrada', fora('e.xlsx')]).erro).toMatch(/\.csv/);
    expect(erro(['--criar', '--entrada', path.join(raizRepo, 'e.csv')]).erro).toMatch(/dentro do repositorio/);
    expect(ler1(['--criar', '--entrada', fora('e.csv')], { existe: () => true }).ok).toBe(true);
    expect(erro(['--criar', '--entrada', fora('e.csv'), '--saida', fora('s.csv')]).erro).toMatch(/nao aceita --saida/);
  });

  it('--criar --gravar exige --confirmo-banco igual ao banco da DATABASE_URL', () => {
    const base = ['--criar', '--entrada', fora('e.csv'), '--gravar'];
    expect(ler1([...base, '--confirmo-banco', BANCO])).toMatchObject({ ok: true, modo: 'criar', gravar: true });
    expect(erro(base).erro).toMatch(/exige --confirmo-banco/);
    expect(erro([...base, '--confirmo-banco', '127.0.0.1:5433/outro']).erro).toMatch(/nao confere/);
    expect(erro([...base, '--confirmo-banco', BANCO], { databaseUrl: '' }).erro).toMatch(/nao confere/);
    expect(erro([...base, '--confirmo-banco', BANCO], { databaseUrl: 'nao-e-url' }).erro).toMatch(/nao confere/);
  });

  it('--confirmo-banco sem --gravar e erro', () => {
    expect(erro(['--criar', '--entrada', fora('e.csv'), '--confirmo-banco', BANCO]).erro).toMatch(/so vale junto com --gravar/);
  });

  it('a senha da DATABASE_URL nunca aparece na mensagem de erro', () => {
    const r = erro(['--criar', '--entrada', fora('e.csv'), '--gravar', '--confirmo-banco', 'x']);
    expect(JSON.stringify(r)).not.toMatch(/senha-fic|usuario/);
  });

  it('--relatorio: .csv fora do repo, inexistente e diferente da --entrada', () => {
    const base = ['--criar', '--entrada', fora('e.csv')];
    expect(ler1([...base, '--relatorio', fora('r.csv')])).toMatchObject({ ok: true, relatorio: fora('r.csv') });
    expect(erro([...base, '--relatorio', path.join(raizRepo, 'r.csv')]).erro).toMatch(/dentro do repositorio/);
    expect(erro([...base, '--relatorio', fora('r.csv')], { existe: () => true }).erro).toMatch(/ja existe/);
    expect(erro([...base, '--relatorio', fora('e.csv')]).erro).toMatch(/diferente de --entrada/);
    expect(erro([...base, '--relatorio', fora('r.txt')]).erro).toMatch(/\.csv/);
  });
});

describe('relatorio da criacao em lote', () => {
  const resultados: ResultadoProdutoNovo[] = [
    { linha: 2, status: 'aplicado', motivo: null, produtoId: 701 },
    { linha: 3, status: 'ja_aplicado', motivo: null, produtoId: 50 },
    { linha: 4, status: 'conflito', motivo: 'lead_time_divergente', produtoId: null },
    { linha: 5, status: 'item_mudou', motivo: 'codigo_do_item_mudou', produtoId: null },
    { linha: 6, status: 'erro', motivo: 'fonte_inexistente', produtoId: null },
    { linha: 7, status: 'ignorado', motivo: 'nao_aprovado', produtoId: null },
    { linha: 8, status: 'erro', motivo: 'cadastro_ocupado', produtoId: null },
  ];
  const relatorio = (gravar: boolean, lista = resultados): RelatorioProdutosNovos => ({
    gravar,
    resultados: lista,
    contagem: contarResultados(lista),
  });

  it('contarResultados traz os 6 status, zeros inclusive', () => {
    expect(contarResultados([])).toEqual({ aplicado: 0, ja_aplicado: 0, conflito: 0, item_mudou: 0, erro: 0, ignorado: 0 });
    expect(contarResultados(resultados)).toEqual({ aplicado: 1, ja_aplicado: 1, conflito: 1, item_mudou: 1, erro: 2, ignorado: 1 });
  });

  it('resumo: dry-run x gravado, contagens e so as linhas com problema (sem motivo, nome, codigo ou fonte)', () => {
    expect(resumoDoRelatorio(relatorio(false))).toEqual([
      'DRY-RUN: nada foi gravado.',
      'Linhas lidas: 7',
      '  aplicado: 1',
      '  ja_aplicado: 1',
      '  conflito: 1',
      '  item_mudou: 1',
      '  erro: 2',
      '  ignorado: 1',
      '  linha 4: conflito',
      '  linha 5: item_mudou',
      '  linha 6: erro',
      '  linha 8: erro',
    ]);
    expect(resumoDoRelatorio(relatorio(true))[0]).toBe('GRAVADO.');
  });

  it('cada linha do resumo casa com o formato fechado e nao vaza motivo, nome nem codigo', () => {
    const linhas = resumoDoRelatorio(relatorio(true));
    const formato = /^(DRY-RUN: nada foi gravado\.|GRAVADO\.|Linhas lidas: \d+|  [a-z_]+: \d+|  linha \d+: [a-z_]+)$/;
    for (const l of linhas) expect(l).toMatch(formato);
    const texto = linhas.join('\n');
    for (const proibido of ['lead_time_divergente', 'fonte_inexistente', 'codigo_do_item_mudou', 'FIC', 'nao_aprovado']) {
      expect(texto).not.toContain(proibido);
    }
  });

  it('resumo de lista vazia: so os zeros', () => {
    const linhas = resumoDoRelatorio(relatorio(false, []));
    expect(linhas).toHaveLength(8);
    expect(linhas.slice(1)).toEqual([
      'Linhas lidas: 0',
      '  aplicado: 0',
      '  ja_aplicado: 0',
      '  conflito: 0',
      '  item_mudou: 0',
      '  erro: 0',
      '  ignorado: 0',
    ]);
  });

  it('exit code: 0 so sem conflito/item_mudou/erro', () => {
    expect(codigoDeSaida(relatorio(false, resultados.slice(0, 2)))).toBe(0);
    expect(codigoDeSaida(relatorio(false, [resultados[0], resultados[5]]))).toBe(0);
    for (const i of [2, 3, 4]) expect(codigoDeSaida(relatorio(false, [resultados[i]]))).toBe(1);
  });

  it('CSV do relatorio: linha;status;motivo;produtoId (motivo e codigo fixo)', () => {
    expect(relatorioParaCsv(resultados.slice(0, 3))).toBe(
      `${BOM}linha;status;motivo;produtoId\r\n2;aplicado;;701\r\n3;ja_aplicado;;50\r\n4;conflito;lead_time_divergente;\r\n`,
    );
  });
});

// Mutante: a linha de aborto do lote vazar nome, codigo ou mensagem do erro (so o numero pode sair).
describe('lote interrompido por erro inesperado', () => {
  it('a unica linha impressa e "Linhas gravadas ate o erro: N" com N inteiro', () => {
    expect(resumoDeLoteInterrompido(0)).toBe('Linhas gravadas ate o erro: 0');
    expect(resumoDeLoteInterrompido(7)).toBe('Linhas gravadas ate o erro: 7');
    expect(resumoDeLoteInterrompido(7)).toMatch(/^Linhas gravadas ate o erro: \d+$/);
  });

  it('valor nao inteiro ou negativo vira 0 (nunca texto)', () => {
    for (const ruim of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(resumoDeLoteInterrompido(ruim)).toBe('Linhas gravadas ate o erro: 0');
    }
  });

  it('LoteInterrompido guarda o numero e a causa; a linha impressa nao contem a mensagem da causa', () => {
    const erro = new LoteInterrompido(3, new Error('FIC-SEGREDO 12345'));
    expect(erro.linhasGravadas).toBe(3);
    expect((erro.cause as Error).message).toBe('FIC-SEGREDO 12345');
    expect(resumoDeLoteInterrompido(erro.linhasGravadas)).not.toContain('FIC-SEGREDO');
  });
});
