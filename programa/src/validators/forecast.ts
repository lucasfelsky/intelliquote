import { z } from 'zod';
import {
  FORECAST_BASE64_MAX_LENGTH,
  FORECAST_LABEL_PATTERN,
  FORECAST_DBCORP_PRAZOS_MAX_FONTES,
  FORECAST_DBCORP_PRAZO_ESTIMATIVA_MAX_DIAS,
  FORECAST_MAX_CODES_PER_PRODUCT,
  FORECAST_MAX_PALLETS_POR_CODIGO,
  FORECAST_TOO_LARGE_MESSAGE,
} from '../constants/forecast';
import type { StatusCompra } from '../utils/forecastTypes';
import { isValidDateKey, todayKeyInSaoPaulo } from '../utils/supplierDocumentDates';

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

// Pallet (PR 6e): mesmas regras da quantidade. Nao precisa ser multiplo da embalagem (rodada 5 do Comex); a regra
// entre campos (precisa de quantidade na embalagem) depende do estado do codigo e fica no service.
const packagingPalletValue = z
  .number({ error: 'Informe os kg do pallet (ou null).' })
  .positive('O pallet deve ser maior que zero.')
  .max(1000000, 'O pallet aceita no maximo 1.000.000 kg.')
  .refine((v) => /^\d+(\.\d{1,3})?$/.test(String(v)), {
    message: 'O pallet aceita no maximo 3 casas decimais.',
  });
const packagingPalletField = packagingPalletValue.nullable();

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
        z
          .object({
            codigoId: codigoIdField,
            quantidadeKg: packagingQtyField,
            rotulo: packagingLabelField,
            // Ausente = mantem; null = sem pallet; numero = kg de um pallet (opcao de compra; nao precisa ser multiplo da embalagem).
            // Legado: troca SO o 1o tamanho (os demais ficam) e null apaga todos.
            palletKg: packagingPalletField.optional(),
            // Varios tamanhos: substitui a lista inteira ([] = sem pallet). Nao vai junto com `palletKg`.
            palletsKg: z
              .array(packagingPalletValue, { error: 'Informe os pallets como lista de kg.' })
              .max(FORECAST_MAX_PALLETS_POR_CODIGO, `Informe no máximo ${FORECAST_MAX_PALLETS_POR_CODIGO} tamanhos de pallet por código.`)
              .refine((lista) => new Set(lista).size === lista.length, 'Tamanho de pallet repetido no mesmo código.')
              .optional(),
          })
          .refine((e) => e.palletKg === undefined || e.palletsKg === undefined, 'Informe palletKg ou palletsKg, não os dois.'),
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

// XLSX da quinzena: 'relatorio' (padrao, o relatorio de compras) ou 'macro' (layout da aba FORECAST (MACRO)).
export const FORECAST_XLSX_LAYOUTS = ['relatorio', 'macro'] as const;
export const forecastRelatorioXlsxQuerySchema = forecastSnapshotQuerySchema.extend({
  layout: z.enum(FORECAST_XLSX_LAYOUTS, { error: 'Layout invalido (use relatorio ou macro).' }).optional(),
});

export type ForecastWorkbookPreviewInput = z.infer<typeof forecastWorkbookPreviewSchema>;
export type ForecastWorkbookConfirmInput = z.infer<typeof forecastWorkbookConfirmSchema>;
export type ForecastDbcorpPreviewInput = z.infer<typeof forecastDbcorpPreviewSchema>;
export type ForecastDbcorpConfirmInput = z.infer<typeof forecastDbcorpConfirmSchema>;
export type ForecastSourcePatchInput = z.infer<typeof forecastSourcePatchSchema>;
export type ForecastSnapshotQueryInput = z.infer<typeof forecastSnapshotQuerySchema>;
export type ForecastRelatorioXlsxQueryInput = z.infer<typeof forecastRelatorioXlsxQuerySchema>;
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

// Reativar produto inativo: sem corpo (campo extra = 400).
export const forecastProductReativarSchema = z.strictObject({});

export type ForecastProductReativarInput = z.infer<typeof forecastProductReativarSchema>;

// Excluir quinzena (soft delete): sem corpo (campo extra = 400).
export const forecastSnapshotDeleteSchema = z.strictObject({});

