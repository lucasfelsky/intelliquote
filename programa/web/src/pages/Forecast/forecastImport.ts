// Funcoes PURAS da importacao da quinzena (PR 1D-2): slots dos relatorios DBCorp, rotulo derivado,
// limite de 10 MB, montagem dos corpos e leitura do resumo. Nada aqui usa `Date` (fuso BRT).
import {
  FORECAST_BASE64_MAX_LENGTH,
  FORECAST_JSON_BODY_LIMIT_BYTES,
  ForecastLocalError,
  type ForecastArquivoBody,
  type ForecastDbcorpBody,
  type ForecastDbcorpFiles,
  type ForecastDbcorpSlot,
  type ForecastDbcorpSummary,
  type ForecastLinhasKg,
  type ForecastPorStatus,
  type ForecastRelatorioResumo,
  type ForecastWorkbookBody,
} from '@/services/forecast';

export interface SlotDbcorp {
  id: ForecastDbcorpSlot;
  rotulo: string;
  origem: string | null;
  ajuda?: string;
  obrigatorio: (half: 1 | 2 | null) => boolean;
}

/** Na ordem de `FORECAST_DBCORP_SLOTS` (backend). */
export const SLOTS_DBCORP: readonly SlotDbcorp[] = [
  { id: 'saldo', rotulo: 'SALDO', origem: 'DS9004', obrigatorio: () => true },
  { id: 'vendasMes', rotulo: 'VENDAS do mês anterior', origem: 'DS9003', obrigatorio: () => true },
  {
    id: 'vendasAtual',
    rotulo: 'VENDAS do mês atual (até o dia 15)',
    origem: 'DS9003',
    ajuda: 'Na 1ª quinzena só preenche a coluna do mês atual.',
    obrigatorio: (half) => half === 2,
  },
  { id: 'vendasAnual', rotulo: 'VENDAS anual', origem: 'DS9003', obrigatorio: () => true },
  { id: 'programacao', rotulo: 'PROGRAMAÇÃO', origem: null, obrigatorio: () => true },
  { id: 'fup', rotulo: 'FUP', origem: null, obrigatorio: () => true },
  { id: 'clientesAtivos', rotulo: 'CLIENTES ATIVOS', origem: 'DS9002', obrigatorio: () => false },
  { id: 'margem', rotulo: 'MARGEM', origem: null, obrigatorio: () => false },
];

export function rotuloDoSlot(id: ForecastDbcorpSlot): string {
  return SLOTS_DBCORP.find((s) => s.id === id)?.rotulo ?? id;
}

/** AAAA-MM-DD valida (dias do mes com bissexto), sem `Date`. */
export function dataBaseValida(texto: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
  if (!m) return false;
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  if (ano < 1900 || mes < 1 || mes > 12 || dia < 1) return false;
  const bissexto = (ano % 4 === 0 && ano % 100 !== 0) || ano % 400 === 0;
  const diasDoMes = [31, bissexto ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mes - 1] ?? 0;
  return dia <= diasDoMes;
}

/** `MM-q`: mes da data-base + quinzena (base 2026-10-15 + 2ª -> `10-2`); vazio se faltar algo. */
export function rotuloDaQuinzena(baseDate: string, quinzena: 1 | 2 | null): string {
  if (!dataBaseValida(baseDate) || quinzena === null) return '';
  return `${baseDate.slice(5, 7)}-${quinzena}`;
}

/** Ids dos slots obrigatorios (para a quinzena escolhida) ainda sem arquivo. */
export function faltando(
  arquivos: Partial<Record<ForecastDbcorpSlot, unknown>>,
  half: 1 | 2 | null,
): ForecastDbcorpSlot[] {
  return SLOTS_DBCORP.filter((s) => s.obrigatorio(half) && !arquivos[s.id]).map((s) => s.id);
}

// ---------- limite de 10 MB ----------

