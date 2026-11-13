// Argumentos e guardas do script `scripts/indent-fup-carga.ts` (conferencia/dry-run/reconciliacao da FUP Indent).
//   --conferencia --planilha <fup.xlsx> --saida <relatorio.xlsx> [--sem-banco]
//       [--data-referencia AAAA-MM-DD (padrao: hoje em Brasilia)] [--janela-vinculos-meses N (1..240, padrao 24)]
//   --aplicar --planilha <fup.xlsx> [--de-para <relatorio editado.xlsx>] --saida <dryrun.xlsx> [--sem-banco]
//       (DRY-RUN por padrao; --gravar exige --confirmo-banco <host:porta/banco> e --operador "<nome>")
//   --reconciliar --fonte planilha|banco --planilha <fup.xlsx> --saida <reconciliacao.xlsx>
// Arquivos de saida/de-para DENTRO do repo sao recusados (o repositorio e publico; os relatorios tem dado real).
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { bancoDaUrl } from './forecastCatalogoBackfill';
import { JANELA_VINCULOS_PADRAO_MESES, type Cadastros } from './indentFupConferencia';
import { isValidDateKey } from './indentFupNormalize';

export type ConfigIndentFup =
  | {
      ok: true;
      modo: 'conferencia';
      planilha: string;
      saida: string;
      semBanco: boolean;
      dataReferencia: string;
      janelaVinculosMeses: number;
    }
  | {
      ok: true;
      modo: 'aplicar';
      planilha: string;
      deParaArquivo: string | null;
      saida: string;
      semBanco: boolean;
      dataReferencia: string;
      janelaVinculosMeses: number;
      gravar: boolean;
      confirmoBanco: string | null;
      operador: string | null;
    }
  | { ok: true; modo: 'reconciliar'; fonte: 'planilha' | 'banco'; planilha: string; saida: string };

export type ErroArgumentos = { ok: false; erro: string; codigo: 2 };

// ---------- guarda de caminho (resolve o caminho REAL) ----------

const PREFIXO_LONGO = String.raw`\\?\ `.trim(); // \\?\
const PREFIXO_LONGO_UNC = String.raw`\\?\UNC\ `.trim(); // \\?\UNC\

/**
 * Caminho absoluto e REAL de `alvo`, mesmo que o arquivo ainda nao exista: resolve com realpath o ancestral
 * existente mais profundo (junction/symlink, nome curto 8.3 e caixa viram o nome real) e acrescenta o resto.
 * Tira o prefixo de caminho longo do Windows. Devolve null se nao der para resolver (quem chama recusa).
 */
export function caminhoReal(alvo: string): string | null {
  try {
    let abs = path.resolve(alvo);
    if (abs.startsWith(PREFIXO_LONGO_UNC)) abs = `\\\\${abs.slice(PREFIXO_LONGO_UNC.length)}`;
    else if (abs.startsWith(PREFIXO_LONGO)) abs = abs.slice(PREFIXO_LONGO.length);
    let existente = abs;
    for (;;) {
      try {
        fs.lstatSync(existente);
        break;
      } catch {
        const pai = path.dirname(existente);
        if (pai === existente) return null;
        existente = pai;
      }
    }
    const real = fs.realpathSync.native(existente);
    const resto = path.relative(existente, abs);
    return resto === '' ? real : path.join(real, resto);
  } catch {
    return null;
  }
}

/** O caminho (real) esta dentro de `raizRepo` (real)? Nao resolvido = trata como dentro (recusa). */
export function dentroDoRepoReal(alvo: string, raizRepo: string): boolean {
  const a = caminhoReal(alvo);
  const r = caminhoReal(raizRepo);
  if (a === null || r === null) return true;
  const rel = path.relative(r, a);
  if (rel === '') return true;
  const fora = rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel);
  return !fora;
}

/** Os dois caminhos apontam para o mesmo arquivo (caminho real, caixa ou mesmo inode)? Nao resolvido = sim. */
export function mesmoArquivo(a: string, b: string): boolean {
  const ra = caminhoReal(a);
  const rb = caminhoReal(b);
  if (ra === null || rb === null) return true;
  if (path.relative(ra, rb) === '') return true;
  try {
    const sa = fs.statSync(ra, { bigint: true });
    const sb = fs.statSync(rb, { bigint: true });
    return sa.ino !== BigInt(0) && sa.ino === sb.ino && sa.dev === sb.dev;
  } catch {
    return false;
  }
}

