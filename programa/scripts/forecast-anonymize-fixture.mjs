// Gera a fixture ANONIMIZADA de paridade do Forecast a partir do JSON do prototipo.
// O repo e publico: o JSON real (nomes, codigos DBCorp, fontes, margens) NUNCA entra no repo;
// so a saida deste script (tests/fixtures/forecast/quinzena-10-2.anon.json).
//
// Uso:
//   node scripts/forecast-anonymize-fixture.mjs <entrada.json> <saida.json>
//
// Regras (PLAN.md, D1 = A):
//   codigo  -> C0001.. (mesmo mapa em produtos e em TODAS as entradas; chave em maiusculas)
//   item    -> PRODUTO 001..
//   fonte   -> FONTE 001.. (produtos e LEADTIME; chave em maiusculas, como o PROCV)
//   obs / embalagem / qtdAmostra / solicitarAmostra / arquivo -> ''
//   margem  -> valor pseudoaleatorio deterministico em [0, 0.5) por codigo anonimizado
//   esperado[linha].AR regravado com a margem do 1o codigo do produto presente na lista (PROCX);
//   as demais 27 colunas ficam intocadas. precoFechado, quantidades, lead times, meses e status ficam.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [, , entrada, saida] = process.argv;
if (!entrada || !saida) {
  console.error('Uso: node scripts/forecast-anonymize-fixture.mjs <entrada.json> <saida.json>');
  process.exit(1);
}
if (resolve(entrada) === resolve(saida)) {
  console.error('Entrada e saida nao podem ser o mesmo arquivo.');
  process.exit(1);
}

const q = JSON.parse(readFileSync(entrada, 'utf8'));

function criarMapa(prefixo, largura) {
  const mapa = new Map();
  return (chave) => {
    if (!mapa.has(chave)) mapa.set(chave, prefixo + String(mapa.size + 1).padStart(largura, '0'));
    return mapa.get(chave);
  };
}

const anonCodigo = criarMapa('C', 4);
const anonFonte = criarMapa('FONTE ', 3);

// Vazio continua vazio (EMB.6/EMB.7 sem uso, produto sem fonte).
const codigo = (c) => (c ? anonCodigo(c.toUpperCase()) : '');
const fonte = (f) => (f ? anonFonte(f.toUpperCase()) : '');

// Ordem de atribuicao: produtos (ordem da planilha), depois entradas.
const produtos = q.produtos.map((p, i) => ({
  ...p,
  item: `PRODUTO ${String(i + 1).padStart(3, '0')}`,
  codigos: p.codigos.map(codigo),
  obs: '',
  fonte: fonte(p.fonte),
  embalagem: '',
  qtdAmostra: '',
  solicitarAmostra: '',
}));

const e = q.entradas;
const comCodigo = (lista) => lista.map((l) => ({ ...l, codigo: codigo(l.codigo) }));

// Margem deterministica derivada so do codigo ja anonimizado (nao do valor real).
function margemFalsa(codigoAnonimo) {
  const h = createHash('sha256').update(`forecast-margem:${codigoAnonimo}`).digest();
  const u = h.readUInt32BE(0) / 2 ** 32; // [0, 1)
  return Math.round(u * 0.5 * 10000) / 10000; // [0, 0.5), 4 casas
}

const margem = e.margem.map((m) => {
  const c = codigo(m.codigo);
  return { codigo: c, margem: m.margem === null ? null : margemFalsa(c) };
});

const entradas = {
  estoque: comCodigo(e.estoque),
  vendasMes: comCodigo(e.vendasMes),
  vendasAtual: comCodigo(e.vendasAtual),
  vendasAnual: comCodigo(e.vendasAnual),
  programacoes: comCodigo(e.programacoes),
  chegadas: comCodigo(e.chegadas),
  leadtime: e.leadtime.map((l) => ({ ...l, fonte: fonte(l.fonte) })),
  margem,
  clientesAtivos: e.clientesAtivos.map(codigo),
};

// PROCX: primeira ocorrencia de cada codigo na lista de margem.
const margemPorCodigo = new Map();
for (const m of margem) {
  if (m.codigo && !margemPorCodigo.has(m.codigo)) margemPorCodigo.set(m.codigo, m.margem ?? 0);
}

const porLinha = new Map(produtos.map((p) => [String(p.linha), p]));
const esperado = {};
for (const [linha, colunas] of Object.entries(q.esperado)) {
  const novas = { ...colunas };
  if ('AR' in novas) {
    let ar = 0; // sem margem cadastrada: a planilha grava 0
    for (const c of porLinha.get(linha)?.codigos ?? []) {
      if (c && margemPorCodigo.has(c)) {
        ar = margemPorCodigo.get(c);
        break;
      }
    }
    novas.AR = ar;
  }
  esperado[linha] = novas;
}

const saidaJson = {
  id: q.id,
  arquivo: '',
  dataBase: q.dataBase,
  mesesConsumo: q.mesesConsumo,
  mesesChegada: q.mesesChegada,
  mesesProgramacao: q.mesesProgramacao,
  produtos,
  entradas,
  esperado,
};

writeFileSync(saida, JSON.stringify(saidaJson) + '\n', 'utf8');
console.log(`OK: ${produtos.length} produtos; fixture anonimizada gravada em ${saida}`);