export function tamanhoBase64(bytes: number): number {
  return Math.ceil(bytes / 3) * 4;
}

export function extensaoOk(nome: string): boolean {
  return /\.xlsx$/i.test(nome);
}

export interface ArquivoEscolhido {
  /** Rotulo do slot ("SALDO"); vazio na aba Planilha. */
  rotulo: string;
  file: Pick<File, 'name' | 'size'>;
}

const MB = 1024 * 1024;
const FOLGA_BYTES = 64 * 1024;

function mbBr(bytes: number): string {
  return (bytes / MB).toFixed(1).replace('.', ',');
}

function mensagemTotal(bytes: number): string {
  return `Os arquivos somam ${mbBr(bytes)} MB depois da codificação; o limite é 10 MB no total. Envie relatórios menores.`;
}

/** Limite por arquivo e no total, pelo `File.size` (antes de ler). `null` = cabe. */
export function checarTamanhos(arquivos: readonly ArquivoEscolhido[]): string | null {
  let soma = 0;
  for (const { rotulo, file } of arquivos) {
    const codificado = tamanhoBase64(file.size);
    if (codificado > FORECAST_BASE64_MAX_LENGTH) {
      const quem = rotulo ? `${rotulo} (${file.name})` : file.name;
      return `O arquivo ${quem} passa do limite de 10 MB depois da codificação.`;
    }
    soma += codificado;
  }
  if (soma + FOLGA_BYTES > FORECAST_JSON_BODY_LIMIT_BYTES) return mensagemTotal(soma + FOLGA_BYTES);
  return null;
}

/** Extensao, arquivo vazio e limites, nesta ordem. `null` = pode ler e enviar. */
export function checarArquivos(arquivos: readonly ArquivoEscolhido[]): string | null {
  for (const { rotulo, file } of arquivos) {
    if (!extensaoOk(file.name)) return rotulo ? `Envie o relatório ${rotulo} em .xlsx.` : 'Envie a planilha em .xlsx.';
  }
  for (const { file } of arquivos) {
    if (file.size === 0) return `O arquivo ${file.name} está vazio.`;
  }
  return checarTamanhos(arquivos);
}

/** Tamanho exato do JSON que sera enviado. */
export function bytesDoCorpo(corpo: unknown): number {
  return new TextEncoder().encode(JSON.stringify(corpo)).length;
}

/** Confere o corpo ja montado (depois de ler os arquivos). `null` = cabe. */
export function checarCorpo(corpo: unknown): string | null {
  const bytes = bytesDoCorpo(corpo);
  return bytes > FORECAST_JSON_BODY_LIMIT_BYTES ? mensagemTotal(bytes) : null;
}

