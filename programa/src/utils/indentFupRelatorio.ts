// Relatorios XLSX da conferencia da FUP Indent (e leitura do de-para editado). Os arquivos gerados contem dados
// reais (nomes, precos): o CLI SO grava FORA do repositorio. A comissao aparece APENAS agregada por ano-mes na aba
// de reconciliacao com o DASH; nenhuma aba tem comissao por linha.
import ExcelJS from 'exceljs';
import { txt, valor } from './forecastXlsx';
import {
  type Conferencia,
  type EntradaDePara,
  type Reconciliacao,
  type TipoCadastro,
  TIPOS_CADASTRO,
} from './indentFupConferencia';
import { chaveCabecalho, type PerfilColuna } from './indentFupParse';

type Celula = string | number | null;

export const ABA_DEPARA = 'De-para';

function aba(wb: ExcelJS.Workbook, nome: string, cabecalhos: string[], linhas: Celula[][], larguras?: number[]): void {
  const ws = wb.addWorksheet(nome);
  ws.addRow(cabecalhos).font = { bold: true };
  for (const l of linhas) ws.addRow(l);
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  if (linhas.length > 0) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cabecalhos.length } };
  cabecalhos.forEach((_, i) => {
    ws.getColumn(i + 1).width = larguras?.[i] ?? 22;
  });
}

const pct = (parte: number, total: number): number => (total === 0 ? 0 : Math.round((parte / total) * 1000) / 10);

function abaReconciliacao(wb: ExcelJS.Workbook, rec: Reconciliacao): void {
  const linhas: Celula[][] = rec.meses.map((m) => [
    m.ano,
    m.mes,
    m.planilha.comissao,
    m.dash.comissao,
    m.diferenca.comissao,
    m.planilha.faturamento,
    m.dash.faturamento,
    m.diferenca.faturamento,
    m.planilha.volume,
    m.dash.volume,
    m.diferenca.volume,
    m.carregavel.comissao,
    m.carregavel.faturamento,
    m.carregavel.volume,
    m.status === 'DASH_DESATUALIZADO' ? 'DASH DESATUALIZADO' : m.status,
  ]);
  for (const t of rec.totais) {
    linhas.push([
      t.ano,
      'Total',
      t.planilha.comissao,
      t.dash.comissao,
      t.diferenca.comissao,
      t.planilha.faturamento,
      t.dash.faturamento,
      t.diferenca.faturamento,
      t.planilha.volume,
      t.dash.volume,
      t.diferenca.volume,
      null,
      null,
      null,
      t.status === 'DASH_DESATUALIZADO' ? 'DASH DESATUALIZADO' : t.status,
    ]);
  }
  for (const f of rec.anosForaDoDash) {
    linhas.push([
      f.ano,
      'Fora do DASH',
      f.planilha.comissao,
      null,
      null,
      f.planilha.faturamento,
      null,
      null,
      f.planilha.volume,
      null,
      null,
      null,
      null,
      null,
      'informativo',
    ]);
  }
  aba(
    wb,
    'Reconciliação',
    [
      'Ano',
      'Mês',
      'Comissão planilha',
      'Comissão DASH',
      'Dif. comissão',
      'Faturamento planilha',
      'Faturamento DASH',
      'Dif. faturamento',
      'Volume planilha',
      'Volume DASH',
      'Dif. volume',
      'Carregável: comissão',
      'Carregável: faturamento',
      'Carregável: volume',
      `Situação (tolerância ${rec.tolerancia})`,
    ],
    linhas,
    [8, 14, 18, 18, 14, 20, 20, 16, 16, 16, 12, 18, 20, 18, 22],
  );
}