export type ForecastSnapshotDeleteInput = z.infer<typeof forecastSnapshotDeleteSchema>;
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

// Meses de venda atipica (PR 6c): `meses` substitui o conjunto do produto. `janela` (opcional) limita a substituicao aos
// meses que a tela mostrou: marcas de outros meses (de outras quinzenas) ficam como estao. Cada mes marcado precisa de
// motivo (3 a 300 caracteres); o mes nao pode ser futuro (calendario de Sao Paulo) nem repetido.
export const FORECAST_MESES_ATIPICOS_MOTIVO_MIN = 3;
export const FORECAST_MESES_ATIPICOS_MOTIVO_MAX = 300;
export const FORECAST_MESES_ATIPICOS_MAX = 24;

const FORECAST_ANO_MES_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const anoMesField = z
  .string({ error: 'Informe o mês no formato AAAA-MM.' })
  .trim()
  .regex(FORECAST_ANO_MES_PATTERN, 'Informe o mês no formato AAAA-MM (ex.: 2026-08).');

export const forecastMesesAtipicosPutSchema = z
  .object({
    meses: z
      .array(
        z.object({
          anoMes: anoMesField,
          motivo: z
            .string({ error: 'Informe o motivo de cada mês atípico.' })
            .trim()
            .min(
              FORECAST_MESES_ATIPICOS_MOTIVO_MIN,
              `O motivo precisa ter ao menos ${FORECAST_MESES_ATIPICOS_MOTIVO_MIN} caracteres.`,
            )
            .max(
              FORECAST_MESES_ATIPICOS_MOTIVO_MAX,
              `O motivo aceita no máximo ${FORECAST_MESES_ATIPICOS_MOTIVO_MAX} caracteres.`,
            ),
        }),
        { error: 'Informe a lista de meses atípicos.' },
      )
      .max(FORECAST_MESES_ATIPICOS_MAX, `Informe no máximo ${FORECAST_MESES_ATIPICOS_MAX} meses atípicos.`),
    janela: z
      .array(anoMesField, { error: 'A janela deve ser uma lista de meses (AAAA-MM).' })
      .max(FORECAST_MESES_ATIPICOS_MAX, `A janela aceita no máximo ${FORECAST_MESES_ATIPICOS_MAX} meses.`)
      .optional(),
  })
  .superRefine((value, ctx) => {
    const atual = todayKeyInSaoPaulo(new Date()).slice(0, 7);
    const vistos = new Set<string>();
    value.meses.forEach((m, i) => {
      if (vistos.has(m.anoMes)) {
        ctx.addIssue({ code: 'custom', path: ['meses', i, 'anoMes'], message: `O mês ${m.anoMes} foi informado mais de uma vez.` });
      }
      vistos.add(m.anoMes);
      if (m.anoMes > atual) {
        ctx.addIssue({ code: 'custom', path: ['meses', i, 'anoMes'], message: `O mês ${m.anoMes} é futuro: marque só meses que já tiveram venda.` });
      }
    });
    if (value.janela) {
      const janela = new Set(value.janela);
      value.meses.forEach((m, i) => {
        if (!janela.has(m.anoMes)) {
          ctx.addIssue({ code: 'custom', path: ['meses', i, 'anoMes'], message: `O mês ${m.anoMes} está fora da janela informada.` });
        }
      });
    }
  });

export type ForecastMesesAtipicosPutInput = z.infer<typeof forecastMesesAtipicosPutSchema>;

// Demanda do comercial (PR 6d): lancamento manual no Forecast (admin/comprador). Compra pedida pelo comercial por uma
// programacao futura de cliente fora do horizonte do DBCorp. Fechada (comprada, cancelada, virou_programacao) nao reabre.
// `solicitacaoId` e so o numero da Solicitacao do IntelliQuote para rastreio (a Solicitacao precisa existir: consulta por id, sem FK).
export const FORECAST_DEMANDA_STATUS = ['aberta', 'comprada', 'cancelada', 'virou_programacao'] as const;
export const FORECAST_DEMANDA_FECHAMENTOS = ['comprada', 'cancelada', 'virou_programacao'] as const;
export const FORECAST_DEMANDA_KG_MAX = 10_000_000;
export const FORECAST_DEMANDA_MOTIVO_MIN = 3;
export const FORECAST_DEMANDA_MOTIVO_MAX = 300;
export const FORECAST_DEMANDA_CLIENTE_MAX = 200;
export const FORECAST_DEMANDA_NOTA_MIN = 3;
export const FORECAST_DEMANDA_NOTA_MAX = 300;
const FORECAST_DEMANDA_ID_MAX = 2_147_483_647; // INTEGER do Postgres

