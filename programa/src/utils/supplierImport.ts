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
  'Incoterms',
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

const SUPPLIER_IMPORT_MAX_CONTACTS = 20;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Quebra uma coluna de contato em itens (trim em cada um) e remove apenas os
// itens vazios do FINAL (ex.: "a@x.com;"). Vazios no inicio/meio sao mantidos
// para o chamador decidir (erro em nome/e-mail, null em telefone/cargo).
function splitContactColumn(raw: string, separator: RegExp): string[] {
  const items = raw.split(separator).map((item) => item.trim());
  while (items.length > 0 && items[items.length - 1] === '') {
    items.pop();
  }
  return items;
}

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
  contacts: SupplierImportContactData[];
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
  // Colunas de contato: NAO colapsar quebras de linha internas; o trim()
  // externo so afeta as bordas e o split trata `\n`/`\r\n` como separador.
  const contactNames = splitContactColumn(cells[8] ?? '', /;|\r?\n/);
  const contactEmails = splitContactColumn(cells[9] ?? '', /[;,]|\r?\n/);
  const contactPhones = splitContactColumn(cells[10] ?? '', /;|\r?\n/);
  const contactPositions = splitContactColumn(cells[11] ?? '', /;|\r?\n/);

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
  for (const term of acceptedIncoterms) {
    if (!incotermValues.includes(term)) {
      reasons.push(`Incoterm inválido: ${term}`);
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

  let contacts: SupplierImportContactData[] = [];
  const hasContactData =
    contactNames.length > 0 ||
    contactEmails.length > 0 ||
    contactPhones.length > 0 ||
    contactPositions.length > 0;
  if (hasContactData) {
    if (contactNames.length === 0 || contactEmails.length === 0) {
      reasons.push(
        'Contato: nome e e-mail são obrigatórios quando algum campo de contato é preenchido',
      );
    } else {
      const contactReasons: string[] = [];

      // Item vazio no meio de nome/e-mail desalinha o pareamento por posição.
      const emptyNameIdx = contactNames.indexOf('');
      if (emptyNameIdx >= 0) {
        contactReasons.push(
          `Contato: item vazio na coluna "Contato nome" (posição ${emptyNameIdx + 1}) — remova o separador sobrando`,
        );
      }
      const emptyEmailIdx = contactEmails.indexOf('');
      if (emptyEmailIdx >= 0) {
        contactReasons.push(
          `Contato: item vazio na coluna "Contato e-mail" (posição ${emptyEmailIdx + 1}) — remova o separador sobrando`,
        );
      }

      if (contactReasons.length === 0) {
        const n = contactNames.length;
        const m = contactEmails.length;
        if (n !== m) {
          contactReasons.push(
            `Contato: ${n} ${n === 1 ? 'nome' : 'nomes'} e ${m} ${m === 1 ? 'e-mail' : 'e-mails'} — informe a mesma quantidade, separados por ;`,
          );
        } else if (m > SUPPLIER_IMPORT_MAX_CONTACTS) {
          contactReasons.push(
            `Contato: no máximo ${SUPPLIER_IMPORT_MAX_CONTACTS} contatos por fornecedor`,
          );
        }

        const p = contactPhones.length;
        if (p > m) {
          contactReasons.push(
            `Contato: ${p} telefones para ${m} ${m === 1 ? 'e-mail' : 'e-mails'} — não pode haver mais telefones que e-mails`,
          );
        }
        const c = contactPositions.length;
        if (c > m) {
          contactReasons.push(
            `Contato: ${c} cargos para ${m} ${m === 1 ? 'e-mail' : 'e-mails'} — não pode haver mais cargos que e-mails`,
          );
        }

        const seenEmails = new Set<string>();
        const reportedDuplicates = new Set<string>();
        for (const email of contactEmails) {
          if (!EMAIL_REGEX.test(email)) {
            contactReasons.push(`E-mail do contato inválido: ${email}`);
            continue;
          }
          const emailLower = email.toLowerCase();
          if (seenEmails.has(emailLower)) {
            if (!reportedDuplicates.has(emailLower)) {
              reportedDuplicates.add(emailLower);
              contactReasons.push(`E-mail do contato duplicado na linha: ${emailLower}`);
            }
          } else {
            seenEmails.add(emailLower);
          }
        }
      }

      if (contactReasons.length > 0) {
        reasons.push(...contactReasons);
      } else {
        contacts = contactEmails.map((email, index) => ({
          name: contactNames[index],
          email: email.toLowerCase(),
          phone: contactPhones[index] || null,
          position: contactPositions[index] || null,
        }));
      }
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
    contacts,
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
    'Incoterms',
    `Opcional. Um ou mais valores separados por vírgula (,). Se vazio, o fornecedor aceita todos os Incoterms. Valores válidos: ${Object.values(
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
    'Um ou mais nomes separados por ponto e vírgula (;) ou quebra de linha na célula. Obrigatório se "Contato e-mail" estiver preenchido. O 1º contato vira o contato principal.',
  ]);
  instructions.addRow([
    'Contato e-mail',
    'Um e-mail por contato, na mesma ordem dos nomes, separados por ponto e vírgula (;), vírgula (,) ou quebra de linha. A quantidade de e-mails deve ser igual à de nomes. Máximo 20 contatos.',
  ]);
  instructions.addRow([
    'Contato telefone',
    'Opcional. Mesma ordem dos nomes, separados por ; ou quebra de linha. Pode ter menos itens (o contato fica sem telefone); deixe vazio entre ; para pular um contato (ex.: "1199;;1188").',
  ]);
  instructions.addRow(['Contato cargo', 'Opcional. Mesma regra do telefone.']);

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer as ArrayBuffer);
}
