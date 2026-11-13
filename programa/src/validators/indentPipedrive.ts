import { z } from 'zod';

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