/** Relatorio completo da conferencia (todas as abas do plano). */
export function montarRelatorioConferencia(conf: Conferencia, perfil: PerfilColuna[]): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  const r = conf.resumo;

  // Resumo
  const resumo: Celula[][] = [
    ['Linhas lidas', r.linhasLidas],
    ['Linhas aceitas', r.linhasAceitas],
    ['Linhas rejeitadas', r.linhasRejeitadas],
    ['Fornecedores: textos na FUP', r.fornecedoresTextos],
    ['Fornecedores: após normalização', r.fornecedoresDepois],
    ['Fornecedores: textos agrupados (sufixo/número)', r.fornecedoresAgrupados],
    ['Fornecedores: compostos com barra (exigem decisão)', r.fornecedoresCompostos],
    ['Clientes: textos na FUP', r.clientesTextos],
    ['Clientes: após normalização', r.clientesDepois],
    ['Produtos: textos na FUP', r.produtosTextos],
    ['Produtos: após normalização', r.produtosDepois],
    ['Produtos com mais de um NCM', r.produtosNcmMultiplo],
    ['Grupos de quase-duplicidade', r.quaseDuplicidades],
    ['Cadastros a criar: fornecedores / clientes / produtos', `${conf.plano.fornecedores.criar} / ${conf.plano.clientes.criar} / ${conf.plano.produtos.criar}`],
    ['Cadastros existentes usados: fornecedores / clientes / produtos', `${conf.plano.fornecedores.usar} / ${conf.plano.clientes.usar} / ${conf.plano.produtos.usar}`],
    ['Data de referência da janela de vínculos', conf.janela.end],
    ['Janela de vínculos (meses) / início', `${conf.janela.months} / ${conf.janela.start}`],
    ['Vínculos fornecedor-produto: entram', conf.plano.vinculos.entram],
    ['Vínculos fornecedor-produto: já existem', conf.plano.vinculos.jaExistem],
    ['Vínculos fornecedor-produto: fora da janela', conf.plano.vinculos.foraDaJanela],
    ['Histórico: pedidos / linhas / amostras', `${conf.plano.historico.pedidos} / ${conf.plano.historico.linhas} / ${conf.plano.historico.amostras}`],
    ['Reconciliação planilha x DASH', conf.reconciliacao ? (conf.reconciliacao.ok ? 'OK' : 'DIFERE') : 'DASH não encontrado'],
    ['Reconciliação: meses/totais com DASH desatualizado', conf.reconciliacao?.desatualizados ?? 0],
    [null, null],
    ['Rejeições por motivo', null],
    ...Object.entries(conf.plano.rejeicoesPorMotivo).map(([m, n]): Celula[] => [m, n]),
    [null, null],
    ['Alertas por tipo', null],
    ...Object.entries(conf.alertasPorTipo)
      .sort((a, b) => b[1] - a[1])
      .map(([m, n]): Celula[] => [m, n]),
  ];
  aba(wb, 'Resumo', ['Indicador', 'Valor'], resumo, [64, 24]);

  // Perfil de colunas
  aba(
    wb,
    'Perfil de colunas',
    ['Campo', 'Coluna', 'Cabeçalho', 'Linhas', '% vazio', 'Números', 'Textos', 'Datas', 'Fórmulas', 'Fórmulas sem resultado'],
    perfil.map((p) => [p.campo, p.coluna, p.cabecalho, p.total, pct(p.vazios, p.total), p.numeros, p.textos, p.datas, p.formulas, p.formulasSemResultado]),
    [20, 8, 26, 10, 10, 10, 10, 10, 10, 22],
  );

  // Fornecedores / Clientes
  aba(
    wb,
    'Fornecedores',
    ['Texto na FUP', 'Linhas', 'Chave', 'Regra de agrupamento', 'Fábrica', 'Cadastro', 'Ação', 'Id', 'Decisão no de-para', 'Problema'],
    conf.itens.FORNECEDOR.map((i) => [
      i.texto,
      i.linhas,
      i.chave,
      i.regra,
      i.resolvido?.plant ?? null,
      i.resolvido?.erro === null ? (i.resolvido?.nome ?? null) : null,
      i.resolvido?.erro === null ? (i.resolvido?.acao ?? null) : null,
      i.resolvido?.id ?? null,
      i.decisaoDePara,
      i.resolvido?.erro ?? null,
    ]),
    [34, 8, 30, 20, 14, 30, 8, 8, 20, 36],
  );
  aba(
    wb,
    'Clientes',
    ['Texto na FUP', 'Linhas', 'Chave', 'Cadastro', 'Ação', 'Id', 'Decisão no de-para', 'Problema'],
    conf.itens.CLIENTE.map((i) => [
      i.texto,
      i.linhas,
      i.chave,
      i.resolvido?.erro === null ? (i.resolvido?.nome ?? null) : null,
      i.resolvido?.erro === null ? (i.resolvido?.acao ?? null) : null,
      i.resolvido?.id ?? null,
      i.decisaoDePara,
      i.resolvido?.erro ?? null,
    ]),
    [40, 8, 36, 36, 8, 8, 20, 36],
  );

  // Produtos (com NCMs)
  const ncmPorRef = new Map(conf.produtosNcm.map((p) => [p.ref, p]));
  aba(
    wb,
    'Produtos',
    ['Texto na FUP', 'Linhas', 'Chave', 'Ação', 'Id', 'NCMs encontrados', 'Conflito de NCM', 'Decisão no de-para', 'Problema'],
    conf.itens.PRODUTO.map((i) => {
      const n = i.resolvido ? ncmPorRef.get(i.resolvido.ref) : undefined;
      return [
        i.texto,
        i.linhas,
        i.chave,
        i.resolvido?.erro === null ? (i.resolvido?.acao ?? null) : null,
        i.resolvido?.id ?? null,
        n ? n.ncms.map((x) => `${x.ncm} (${x.linhas})`).join('; ') : null,
        n?.conflito ? 'SIM' : null,
        i.decisaoDePara,
        i.resolvido?.erro ?? null,
      ];
    }),
    [44, 8, 40, 8, 8, 40, 14, 20, 36],
  );

  aba(
    wb,
    'Quase-duplicidades',
    ['Tipo de cadastro', 'Grupo', 'Critério', 'Texto', 'Origem', 'Linhas'],
    conf.quaseDuplicidades.map((q) => [q.kind, q.grupo, q.tipo, q.texto, q.origem, q.linhas]),
    [18, 8, 28, 44, 12, 8],
  );
  aba(
    wb,
    'Pares cliente-fornecedor',
    ['Cliente', 'Fornecedor', 'Linhas', 'Situação'],
    conf.paresClienteFornecedor.map((p) => [p.cliente, p.fornecedor, p.linhas, p.situacao]),
    [40, 30, 8, 36],
  );
  aba(
    wb,
    'Vínculos fornecedor-produto',
    ['Fornecedor', 'Produto', 'Linhas', 'Última DATA PO', 'Situação'],
    [
      ...conf.paresFornecedorProduto.map((p): Celula[] => [p.fornecedor, p.produto, p.linhas, p.ultimaDataPo, p.situacao]),
      [null, null, null, null, null],
      ['Totais', null, null, null, null],
      ['ENTRA', null, conf.plano.vinculos.entram, null, null],
      ['JA EXISTE', null, conf.plano.vinculos.jaExistem, null, null],
      ['FORA DA JANELA', null, conf.plano.vinculos.foraDaJanela, null, null],
      [`Janela: ${conf.janela.start} a ${conf.janela.end} (${conf.janela.months} meses)`, null, null, null, null],
    ],
    [30, 44, 8, 16, 18],
  );

  // Normalizacao (texto -> valor)
  const norm: Celula[][] = [];
  for (const [campo, lista] of Object.entries(conf.normalizacao)) {
    for (const i of lista) norm.push([campo, i.texto, i.valor, i.linhas]);
  }
  aba(wb, 'Normalização', ['Campo', 'Texto na FUP', 'Valor normalizado', 'Linhas'], norm, [14, 50, 40, 8]);

  aba(wb, 'Alertas por linha', ['Linha da planilha', 'Alerta'], conf.alertas.map((a) => [a.linha, a.alerta]), [18, 70]);
  aba(wb, 'Rejeições', ['Linha da planilha', 'Motivo'], conf.rejeicoes.map((a) => [a.linha, a.motivo]), [18, 70]);

  if (conf.reconciliacao) abaReconciliacao(wb, conf.reconciliacao);
  else aba(wb, 'Reconciliação', ['Aviso'], [['Aba DASH não encontrada ou fora do formato esperado.']], [70]);

  // De-para editavel: uma linha por texto da FUP; `decisao` e `plant` em branco = aplica a sugestao padrao.
  const dePara: Celula[][] = [];
  for (const kind of TIPOS_CADASTRO) {
    for (const i of conf.itens[kind]) {
      // `plant` em branco: aplica a fabrica derivada; so uma edicao explicita do Lucas vira entrada do de-para.
      dePara.push([kind, i.texto, i.linhas, i.sugestao, i.decisaoDePara, null]);
    }
  }
  aba(
    wb,
    ABA_DEPARA,
    ['tipo', 'texto FUP', 'linhas', 'sugestao', 'decisao', 'plant'],
    dePara,
    [14, 50, 8, 56, 28, 16],
  );
  const wsDePara = wb.getWorksheet(ABA_DEPARA);
  if (wsDePara) {
    wsDePara.getCell('E1').note = 'CRIAR | USAR:<id> | AGRUPAR:<texto FUP> | IGNORAR (vazio = aplica a sugestão)';
  }
  return wb;
}