const demandaProdutoField = z
  .number({ error: 'Informe o produto do Forecast.' })
  .int('Produto inválido.')
  .positive('Produto inválido.')
  .max(FORECAST_DEMANDA_ID_MAX, 'Produto inválido.');

const demandaKgField = z
  .number({ error: 'Informe a quantidade em kg.' })
  .positive('A quantidade precisa ser maior que zero.')
  .max(FORECAST_DEMANDA_KG_MAX, 'A quantidade aceita no máximo 10.000.000 kg.')
  // Coluna Decimal(18,6) aceita mais, mas o lancamento manual limita a 3 casas (padrao de validators/domain.ts).
  .refine((v) => /^\d+(\.\d{1,3})?$/.test(String(v)), { message: 'A quantidade aceita no máximo 3 casas decimais.' });

const demandaNecessidadeField = dateKeyField('Informe a data de necessidade (AAAA-MM-DD).');

const demandaMotivoField = z
  .string({ error: 'Informe o motivo do pedido.' })
  .trim()
  .min(FORECAST_DEMANDA_MOTIVO_MIN, `O motivo precisa ter ao menos ${FORECAST_DEMANDA_MOTIVO_MIN} caracteres.`)
  .max(FORECAST_DEMANDA_MOTIVO_MAX, `O motivo aceita no máximo ${FORECAST_DEMANDA_MOTIVO_MAX} caracteres.`);

const demandaClienteField = z
  .string({ error: 'O cliente deve ser um texto (ou null).' })
  .trim()
  .max(FORECAST_DEMANDA_CLIENTE_MAX, `O cliente aceita no máximo ${FORECAST_DEMANDA_CLIENTE_MAX} caracteres.`)
  .transform((value) => (value === '' ? null : value))
  .nullable();

const demandaSolicitacaoField = z
  .number({ error: 'O número da solicitação deve ser um inteiro positivo (ou null).' })
  .int('O número da solicitação deve ser um inteiro positivo (ou null).')
  .positive('O número da solicitação deve ser um inteiro positivo (ou null).')
  .max(FORECAST_DEMANDA_ID_MAX, 'O número da solicitação é inválido.')
  .nullable();

export const forecastDemandaComercialCreateSchema = z
  .object({
    productId: demandaProdutoField,
    quantidadeKg: demandaKgField,
    necessidade: demandaNecessidadeField,
    motivo: demandaMotivoField,
    cliente: demandaClienteField.optional(),
    solicitacaoId: demandaSolicitacaoField.optional(),
  })
  .superRefine((value, ctx) => {
    if (isValidDateKey(value.necessidade) && value.necessidade < todayKeyInSaoPaulo(new Date())) {
      ctx.addIssue({
        code: 'custom',
        path: ['necessidade'],
        message: 'A data de necessidade não pode ser anterior a hoje.',
      });
    }
  });

