import { Incoterm } from '@prisma/client';
import exceljs from 'exceljs';
import { supplierImportRowSchema } from '../validators/domain';

// Ordem fixa das colunas na planilha de importação de fornecedores
// (cabeçalho na linha 1). Fonte única compartilhada pelo parser, pela
// validação do cabeçalho e pelo modelo gerado via `buildSupplierImportTemplate`.
export const SUPPLIER_IMPORT_COLUMNS = [
  'Nome*',
  'País',
  'Website',
  'Incoterms*',
  'Prazo pagamento (dias)',
  'Famílias',
  'Tags',
  'Observações',
  'Contato nome',
  'Contato e-mail',
  'Contato telefone',
  'Contato cargo',
] as const;

export const SUPPLIER_IMPORT_MAX_ROWS = 500;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeSupplierName(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeHeaderCell(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\*/g, '')
    .trim()
    .toLowerCase();
}

export function isSupplierImportHeaderValid(cells: string[]): boolean {
  return SUPPLIER_IMPORT_COLUMNS.every(
    (expected, idx) => normalizeHeaderCell(cells[idx] ?? '') === normalizeHeaderCell(expected),
  );
}

export interface SupplierImportFamilyRef {
  id: number;
  name: string;
}

export interface SupplierImportContext {
  familiesByName: Map<string, SupplierImportFamilyRef>;
  existingNames: Set<string>;
  seenNames: Map<string, number>;
  rowNumber: number;
}

export interface SupplierImportContactData {
  name: string;
  email: string;
  phone: string | null;
  position: string | null;
}

export interface SupplierImportRowData {
  name: string;
  country: string | null;
  website: string | null;
  acceptedIncoterms: string[];
  paymentTermsDays: number;
  familyIds: number[];
  familyNames: string[];
  tags: string[];
  notes: string | null;
  contact: SupplierImportContactData | null;
}

export type SupplierImportParseResult =
  | { ok: true; data: SupplierImportRowData }
  | { ok: false; name: string; reasons: string[] };

