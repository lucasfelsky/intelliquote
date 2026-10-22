import { z } from 'zod';
import {
  FORECAST_BASE64_MAX_LENGTH,
  FORECAST_LABEL_PATTERN,
  FORECAST_DBCORP_PRAZOS_MAX_FONTES,
  FORECAST_DBCORP_PRAZO_ESTIMATIVA_MAX_DIAS,
  FORECAST_MAX_CODES_PER_PRODUCT,
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

const prazoDiasField = z
  .number({ error: 'Informe os dias como numero inteiro.' })
  .int('Informe os dias como numero inteiro.')
  .min(0, 'Os dias nao podem ser negativos.')
  .max(
    FORECAST_DBCORP_PRAZO_ESTIMATIVA_MAX_DIAS,
    `Os dias aceitam no maximo ${FORECAST_DBCORP_PRAZO_ESTIMATIVA_MAX_DIAS}.`,
  );

// Prazo (dias) das chegadas estimadas do FUP, por fonte: DATA PRONTIDAO + n e ETD + n.
const prazoEstimativaField = z.object({
  sourceId: z
    .number({ error: 'Fonte invalida.' })
    .int('Fonte invalida.')
    .positive('Fonte invalida.'),
  prontidaoDias: prazoDiasField,
  etdDias: prazoDiasField,
});

// Quinzena a partir dos relatorios DBCorp. O confirm recebe o mesmo corpo do preview (grava sempre a
// quinzena e o mes anterior do historico; sem opcoes). `prazosEstimativa` (opcional) viaja nos dois: o confirm
// repete o calculo do preview com os mesmos prazos.
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
    prazosEstimativa: z
      .array(prazoEstimativaField)
      .max(
        FORECAST_DBCORP_PRAZOS_MAX_FONTES,
        `Informe no maximo ${FORECAST_DBCORP_PRAZOS_MAX_FONTES} fontes em prazosEstimativa.`,
      )
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (value.prazosEstimativa) {
      const vistos = new Set<number>();
      for (const [index, prazo] of value.prazosEstimativa.entries()) {
        if (vistos.has(prazo.sourceId)) {
          ctx.addIssue({
            code: 'custom',
            path: ['prazosEstimativa', index, 'sourceId'],
            message: 'Fonte repetida em prazosEstimativa.',
          });
        }
        vistos.add(prazo.sourceId);
      }
    }
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

// Pallet fechado (PR 6e): mesmas regras da quantidade. As regras entre campos (precisa de quantidade, multiplo dela)
// dependem do estado do codigo e ficam no service.
const packagingPalletField = z
  .number({ error: 'Informe os kg do pallet (ou null).' })
  .positive('O pallet deve ser maior que zero.')
  .max(1000000, 'O pallet aceita no maximo 1.000.000 kg.')
  .refine((v) => /^\d+(\.\d{1,3})?$/.test(String(v)), {
    message: 'O pallet aceita no maximo 3 casas decimais.',
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
          // Ausente = mantem; null = sem pallet; numero = kg de um pallet fechado (multiplo da embalagem).
          palletKg: packagingPalletField.optional(),
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

// Produto novo a partir de um pendente de cadastro (PR 3B): nome, ate 7 codigos, fonte e familia. O lead time
// pertence a fonte (precisa estar preenchido; a regra e do service).
const productCodeField = z
  .string({ error: 'Informe o código do produto.' })
  .trim()
  .min(1, 'Informe o código do produto.')
  .max(40, 'O código aceita no máximo 40 caracteres.')
  .transform((value) => value.toUpperCase());

const positiveIdField = (message: string) =>
  z.number({ error: message }).int(message).positive(message);

export const forecastProductCreateSchema = z.object({
  nome: z
    .string({ error: 'Informe o nome do produto.' })
    .trim()
    .min(1, 'Informe o nome do produto.')
    .max(200, 'O nome aceita no máximo 200 caracteres.'),
  codigos: z
    .array(productCodeField, { error: 'Informe os códigos do produto como lista.' })
    .min(1, 'Informe ao menos um código.')
    .max(FORECAST_MAX_CODES_PER_PRODUCT, `Informe no máximo ${FORECAST_MAX_CODES_PER_PRODUCT} códigos.`)
    .refine((lista) => new Set(lista).size === lista.length, 'Código repetido na lista.'),
  sourceId: positiveIdField('Fonte inválida.'),
  familyId: positiveIdField('Família inválida.'),
});

export const forecastProductCodeAddSchema = z.object({
  codigo: productCodeField,
});

export type ForecastProductCreateInput = z.infer<typeof forecastProductCreateSchema>;
export type ForecastProductCodeAddInput = z.infer<typeof forecastProductCodeAddSchema>;

// Compra sob demanda (PR 6a): marca por produto. `motivo` e opcional (vazio = sem motivo); `sobDemanda: false`
// limpa o motivo no service, qualquer que seja o valor enviado.
export const FORECAST_SOB_DEMANDA_MOTIVO_MIN = 3;
export const FORECAST_SOB_DEMANDA_MOTIVO_MAX = 300;

export const forecastSobDemandaPatchSchema = z
  .object({
    sobDemanda: z.boolean({ error: 'Informe se a compra é sob demanda (true/false).' }),
    motivo: z
      .string({ error: 'O motivo deve ser um texto (ou null).' })
      .trim()
      .max(
        FORECAST_SOB_DEMANDA_MOTIVO_MAX,
        `O motivo aceita no máximo ${FORECAST_SOB_DEMANDA_MOTIVO_MAX} caracteres.`,
      )
      .transform((value) => (value === '' ? null : value))
      .nullable()
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (value.motivo != null && value.motivo.length < FORECAST_SOB_DEMANDA_MOTIVO_MIN) {
      ctx.addIssue({
        code: 'custom',
        path: ['motivo'],
        message: `O motivo precisa ter ao menos ${FORECAST_SOB_DEMANDA_MOTIVO_MIN} caracteres.`,
      });
    }
  });

export type ForecastSobDemandaPatchInput = z.infer<typeof forecastSobDemandaPatchSchema>;