// Editar (so aberta; sem `status`) ou fechar (`status` + `nota`). Os dois modos nao se misturam. A regra "necessidade
// nao anterior a hoje" na edicao vale so quando a data muda (service): editar o motivo de pedido antigo continua possivel.
export const forecastDemandaComercialPatchSchema = z
  .object({
    status: z
      .enum(FORECAST_DEMANDA_FECHAMENTOS, {
        error: 'Status inválido: use comprada, cancelada ou virou_programacao.',
      })
      .optional(),
    nota: z
      .string({ error: 'A nota deve ser um texto (ou null).' })
      .trim()
      .max(FORECAST_DEMANDA_NOTA_MAX, `A nota aceita no máximo ${FORECAST_DEMANDA_NOTA_MAX} caracteres.`)
      .transform((value) => (value === '' ? null : value))
      .nullable()
      .optional(),
    quantidadeKg: demandaKgField.optional(),
    necessidade: demandaNecessidadeField.optional(),
    motivo: demandaMotivoField.optional(),
    cliente: demandaClienteField.optional(),
    solicitacaoId: demandaSolicitacaoField.optional(),
  })
  .superRefine((value, ctx) => {
    const edicao = [value.quantidadeKg, value.necessidade, value.motivo, value.cliente, value.solicitacaoId];
    const temEdicao = edicao.some((v) => v !== undefined);
    if (value.status !== undefined) {
      if (temEdicao) {
        ctx.addIssue({ code: 'custom', path: ['status'], message: 'Para fechar a demanda, envie só o status e a nota.' });
      }
      if (value.nota != null && value.nota.length < FORECAST_DEMANDA_NOTA_MIN) {
        ctx.addIssue({
          code: 'custom',
          path: ['nota'],
          message: `A nota precisa ter ao menos ${FORECAST_DEMANDA_NOTA_MIN} caracteres.`,
        });
      }
      if (value.status === 'cancelada' && !value.nota) {
        ctx.addIssue({ code: 'custom', path: ['nota'], message: 'Informe o motivo do cancelamento na nota.' });
      }
      return;
    }
    if (value.nota !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['nota'], message: 'A nota só vale ao fechar a demanda (envie também o status).' });
    }
    if (!temEdicao) {
      ctx.addIssue({ code: 'custom', message: 'Informe o que alterar ou o status para fechar a demanda.' });
    }
  });

export const forecastDemandaComercialQuerySchema = z.object({
  status: z.enum(FORECAST_DEMANDA_STATUS, { error: 'Status inválido.' }).optional(),
  productId: demandaProdutoField.optional(),
});

export type ForecastDemandaComercialCreateInput = z.infer<typeof forecastDemandaComercialCreateSchema>;
export type ForecastDemandaComercialPatchInput = z.infer<typeof forecastDemandaComercialPatchSchema>;
export type ForecastDemandaComercialQueryInput = z.infer<typeof forecastDemandaComercialQuerySchema>;
export type ForecastDemandaComercialStatus = (typeof FORECAST_DEMANDA_STATUS)[number];

// Grupos de equivalencia (PR 6b): produtos que sao o MESMO material (nomes ou fontes diferentes) tem o estoque avaliado
// somado no relatorio de compras. Cadastro por admin/comprador; um produto pertence a um unico grupo. O produto principal
// (opcional) e o que a compra usa; sem ele, o membro de maior media da quinzena.
export const FORECAST_GRUPO_NOME_MAX = 120;
export const FORECAST_GRUPO_OBSERVACAO_MAX = 300;
export const FORECAST_GRUPO_MEMBROS_MIN = 2;
export const FORECAST_GRUPO_MEMBROS_MAX = 20;

const grupoProdutoIdField = z
  .number({ error: 'Produto inválido.' })
  .int('Produto inválido.')
  .positive('Produto inválido.')
  .max(FORECAST_DEMANDA_ID_MAX, 'Produto inválido.');

const grupoNomeField = z
  .string({ error: 'Informe o nome do grupo.' })
  .trim()
  .min(1, 'Informe o nome do grupo.')
  .max(FORECAST_GRUPO_NOME_MAX, `O nome do grupo aceita no máximo ${FORECAST_GRUPO_NOME_MAX} caracteres.`);

const grupoObservacaoField = z
  .string({ error: 'A observação deve ser um texto (ou null).' })
  .trim()
  .max(FORECAST_GRUPO_OBSERVACAO_MAX, `A observação aceita no máximo ${FORECAST_GRUPO_OBSERVACAO_MAX} caracteres.`)
  .transform((value) => (value === '' ? null : value))
  .nullable();

const grupoProdutoIdsField = z
  .array(grupoProdutoIdField, { error: 'Informe os produtos do grupo.' })
  .min(FORECAST_GRUPO_MEMBROS_MIN, `Escolha ao menos ${FORECAST_GRUPO_MEMBROS_MIN} produtos para formar um grupo.`)
  .max(FORECAST_GRUPO_MEMBROS_MAX, `Um grupo aceita no máximo ${FORECAST_GRUPO_MEMBROS_MAX} produtos.`)
  .refine((ids) => new Set(ids).size === ids.length, 'O mesmo produto aparece mais de uma vez no grupo.');

