import { z } from 'zod';
import { isValidCnpj, normalizeCnpj } from '../utils/cnpj';
import { parseProcessNumber } from '../utils/indentProcessNumber';
import { indentRequestItemSchema } from './indentRequest';

// Schemas da integracao Pipedrive do IQ Indent (PR 5a.2). Mensagens em pt-BR; erro de campo vira 400 com a 1a mensagem.
// As chaves de campo (CNPJ, tipo de negocio) vem SO do env: a tela nao as escolhe.

const idField = (message: string) => z.number(message).int(message).positive(message);

/** `PUT /pipedrive/config`: funil, coluna de origem e prazo interno. Nomes vem do Pipedrive (nunca do corpo). */
export const indentIntegrationConfigSchema = z.strictObject({
  pipelineId: idField('Escolha o funil.'),
  stageId: idField('Escolha a coluna de origem.'),
  slaBusinessDays: z
    .number('O prazo interno deve ser de 1 a 3 dias úteis.')
    .int('O prazo interno deve ser de 1 a 3 dias úteis.')
    .min(1, 'O prazo interno deve ser de 1 a 3 dias úteis.')
    .max(3, 'O prazo interno deve ser de 1 a 3 dias úteis.')
    .optional(),
});

export type IndentIntegrationConfigInput = z.infer<typeof indentIntegrationConfigSchema>;

/** `GET /pipedrive/options?pipelineId=`: colunas do funil escolhido (sem o parametro, as do funil configurado). */
export const indentPipedriveOptionsQuerySchema = z.object({
  pipelineId: z.coerce.number('Funil inválido.').int('Funil inválido.').positive('Funil inválido.').optional(),
});

export type IndentPipedriveOptionsQuery = z.infer<typeof indentPipedriveOptionsQuerySchema>;

// ---- Fila de vinculo, referencia pendente e itens da nota (PR 5a.3). Tudo strict: campo extra e recusado (400). ----

// Texto opcional: vazio/null vira ausente (o servico usa o dado da organizacao no lugar).
function optionalText(max: number, message: string) {
  return z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value === null ? undefined : value),
    z.string(message).trim().max(max, `O texto deve ter no máximo ${max} caracteres.`).optional(),
  );
}

// CNPJ digitado: so e usado quando a organizacao nao traz um CNPJ valido; vazio = ausente. Mascara aceita; DV valido.
const typedCnpj = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value === null ? undefined : value),
  z
    .string('CNPJ inválido.')
    .transform((value) => normalizeCnpj(value))
    .refine((value) => isValidCnpj(value), { message: 'CNPJ inválido.' })
    .optional(),
);

/** `POST /pending-orgs/:id/create-client`: organizacao escolhida (obrigatoria) + dados editados no modal "Novo cliente". */
export const pendingOrgCreateClientSchema = z.strictObject({
  orgId: idField('Escolha a organização do Pipedrive.'),
  name: optionalText(200, 'Informe a razão social.'),
  cnpj: typedCnpj,
  city: optionalText(120, 'Cidade inválida.'),
});

/** `POST /pending-orgs/:id/link`: cliente existente; `orgId` so e dispensado quando o negocio nao tem organizacao. */
export const pendingOrgLinkSchema = z.strictObject({
  orgId: idField('Escolha a organização do Pipedrive.').optional(),
  clientId: idField('Escolha o cliente.'),
});

// Mesmo teto do titulo do negocio (1 a 4 digitos): sequencia maior subiria IndentSequence sem volta.
const REFERENCE_MESSAGE = 'Informe a referência no formato NNN/AA (ex.: 274/26).';

/** `PUT /requests/:id/reference`: numero NNN/AA digitado (o servico normaliza e confere ano, duplicidade e sequencia). */
export const requestReferenceSchema = z.strictObject({
  processNumber: z
    .string(REFERENCE_MESSAGE)
    .trim()
    .refine((value) => {
      const parsed = parseProcessNumber(value);
      return parsed !== null && parsed.seq >= 1 && parsed.seq <= 9999;
    }, REFERENCE_MESSAGE),
});

const noteItemSchema = z
  .strictObject({
    id: idField('Item inválido.').optional(),
    productId: idField('Produto inválido.').optional(),
    description: indentRequestItemSchema.shape.description.optional(),
    quantityKg: indentRequestItemSchema.shape.quantityKg.optional(),
    remove: z.boolean('Valor inválido.').optional(),
  })
  .superRefine((item, ctx) => {
    if (item.remove === true) {
      if (item.id === undefined) {
        ctx.addIssue({ code: 'custom', message: 'Informe o item a remover.' });
      }
      return;
    }
    if (item.description === undefined) {
      ctx.addIssue({ code: 'custom', message: 'Informe o produto.' });
    } else if (item.quantityKg === undefined) {
      ctx.addIssue({ code: 'custom', message: 'Informe a quantidade em kg.' });
    }
  });

/** `PUT /requests/:id/note-items`: revisao humana dos itens lidos da nota. Cada item atual entra por `id` (editar ou `remove`); sem `id` = item novo. */
export const noteItemsSchema = z.strictObject({
  items: z
    .array(noteItemSchema, 'Informe os itens.')
    .min(1, 'Informe os itens.')
    .max(50, 'Informe no máximo 50 itens.'),
});

export type PendingOrgCreateClientInput = z.infer<typeof pendingOrgCreateClientSchema>;
export type PendingOrgLinkInput = z.infer<typeof pendingOrgLinkSchema>;
export type RequestReferenceInput = z.infer<typeof requestReferenceSchema>;
export type NoteItemsInput = z.infer<typeof noteItemsSchema>;