// Parser PURO (sem prisma, sem exceljs): recebe as 12 celulas ja trim()adas
// da linha e o contexto (familias/nomes existentes/nomes ja vistos na
// planilha) e devolve os dados prontos pra gravar ou os motivos de rejeicao.
export function parseSupplierRow(
  cells: string[],
  ctx: SupplierImportContext,
): SupplierImportParseResult {
  const reasons: string[] = [];

  const rawName = (cells[0] ?? '').trim();
  const country = (cells[1] ?? '').trim() || null;
  const website = (cells[2] ?? '').trim() || null;
  const incotermsRaw = (cells[3] ?? '').trim();
  const paymentRaw = (cells[4] ?? '').trim();
  const familiesRaw = (cells[5] ?? '').trim();
  const tagsRaw = (cells[6] ?? '').trim();
  const notes = (cells[7] ?? '').trim() || null;
  const contactName = (cells[8] ?? '').trim();
  const contactEmailRaw = (cells[9] ?? '').trim();
  const contactPhone = (cells[10] ?? '').trim() || null;
  const contactPosition = (cells[11] ?? '').trim() || null;

  if (!rawName) {
    reasons.push('Nome é obrigatório');
  } else {
    const normalizedName = normalizeSupplierName(rawName);
    if (ctx.existingNames.has(normalizedName)) {
      reasons.push('Fornecedor já cadastrado');
    } else if (ctx.seenNames.has(normalizedName)) {
      reasons.push(
        `Fornecedor duplicado na planilha (linha ${ctx.seenNames.get(normalizedName)})`,
      );
    } else {
      ctx.seenNames.set(normalizedName, ctx.rowNumber);
    }
  }

  const incotermValues = Object.values(Incoterm) as string[];
  const seenIncoterms = new Set<string>();
  const acceptedIncoterms: string[] = [];
  for (const term of incotermsRaw
    .split(',')
    .map((value) => value.trim().toUpperCase())
    .filter((value) => value.length > 0)) {
    if (seenIncoterms.has(term)) continue;
    seenIncoterms.add(term);
    acceptedIncoterms.push(term);
  }
  if (acceptedIncoterms.length === 0) {
    reasons.push('Informe ao menos um Incoterm');
  } else {
    for (const term of acceptedIncoterms) {
      if (!incotermValues.includes(term)) {
        reasons.push(`Incoterm inválido: ${term}`);
      }
    }
  }

  let paymentTermsDays = 30;
  if (paymentRaw) {
    if (/^\d+$/.test(paymentRaw)) {
      paymentTermsDays = Number(paymentRaw);
    } else {
      reasons.push('Prazo de pagamento deve ser um número inteiro de dias');
    }
  }

  const familyIds: number[] = [];
  const familyNames: string[] = [];
  const seenFamilyKeys = new Set<string>();
  for (const name of familiesRaw
    .split(';')
    .map((value) => value.trim())
    .filter((value) => value.length > 0)) {
    const key = name.toLowerCase();
    if (seenFamilyKeys.has(key)) continue;
    seenFamilyKeys.add(key);
    const match = ctx.familiesByName.get(key);
    if (!match) {
      reasons.push(`Família não encontrada: ${name}`);
      continue;
    }
    familyIds.push(match.id);
    familyNames.push(match.name);
  }

  const tags = tagsRaw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  let contact: SupplierImportContactData | null = null;
  const hasContactData = Boolean(
    contactName || contactEmailRaw || contactPhone || contactPosition,
  );
  if (hasContactData) {
    if (!contactName || !contactEmailRaw) {
      reasons.push(
        'Contato: nome e e-mail são obrigatórios quando algum campo de contato é preenchido',
      );
    } else if (!EMAIL_REGEX.test(contactEmailRaw)) {
      reasons.push('E-mail do contato inválido');
    } else {
      contact = {
        name: contactName,
        email: contactEmailRaw.toLowerCase(),
        phone: contactPhone,
        position: contactPosition,
      };
    }
  }

  if (reasons.length > 0) {
    return { ok: false, name: rawName || `Linha ${ctx.rowNumber}`, reasons };
  }

  const candidate = {
    name: rawName,
    country,
    website,
    acceptedIncoterms,
    paymentTermsDays,
    familyIds,
    tags,
    notes,
    contact,
  };

  const parsed = supplierImportRowSchema.safeParse(candidate);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? 'Dados inválidos.';
    return { ok: false, name: rawName || `Linha ${ctx.rowNumber}`, reasons: [message] };
  }

  return {
    ok: true,
    data: {
      ...parsed.data,
      tags: parsed.data.tags ?? [],
      familyNames,
    },
  };
}

// Gera o .xlsx do modelo de importação: aba 1 só com o cabeçalho (fonte
// única de colunas) e aba 2 com instruções de preenchimento.
export async function buildSupplierImportTemplate(): Promise<Buffer> {
  const workbook = new exceljs.Workbook();
  const sheet = workbook.addWorksheet('Fornecedores');
  sheet.addRow([...SUPPLIER_IMPORT_COLUMNS]);

  const instructions = workbook.addWorksheet('Instruções');
  instructions.addRow(['Coluna', 'Formato']);
  instructions.addRow([
    'Nome*',
    'Texto. Obrigatório. Não pode repetir o nome de um fornecedor já cadastrado.',
  ]);
  instructions.addRow(['País', 'Texto opcional.']);
  instructions.addRow(['Website', 'Texto opcional.']);
  instructions.addRow([
    'Incoterms*',
    `Obrigatório. Um ou mais valores separados por vírgula (,). Valores válidos: ${Object.values(
      Incoterm,
    ).join(', ')}.`,
  ]);
  instructions.addRow([
    'Prazo pagamento (dias)',
    'Número inteiro maior ou igual a 0. Se vazio, assume 30.',
  ]);
  instructions.addRow([
    'Famílias',
    'Nomes de famílias já cadastradas, separados por ponto e vírgula (;).',
  ]);
  instructions.addRow(['Tags', 'Etiquetas livres, separadas por vírgula (,). Opcional.']);
  instructions.addRow(['Observações', 'Texto livre opcional.']);
  instructions.addRow([
    'Contato nome',
    'Obrigatório se "Contato e-mail" estiver preenchido.',
  ]);
  instructions.addRow([
    'Contato e-mail',
    'Obrigatório se "Contato nome" estiver preenchido. Deve ser um e-mail válido.',
  ]);
  instructions.addRow(['Contato telefone', 'Opcional.']);
  instructions.addRow(['Contato cargo', 'Opcional.']);

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer as ArrayBuffer);
}