const PRINCIPAL_FORA_DO_GRUPO = 'O produto principal precisa ser um dos produtos do grupo.';

export const forecastGrupoEquivalenciaCreateSchema = z
  .object({
    nome: grupoNomeField,
    observacao: grupoObservacaoField.optional(),
    produtoIds: grupoProdutoIdsField,
    principalProdutoId: grupoProdutoIdField.nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.principalProdutoId != null && !value.produtoIds.includes(value.principalProdutoId)) {
      ctx.addIssue({ code: 'custom', path: ['principalProdutoId'], message: PRINCIPAL_FORA_DO_GRUPO });
    }
  });

// Editar: so os campos enviados mudam. `produtoIds` substitui o conjunto de membros; `principalProdutoId: null` limpa o principal.
export const forecastGrupoEquivalenciaPatchSchema = z
  .object({
    nome: grupoNomeField.optional(),
    observacao: grupoObservacaoField.optional(),
    produtoIds: grupoProdutoIdsField.optional(),
    principalProdutoId: grupoProdutoIdField.nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (
      value.nome === undefined &&
      value.observacao === undefined &&
      value.produtoIds === undefined &&
      value.principalProdutoId === undefined
    ) {
      ctx.addIssue({ code: 'custom', message: 'Informe o que alterar no grupo.' });
    }
    if (value.principalProdutoId != null && value.produtoIds && !value.produtoIds.includes(value.principalProdutoId)) {
      ctx.addIssue({ code: 'custom', path: ['principalProdutoId'], message: PRINCIPAL_FORA_DO_GRUPO });
    }
  });

export type ForecastGrupoEquivalenciaCreateInput = z.infer<typeof forecastGrupoEquivalenciaCreateSchema>;
export type ForecastGrupoEquivalenciaPatchInput = z.infer<typeof forecastGrupoEquivalenciaPatchSchema>;

// Quantidade decidida de compra (PR3 do piloto): PUT por item e quinzena. `quantidadeKg: null` apaga a decisao (0 e uma
// decisao valida: nao comprar). O status usa o vocabulario da cor do item na planilha. Chave desconhecida = 400.
export const FORECAST_DECISAO_STATUS = ['nao', 'cotando', 'preco', 'confirmado', 'po'] as const satisfies readonly StatusCompra[];
export const FORECAST_DECISAO_KG_MAX = 10_000_000;
export const FORECAST_DECISAO_OBSERVACAO_MAX = 300;

export type ForecastDecisaoStatus = (typeof FORECAST_DECISAO_STATUS)[number];

const decisaoKgField = z
  .number({ error: 'Informe a quantidade em kg (ou null para apagar a decisão).' })
  .min(0, 'A quantidade não pode ser negativa.')
  .max(FORECAST_DECISAO_KG_MAX, 'A quantidade aceita no máximo 10.000.000 kg.')
  .refine((v) => /^\d+(\.\d{1,3})?$/.test(String(v)), { message: 'A quantidade aceita no máximo 3 casas decimais.' });

const decisaoObservacaoField = z
  .string({ error: 'A observação deve ser um texto (ou null).' })
  .trim()
  .max(FORECAST_DECISAO_OBSERVACAO_MAX, `A observação aceita no máximo ${FORECAST_DECISAO_OBSERVACAO_MAX} caracteres.`)
  .transform((value) => (value === '' ? null : value))
  .nullable();

export const forecastDecisaoPutSchema = z
  .strictObject({
    quantidadeKg: decisaoKgField.nullable(),
    observacao: decisaoObservacaoField.optional(),
    status: z.enum(FORECAST_DECISAO_STATUS, { error: 'Status da decisão inválido.' }).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.quantidadeKg === null && (value.observacao !== undefined || value.status !== undefined)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Para apagar a decisão, envie só quantidadeKg: null.',
      });
    }
  });

export type ForecastDecisaoPutInput = z.infer<typeof forecastDecisaoPutSchema>;
