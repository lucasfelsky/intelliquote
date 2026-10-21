import { z } from 'zod';
import {
  FORECAST_BASE64_MAX_LENGTH,
  FORECAST_LABEL_PATTERN,
  FORECAST_TOO_LARGE_MESSAGE,
} from '../constants/forecast';
import { isValidDateKey } from '../utils/supplierDocumentDates';

const contentBase64Field = z
  .string({ error: 'Envie a planilha em contentBase64.' })
  .min(1, 'Envie a planilha em contentBase64.')
  // Rejeita antes de decodificar o base64 (evita copias grandes em memoria).
  .max(FORECAST_BASE64_MAX_LENGTH, FORECAST_TOO_LARGE_MESSAGE);

const fileNameField = z
  .string({ error: 'Informe o nome do arquivo.' })
  .trim()
  .min(1, 'Informe o nome do arquivo.')
  .max(200, 'O nome do arquivo aceita no maximo 200 caracteres.');

const labelField = z
  .string({ error: 'Informe o rotulo da quinzena (ex.: 10-2).' })
  .trim()
  .regex(FORECAST_LABEL_PATTERN, 'Rotulo da quinzena invalido (use o formato NN-q, ex.: 10-2).');

const dateKeyField = (message: string) =>
  z.string({ error: message }).refine((value) => isValidDateKey(value), message);

export const forecastWorkbookPreviewSchema = z.object({
  contentBase64: contentBase64Field,
  fileName: fileNameField,
  label: labelField,
  baseDate: dateKeyField('Data base invalida (use AAAA-MM-DD).'),
});

export const forecastWorkbookConfirmSchema = forecastWorkbookPreviewSchema.extend({
  options: z
    .object({
      atualizarCadastro: z.boolean({ error: 'Informe atualizarCadastro (true/false).' }),
      gravarHistorico: z.boolean({ error: 'Informe gravarHistorico (true/false).' }),
      criarQuinzena: z.boolean({ error: 'Informe criarQuinzena (true/false).' }),
    })
    .refine(
      (value) => value.atualizarCadastro || value.gravarHistorico || value.criarQuinzena,
      'Selecione ao menos uma opcao de importacao.',
    ),
});

const leadTimeDaysField = z
  .number({ error: 'Informe um numero inteiro de dias (ou null).' })
  .int('Informe um numero inteiro de dias.')
  .min(0, 'Os dias nao podem ser negativos.')
  .nullable();

export const forecastSourcePatchSchema = z
  .object({
    readinessDays: leadTimeDaysField.optional(),
    holidaysDays: leadTimeDaysField.optional(),
    shippingDays: leadTimeDaysField.optional(),
    transitDays: leadTimeDaysField.optional(),
    clearanceDays: leadTimeDaysField.optional(),
    leadTimeDays: leadTimeDaysField.optional(),
    supplierId: z
      .number({ error: 'Fornecedor invalido.' })
      .int('Fornecedor invalido.')
      .positive('Fornecedor invalido.')
      .nullable()
      .optional(),
    isActive: z.boolean({ error: 'Informe isActive (true/false).' }).optional(),
  })
  .refine(
    (value) => Object.values(value).some((field) => field !== undefined),
    'Informe ao menos um campo para atualizar.',
  );

export const forecastSnapshotQuerySchema = z.object({
  hoje: dateKeyField('Data invalida (use AAAA-MM-DD).').optional(),
});

export type ForecastWorkbookPreviewInput = z.infer<typeof forecastWorkbookPreviewSchema>;
export type ForecastWorkbookConfirmInput = z.infer<typeof forecastWorkbookConfirmSchema>;
export type ForecastSourcePatchInput = z.infer<typeof forecastSourcePatchSchema>;
export type ForecastSnapshotQueryInput = z.infer<typeof forecastSnapshotQuerySchema>;