/** Dry-run: o que a carga criaria/atualizaria/rejeitaria (em H1 o historico so e contado). */
export function montarDryRun(conf: Conferencia): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  const p = conf.plano;
  aba(
    wb,
    'Resumo',
    ['Item', 'Criar', 'Usar existente', 'Atualizar', 'Sem mudança', 'Rejeitar'],
    [
      ['Fornecedores', p.fornecedores.criar, p.fornecedores.usar, 0, 0, null],
      ['Clientes (CNPJ pendente)', p.clientes.criar, p.clientes.usar, 0, 0, null],
      ['Produtos', p.produtos.criar, p.produtos.usar, 0, 0, null],
      ['Vínculos fornecedor-produto (fora da janela: ' + p.vinculos.foraDaJanela + ')', p.vinculos.entram, p.vinculos.jaExistem, 0, 0, null],
      ['Pedidos (histórico, só contado)', p.historico.pedidos, 0, p.historico.atualizadas, p.historico.semMudanca, null],
      ['Linhas (histórico, só contado)', p.historico.linhas, 0, p.historico.atualizadas, p.historico.semMudanca, p.historico.rejeitadas],
    ],
    [34, 10, 16, 12, 14, 10],
  );
  const criar: Celula[][] = [];
  for (const kind of TIPOS_CADASTRO) {
    for (const c of conf.cadastros[kind]) {
      if (c.acao === 'CRIAR') criar.push([kind, c.nome, c.linhas, c.textos, c.plants.join('; ')]);
    }
  }
  aba(wb, 'Cadastros a criar', ['Tipo', 'Nome', 'Linhas', 'Textos da FUP', 'Fábricas'], criar, [14, 44, 8, 14, 30]);
  aba(wb, 'Rejeições', ['Linha da planilha', 'Motivo'], conf.rejeicoes.map((a) => [a.linha, a.motivo]), [18, 70]);
  return wb;
}