// Mesma implementacao de `readFileAsBase64` de `web/src/services/supplierDocuments.ts`
// (copia local proposital, como em `SupplierImportModal.tsx`: nao acopla dominios).
export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = String(reader.result ?? '').split(',')[1];
      if (!base64) reject(new ForecastLocalError(`Não foi possível ler o arquivo ${file.name}.`));
      else resolve(base64);
    };
    reader.onerror = () => reject(new ForecastLocalError(`Não foi possível ler o arquivo ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

// ---------- corpos ----------

export function montarCorpoPlanilha(
  fileName: string,
  contentBase64: string,
  label: string,
  baseDate: string,
): ForecastWorkbookBody {
  return { contentBase64, fileName, label, baseDate };
}

/** So os slots com arquivo entram em `files` (nada alem do contrato). */
export function montarCorpoDbcorp(
  label: string,
  baseDate: string,
  arquivos: Partial<Record<ForecastDbcorpSlot, ForecastArquivoBody>>,
): ForecastDbcorpBody {
  const files: Partial<Record<ForecastDbcorpSlot, ForecastArquivoBody>> = {};
  for (const { id } of SLOTS_DBCORP) {
    const arquivo = arquivos[id];
    if (arquivo) files[id] = { fileName: arquivo.fileName, contentBase64: arquivo.contentBase64 };
  }
  return { label, baseDate, files: files as ForecastDbcorpFiles };
}

// ---------- leitura do resumo ----------

/**
 * Slots presentes no resumo com `usadas === 0`, menos `vendasMes` (vazio ja vira erro no parser e o
 * confirm recusa). Decidido pelos NUMEROS, nunca pelo texto dos avisos.
 */
export function slotsSemLinhasUteis(resumo: Pick<ForecastDbcorpSummary, 'relatorios'>): ForecastDbcorpSlot[] {
  const lista: ForecastDbcorpSlot[] = [];
  for (const { id } of SLOTS_DBCORP) {
    if (id === 'vendasMes') continue;
    const relatorio: ForecastRelatorioResumo | undefined = resumo.relatorios[id];
    if (relatorio && relatorio.usadas === 0) lista.push(id);
  }
  return lista;
}

const MOTIVOS: Record<string, string> = {
  'sem codigo': 'sem código',
  'quantidade nao numerica': 'quantidade não numérica',
  'outra empresa': 'outra empresa',
  'deposito excluido': 'depósito excluído',
  'status concluido': 'status concluído',
  'atracada aguardando liberacao': 'atracada aguardando liberação',
  'eta final preenchida': 'ETA FINAL preenchida (já chegou)',
  'prontidao nao reconhecida': 'DATA PRONTIDÃO não reconhecida',
  'sem data': 'sem data',
  'depois da janela': 'depois da janela',
  'sem data de faturamento valida': 'sem data de faturamento válida',
  'fora da janela (antes do mes base)': 'fora da janela (antes do mês base)',
  'fora da janela (depois dos 4 meses)': 'fora da janela (depois dos 4 meses)',
  'status diferente de Pendente': 'status diferente de Pendente',
};

/** Motivo de linha ignorada com acento; motivo desconhecido aparece cru. */
export function rotuloDoMotivo(motivo: string): string {
  return MOTIVOS[motivo] ?? motivo;
}

/** `2026-09` -> `09/2026`; nulo = "—". */
export function mesAno(yearMonth: string | null | undefined): string {
  const m = yearMonth ? /^(\d{4})-(\d{2})$/.exec(yearMonth) : null;
  return m ? `${m[2]}/${m[1]}` : '—';
}

export function totaisDeposito(
  porDeposito: ReadonlyArray<{ incluido: boolean; saldo: number }>,
): { incluido: number; excluido: number } {
  let incluido = 0;
  let excluido = 0;
  for (const d of porDeposito) {
    if (d.incluido) incluido += d.saldo;
    else excluido += d.saldo;
  }
  return { incluido, excluido };
}

/**
 * FUP: kg dos status que entram, SEM as linhas com ETA FINAL preenchida (a regra F3 as exclui das chegadas: ja
 * chegaram). O backend as mantem dentro do status que entra, entao `etaFinalKg`
 * (`excluidas.etaFinalPreenchida.kg`) sai da soma. Backend antigo (sem `excluidas`): 0.
 */
export function kgEmAberto(
  porStatus: ReadonlyArray<Pick<ForecastPorStatus, 'incluido' | 'kg'>>,
  etaFinalKg = 0,
): number {
  const soma = porStatus.reduce((total, s) => (s.incluido ? total + (s.kg ?? 0) : total), 0);
  return Math.max(0, soma - etaFinalKg);
}

/** % inteiro do FUP sem data sobre o em aberto; `null` se o em aberto for 0. */
export function percentualSemData(semData: Pick<ForecastLinhasKg, 'kg'>, emAberto: number): number | null {
  if (emAberto <= 0) return null;
  return Math.round((semData.kg / emAberto) * 100);
}

/** Dias da estimativa do FUP (ETD + d, DATA PRONTIDAO + p); 35/35 quando o backend antigo nao manda `regra`. */
export function diasDaRegraFup(regra?: ForecastRelatorioResumo['regra']): { etd: number; prontidao: number } {
  return { etd: regra?.etaPorEtdDias ?? 35, prontidao: regra?.etaPorProntidaoDias ?? 35 };
}

/** FUP com DATA PRONTIDAO nao reconhecida: linhas e kg que ficam FORA das chegadas; `null` se nao ha (ou ausente). */
export function prontidaoPendente(
  resumo: Pick<ForecastDbcorpSummary, 'relatorios'>,
): { linhas: number; kg: number } | null {
  const p = resumo.relatorios.fup?.prontidaoNaoReconhecida;
  return p && p.linhas > 0 ? { linhas: p.linhas, kg: p.kg } : null;
}

/** `1 linha ... fica` / `2 linhas ... ficam`: texto do checkbox da trava suave da DATA PRONTIDAO. */
export function textoEntendiProntidao(p: { linhas: number; kg: number }, formatar: (n: number) => string): string {
  const singular = p.linhas === 1;
  return `Entendi que ${formatar(p.linhas)} ${singular ? 'linha' : 'linhas'} (${formatar(p.kg)} kg) do FUP com DATA PRONTIDÃO não reconhecida ${singular ? 'fica' : 'ficam'} fora das chegadas.`;
}

const AVISO_SEM_PRONTIDAO = 'coluna "DATA PRONTIDÃO" não encontrada';
const AVISO_SEM_DATA_PO = 'coluna "DATA PO" não encontrada';

/**
 * Avisos do resumo sem redundancia: sem a coluna DATA PRONTIDAO, o aviso de DATA PO ausente ("o ano da DATA
 * PRONTIDAO usa a data base") nao tem o que dizer; fica so o da prontidao. Ordem e demais textos intactos.
 */
export function avisosSemRedundancia(avisos: readonly string[]): string[] {
  const semProntidao = avisos.some((a) => a.includes(AVISO_SEM_PRONTIDAO));
  return avisos.filter((a) => !(semProntidao && a.includes(AVISO_SEM_DATA_PO)));
}

// ---------- leitura dos arquivos escolhidos (checa antes de ler e depois de montar o corpo) ----------

/** Valida, le e monta o corpo da planilha. Qualquer recusa vira ForecastLocalError (nenhum POST). */
export async function lerCorpoPlanilha(file: File, label: string, baseDate: string): Promise<ForecastWorkbookBody> {
  const recusa = checarArquivos([{ rotulo: '', file }]);
  if (recusa) throw new ForecastLocalError(recusa);
  const corpo = montarCorpoPlanilha(file.name, await readFileAsBase64(file), label, baseDate);
  const grande = checarCorpo(corpo);
  if (grande) throw new ForecastLocalError(grande);
  return corpo;
}

/** Idem para os relatorios DBCorp: so os slots com arquivo entram. */
export async function lerCorpoDbcorp(
  arquivos: Partial<Record<ForecastDbcorpSlot, File>>,
  label: string,
  baseDate: string,
): Promise<ForecastDbcorpBody> {
  const escolhidos = SLOTS_DBCORP.flatMap((s) => {
    const file = arquivos[s.id];
    return file ? [{ id: s.id, rotulo: s.rotulo, file }] : [];
  });
  const recusa = checarArquivos(escolhidos);
  if (recusa) throw new ForecastLocalError(recusa);
  const lidos: Partial<Record<ForecastDbcorpSlot, ForecastArquivoBody>> = {};
  for (const { id, file } of escolhidos) lidos[id] = { fileName: file.name, contentBase64: await readFileAsBase64(file) };
  const corpo = montarCorpoDbcorp(label, baseDate, lidos);
  const grande = checarCorpo(corpo);
  if (grande) throw new ForecastLocalError(grande);
  return corpo;
}
