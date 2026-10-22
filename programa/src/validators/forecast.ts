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

const dbcorpFileField = z.object({
  fileName: fileNameField,
  contentBase64: contentBase64Field,
});

// Quinzena a partir dos relatorios DBCorp. O confirm recebe o mesmo corpo do preview (grava sempre a
// quinzena e o mes anterior do historico; sem opcoes).
export const forecastDbcorpPreviewSchema = z
  .object({
    label: labelField,
    baseDate: dateKeyField('Data base invalida (use AAAA-MM-DD).'),
    files: z.object({
      saldo: dbcorpFileField,
      vendasMes: dbcorpFileField,
      vendasAtual: dbcorpFileField.optional(),
      vendasAnual: dbcorpFileField,
      programacao: dbcorpFileField,
      fup: dbcorpFileField,
      clientesAtivos: dbcorpFileField.optional(),
      margem: dbcorpFileField.optional(),
    }),
  })
  .superRefine((value, ctx) => {
    if (value.label.endsWith('-2') && !value.files.vendasAtual) {
      ctx.addIssue({
        code: 'custom',
        path: ['files', 'vendasAtual'],
        message: 'Na 2a quinzena envie o relatorio de vendas do mes atual (ate o dia 15).',
      });
    }
  });

export const forecastDbcorpConfirmSchema = forecastDbcorpPreviewSchema;

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

const packagingQtyField = z
  .number({ error: 'Informe a quantidade da embalagem em kg (ou null).' })
  .positive('A quantidade da embalagem deve ser maior que zero.')
  .max(1000000, 'A quantidade da embalagem aceita no maximo 1.000.000 kg.')
  // Coluna Decimal(18,6) aceita mais, mas a edicao manual limita a 3 casas (padrao de validators/domain.ts).
  .refine((v) => /^\d+(\.\d{1,3})?$/.test(String(v)), {
    message: 'A quantidade da embalagem aceita no maximo 3 casas decimais.',
  })
  .nullable();

const packagingLabelField = z
  .string({ error: 'Rotulo invalido.' })
  .trim()
  .max(60, 'O rotulo aceita no maximo 60 caracteres.')
  .transform((value) => (value === '' ? null : value))
  .nullable()
  .optional();

const codigoIdField = z
  .number({ error: 'Codigo invalido.' })
  .int('Codigo invalido.')
  .positive('Codigo invalido.');

// Embalagem por codigo (PR 2C): `embalagens` altera quantidade/rotulo dos codigos citados; `principalCodigoId`
// ausente = mantem, null = nenhuma principal, numero = esse codigo. Pelo menos um dos dois.
export const forecastEmbalagensPatchSchema = z
  .object({
    embalagens: z
      .array(
        z.object({
          codigoId: codigoIdField,
          quantidadeKg: packagingQtyField,
          rotulo: packagingLabelField,
        }),
        { error: 'Informe as embalagens como lista.' },
      )
      .min(1, 'Informe ao menos uma embalagem ou a principal.')
      .max(7, 'Informe no maximo 7 embalagens.')
      .refine((lista) => new Set(lista.map((e) => e.codigoId)).size === lista.length, 'Codigo repetido na lista.')
      .optional(),
    principalCodigoId: codigoIdField.nullable().optional(),
  })
  .refine(
    (value) => value.embalagens !== undefined || value.principalCodigoId !== undefined,
    'Informe ao menos uma embalagem ou a principal.',
  );

export const forecastSnapshotQuerySchema = z.object({
  hoje: dateKeyField('Data invalida (use AAAA-MM-DD).').optional(),
});

export type ForecastWorkbookPreviewInput = z.infer<typeof forecastWorkbookPreviewSchema>;
export type ForecastWorkbookConfirmInput = z.infer<typeof forecastWorkbookConfirmSchema>;
export type ForecastDbcorpPreviewInput = z.infer<typeof forecastDbcorpPreviewSchema>;
export type ForecastDbcorpConfirmInput = z.infer<typeof forecastDbcorpConfirmSchema>;
export type ForecastSourcePatchInput = z.infer<typeof forecastSourcePatchSchema>;
export type ForecastSnapshotQueryInput = z.infer<typeof forecastSnapshotQuerySchema>;
export type ForecastEmbalagensPatchInput = z.infer<typeof forecastEmbalagensPatchSchema>;