/** Relatorio so com a reconciliacao planilha x DASH. */
export function montarRelatorioReconciliacao(rec: Reconciliacao): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  abaReconciliacao(wb, rec);
  return wb;
}

export async function gravarWorkbook(wb: ExcelJS.Workbook, caminho: string): Promise<void> {
  await wb.xlsx.writeFile(caminho);
}

// ---------- de-para editado ----------

const KINDS = new Set<string>(['CLIENTE', 'FORNECEDOR', 'PRODUTO']);

/** Le a aba De-para do relatorio editado: so linhas com `decisao` (ou `plant`) preenchida. */
export function lerDeParaDeWorkbook(wb: ExcelJS.Workbook): { ok: true; entradas: EntradaDePara[] } | { ok: false; erro: string } {
  const ws = wb.getWorksheet(ABA_DEPARA);
  if (!ws) return { ok: false, erro: `aba "${ABA_DEPARA}" não encontrada` };
  const cab = ws.getRow(1);
  const col = new Map<string, number>();
  for (let c = 1; c <= cab.cellCount; c += 1) {
    const k = chaveCabecalho(txt(valor(cab.getCell(c))));
    if (k !== '' && !col.has(k)) col.set(k, c);
  }
  const cTipo = col.get('tipo');
  const cTexto = col.get('texto fup');
  const cDecisao = col.get('decisao');
  const cPlant = col.get('plant');
  if (!cTipo || !cTexto || !cDecisao) return { ok: false, erro: 'cabeçalhos tipo/texto FUP/decisao não encontrados' };
  const entradas: EntradaDePara[] = [];
  for (let r = 2; r <= ws.rowCount; r += 1) {
    const row = ws.getRow(r);
    const kind = txt(valor(row.getCell(cTipo))).trim().toUpperCase();
    const texto = txt(valor(row.getCell(cTexto))).trim();
    const decisao = txt(valor(row.getCell(cDecisao))).trim();
    const plant = cPlant ? txt(valor(row.getCell(cPlant))).trim() : '';
    if (texto === '' || (decisao === '' && plant === '')) continue;
    if (!KINDS.has(kind)) return { ok: false, erro: `linha ${r}: tipo inválido` };
    entradas.push({ kind: kind as TipoCadastro, texto, decisao, plant });
  }
  return { ok: true, entradas };
}

export async function lerDeParaArquivo(caminho: string): Promise<ReturnType<typeof lerDeParaDeWorkbook>> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(caminho);
  return lerDeParaDeWorkbook(wb);
}