/** Data de hoje (YYYY-MM-DD) em America/Sao_Paulo; `agora` injetavel para teste. */
export function hojeEmBrasilia(agora: Date = new Date()): string {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(agora);
  const p = (tipo: string): string => partes.find((x) => x.type === tipo)?.value ?? '';
  return `${p('year')}-${p('month')}-${p('day')}`;
}

export function lerArgumentos(
  argv: readonly string[],
  ctx: { raizRepo: string; databaseUrl: string; agora?: Date },
): ConfigIndentFup | ErroArgumentos {
  const falha = (erro: string): ErroArgumentos => ({ ok: false, erro, codigo: 2 });
  const comValor = new Set(['--planilha', '--saida', '--de-para', '--fonte', '--confirmo-banco', '--operador', '--data-referencia', '--janela-vinculos-meses']);
  const flags = new Set(['--conferencia', '--aplicar', '--reconciliar', '--gravar', '--sem-banco']);
  const valores = new Map<string, string>();
  const marcados = new Set<string>();

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (flags.has(arg)) {
      if (marcados.has(arg)) return falha(`Argumento repetido: ${arg}.`);
      marcados.add(arg);
    } else if (comValor.has(arg)) {
      const valor = argv[i + 1];
      if (valor === undefined || valor.startsWith('--')) return falha(`Falta o valor de ${arg}.`);
      if (valores.has(arg)) return falha(`Argumento repetido: ${arg}.`);
      valores.set(arg, valor);
      i += 1;
    } else {
      return falha(`Argumento desconhecido: ${arg}.`);
    }
  }

  const modos = ['--conferencia', '--aplicar', '--reconciliar'].filter((m) => marcados.has(m));
  if (modos.length === 0) return falha('Informe o modo: --conferencia, --aplicar ou --reconciliar.');
  if (modos.length > 1) return falha('Escolha só um modo: --conferencia, --aplicar ou --reconciliar.');
  const modo = modos[0];

  const proibidos = (lista: string[], motivo: string): ErroArgumentos | null => {
    const achado = lista.find((a) => marcados.has(a) || valores.has(a));
    return achado ? falha(`${achado} não é aceito: ${motivo}`) : null;
  };

  const planilha = valores.get('--planilha');
  if (!planilha) return falha('Informe --planilha <arquivo.xlsx>.');
  if (path.extname(planilha).toLowerCase() !== '.xlsx') return falha('--planilha deve terminar em .xlsx.');
  const saida = valores.get('--saida');
  if (!saida) return falha('Informe --saida <arquivo.xlsx>.');
  if (path.extname(saida).toLowerCase() !== '.xlsx') return falha('--saida deve terminar em .xlsx.');
  if (dentroDoRepoReal(saida, ctx.raizRepo)) {
    return falha('--saida está dentro do repositório: grave fora dele (o repositório é público).');
  }
  if (mesmoArquivo(saida, planilha)) {
    return falha('--saida não pode ser o mesmo arquivo de --planilha (a FUP de origem nunca é sobrescrita).');
  }

  // Janela de vinculos (D9): so conferencia/aplicar. Padrao: 24 meses e hoje em Brasilia.
  let dataReferencia = '';
  let janelaVinculosMeses = JANELA_VINCULOS_PADRAO_MESES;
  if (modo === '--reconciliar') {
    const erro = proibidos(['--data-referencia', '--janela-vinculos-meses'], 'só vale para --conferencia e --aplicar.');
    if (erro) return erro;
  } else {
    const dataTxt = valores.get('--data-referencia');
    if (dataTxt !== undefined && !isValidDateKey(dataTxt)) return falha('--data-referencia deve ser uma data válida AAAA-MM-DD.');
    dataReferencia = dataTxt ?? hojeEmBrasilia(ctx.agora);
    const mesesTxt = valores.get('--janela-vinculos-meses');
    if (mesesTxt !== undefined) {
      const n = /^\d+$/.test(mesesTxt) ? Number(mesesTxt) : NaN;
      if (!Number.isInteger(n) || n < 1 || n > 240) return falha('--janela-vinculos-meses deve ser um inteiro entre 1 e 240.');
      janelaVinculosMeses = n;
    }
  }

  if (modo === '--conferencia') {
    const erro = proibidos(
      ['--gravar', '--confirmo-banco', '--operador', '--de-para', '--fonte'],
      '--conferencia é somente leitura (não grava no banco).',
    );
    if (erro) return erro;
    return {
      ok: true,
      modo: 'conferencia',
      planilha,
      saida,
      semBanco: marcados.has('--sem-banco'),
      dataReferencia,
      janelaVinculosMeses,
    };
  }

  if (modo === '--reconciliar') {
    const erro = proibidos(
      ['--gravar', '--confirmo-banco', '--operador', '--de-para', '--sem-banco'],
      '--reconciliar é somente leitura.',
    );
    if (erro) return erro;
    const fonte = valores.get('--fonte');
    if (fonte !== 'planilha' && fonte !== 'banco') return falha('Informe --fonte planilha ou --fonte banco.');
    return { ok: true, modo: 'reconciliar', fonte, planilha, saida };
  }

  // --aplicar
  if (valores.has('--fonte')) return falha('--fonte só vale para --reconciliar.');
  const deParaArquivo = valores.get('--de-para') ?? null;
  if (deParaArquivo !== null) {
    if (path.extname(deParaArquivo).toLowerCase() !== '.xlsx') return falha('--de-para deve terminar em .xlsx.');
    if (dentroDoRepoReal(deParaArquivo, ctx.raizRepo)) {
      return falha('--de-para está dentro do repositório: mantenha o arquivo fora dele (o repositório é público).');
    }
    if (mesmoArquivo(saida, deParaArquivo)) {
      return falha('--saida não pode ser o mesmo arquivo de --de-para (a planilha de decisões não é sobrescrita).');
    }
  }
  const gravar = marcados.has('--gravar');
  const confirmoBanco = valores.get('--confirmo-banco') ?? null;
  const operador = valores.get('--operador') ?? null;
  if (!gravar) {
    if (confirmoBanco !== null || operador !== null) {
      return falha('--confirmo-banco e --operador só valem com --gravar.');
    }
  } else {
    if (marcados.has('--sem-banco')) return falha('--gravar não combina com --sem-banco.');
    if (confirmoBanco === null) {
      return falha('--gravar exige --confirmo-banco <host:porta/banco> igual ao da DATABASE_URL.');
    }
    const banco = bancoDaUrl(ctx.databaseUrl);
    if (banco === '' || confirmoBanco !== banco) {
      return falha('--confirmo-banco não confere com o host:porta/banco da DATABASE_URL: nada foi gravado.');
    }
    if (operador === null || operador.trim() === '') return falha('--gravar exige --operador "<nome>".');
  }
  return {
    ok: true,
    modo: 'aplicar',
    planilha,
    deParaArquivo,
    saida,
    semBanco: marcados.has('--sem-banco'),
    dataReferencia,
    janelaVinculosMeses,
    gravar,
    confirmoBanco,
    operador,
  };
}

/**
 * Le os cadastros Indent numa transacao READ ONLY (SET TRANSACTION READ ONLY como 1a instrucao: o Postgres recusa
 * qualquer escrita). Somente colunas de identificacao: nada de CNPJ, contato ou preco.
 */
export async function lerCadastrosSomenteLeitura(prisma: Pick<PrismaClient, '$transaction'>): Promise<Cadastros> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const fornecedores = await tx.indentSupplier.findMany({ select: { id: true, name: true, nameKey: true } });
      const clientes = await tx.indentClient.findMany({ select: { id: true, name: true, supplierRuleMode: true } });
      const produtos = await tx.indentProduct.findMany({ select: { id: true, name: true, nameKey: true } });
      const vinculos = await tx.indentSupplierProduct.findMany({ select: { supplierId: true, productId: true } });
      const regras = await tx.indentClientSupplierRule.findMany({ select: { clientId: true, supplierId: true } });
      return {
        fornecedores,
        clientes: clientes.map((c) => ({ id: c.id, name: c.name, supplierRuleMode: c.supplierRuleMode })),
        produtos,
        vinculos,
        regras,
      };
    },
    { timeout: 60_000, maxWait: 10_000 },
  );
}
