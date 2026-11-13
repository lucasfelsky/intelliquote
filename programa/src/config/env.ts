import { z } from 'zod';

import { logger } from '../lib/logger';

const authEnvSchema = z.object({
  NODE_ENV: z.string().optional(),
  JWT_ACCESS_SECRET: z.string().min(16).optional(),
  JWT_REFRESH_SECRET: z.string().min(16).optional(),
  JWT_ACCESS_EXPIRES_IN: z.string().optional(),
  JWT_REFRESH_EXPIRES_IN: z.string().optional(),
  COOKIE_SECURE: z.string().optional(),
  CORS_ORIGINS: z.string().optional(),
  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_AUTH_EMULATOR_HOST: z.string().optional(),
  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().optional(),
  AUTH_RATE_LIMIT_WINDOW_MS: z.string().optional(),
  AUTH_RATE_LIMIT_MAX: z.string().optional(),
  AUTH_LOGOUT_RATE_LIMIT_MAX: z.string().optional(),
  ADMIN_SEED_NAME: z.string().optional(),
  ADMIN_SEED_EMAIL: z.string().email().optional(),
  ADMIN_SEED_PASSWORD: z.string().min(8).optional(),
});

const parsedEnv = authEnvSchema.parse(process.env);
const isProduction = parsedEnv.NODE_ENV === 'production';

function getRequiredValue(
  value: string | undefined,
  fallback: string,
  key: string,
): string {
  if (value) {
    return value;
  }

  if (!isProduction) {
    return fallback;
  }

  throw new Error(`A variavel de ambiente ${key} e obrigatoria em producao.`);
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }

  return value.toLowerCase() === 'true';
}

function parsePositiveNumber(
  value: string | undefined,
  fallback: number,
  key: string,
): number {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`A variavel de ambiente ${key} precisa ser um numero positivo.`);
  }

  return parsed;
}

function parseCorsOrigins(value: string | undefined): string[] {
  const defaultOrigins = ['http://localhost:3000', 'http://127.0.0.1:3000'];

  if (!value) {
    return defaultOrigins;
  }

  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export const authEnv = {
  accessSecret: getRequiredValue(
    parsedEnv.JWT_ACCESS_SECRET,
    'intelliquote-local-access-secret-change-me',
    'JWT_ACCESS_SECRET',
  ),
  refreshSecret: getRequiredValue(
    parsedEnv.JWT_REFRESH_SECRET,
    'intelliquote-local-refresh-secret-change-me',
    'JWT_REFRESH_SECRET',
  ),
  accessExpiresIn: parsedEnv.JWT_ACCESS_EXPIRES_IN ?? '15m',
  refreshExpiresIn: parsedEnv.JWT_REFRESH_EXPIRES_IN ?? '7d',
  cookieSecure: parseBoolean(parsedEnv.COOKIE_SECURE, isProduction),
  corsOrigins: parseCorsOrigins(parsedEnv.CORS_ORIGINS),
  firebaseProjectId: parsedEnv.FIREBASE_PROJECT_ID ?? 'sq-comex-updates-3d22f',
  hasGoogleServiceAccountJson: Boolean(parsedEnv.GOOGLE_SERVICE_ACCOUNT_JSON),
  authRateLimitWindowMs: parsePositiveNumber(
    parsedEnv.AUTH_RATE_LIMIT_WINDOW_MS,
    15 * 60 * 1000,
    'AUTH_RATE_LIMIT_WINDOW_MS',
  ),
  authRateLimitMax: parsePositiveNumber(
    parsedEnv.AUTH_RATE_LIMIT_MAX,
    20,
    'AUTH_RATE_LIMIT_MAX',
  ),
  authLogoutRateLimitMax: parsePositiveNumber(
    parsedEnv.AUTH_LOGOUT_RATE_LIMIT_MAX,
    60,
    'AUTH_LOGOUT_RATE_LIMIT_MAX',
  ),
  adminSeedName: parsedEnv.ADMIN_SEED_NAME ?? 'Administrador IntelliQuote',
  adminSeedEmail: parsedEnv.ADMIN_SEED_EMAIL ?? 'admin@intelliquote.local',
  adminSeedPassword: parsedEnv.ADMIN_SEED_PASSWORD ?? 'ChangeMe123!',
} as const;

const smtpEnvSchema = z.object({
  MAILER_PROVIDER: z.enum(['smtp', 'console', 'sendgrid', 'mailgun', 'resend']).optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.string().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  SMTP_SECURE: z.string().optional(),
  SMTP_RETRY_ATTEMPTS: z.string().optional(),
  SMTP_RETRY_BASE_DELAY_MS: z.string().optional(),
  INTELLIQUOTE_COMEX_CC_LIST: z.string().optional(),
  INTELLIQUOTE_PORTAL_URL: z.string().optional(),
  SENDGRID_API_KEY: z.string().optional(),
  MAILGUN_API_KEY: z.string().optional(),
  MAILGUN_DOMAIN: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  REMINDER_ENABLED: z.string().optional(),
});

const parsedMailerEnv = smtpEnvSchema.parse(process.env);

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBooleanOptional(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  return value.toLowerCase() === 'true';
}

function parseCcList(value: string | undefined): Array<{ email: string; name?: string }> {
  if (!value) return [];
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const named = entry.match(/^(.*?)\s*<([^>]+)>$/);
      if (named) {
        return { name: named[1].trim(), email: named[2].trim().toLowerCase() };
      }
      return { email: entry.toLowerCase() };
    })
    .filter((entry) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(entry.email));
}

export const mailerEnv = {
  provider: (parsedMailerEnv.MAILER_PROVIDER ?? 'smtp') as
    | 'smtp'
    | 'console'
    | 'sendgrid'
    | 'mailgun'
    | 'resend',
  smtp: {
    host: parsedMailerEnv.SMTP_HOST ?? '',
    port: parsePositiveInteger(parsedMailerEnv.SMTP_PORT, 587),
    user: parsedMailerEnv.SMTP_USER ?? '',
    pass: parsedMailerEnv.SMTP_PASS ?? '',
    from: parsedMailerEnv.SMTP_FROM ?? '',
    secure: parseBooleanOptional(parsedMailerEnv.SMTP_SECURE) ?? false,
    retryAttempts: parsePositiveInteger(parsedMailerEnv.SMTP_RETRY_ATTEMPTS, 3),
    retryBaseDelayMs: parsePositiveInteger(parsedMailerEnv.SMTP_RETRY_BASE_DELAY_MS, 500),
  },
  comexCcList: parseCcList(parsedMailerEnv.INTELLIQUOTE_COMEX_CC_LIST),
  portalUrl:
    parsedMailerEnv.INTELLIQUOTE_PORTAL_URL ?? 'http://localhost:3000',
  sendgridApiKey: parsedMailerEnv.SENDGRID_API_KEY ?? '',
  mailgunApiKey: parsedMailerEnv.MAILGUN_API_KEY ?? '',
  mailgunDomain: parsedMailerEnv.MAILGUN_DOMAIN ?? '',
  resendApiKey: parsedMailerEnv.RESEND_API_KEY ?? '',
} as const;

// Lembrete diario (seg-sex, BRT) do portal do fornecedor. Desligavel via env
// (REMINDER_ENABLED=false) sem novo deploy de codigo.
export const reminderEnv = {
  enabled: parseBooleanOptional(parsedMailerEnv.REMINDER_ENABLED) ?? true,
} as const;

// Jobs internos (Cloud Scheduler -> /api/internal/jobs/*). A chamada vem com
// um ID token OIDC da service account abaixo; sem as duas envs as rotas
// internas respondem 503 (fail-closed).
const internalJobsEnvSchema = z.object({
  INTERNAL_JOBS_OIDC_AUDIENCE: z.string().optional(),
  INTERNAL_JOBS_INVOKER_EMAIL: z.string().optional(),
});

const parsedInternalJobsEnv = internalJobsEnvSchema.parse(process.env);

export const internalJobsEnv = {
  audience: parsedInternalJobsEnv.INTERNAL_JOBS_OIDC_AUDIENCE?.trim() || undefined,
  invokerEmail: parsedInternalJobsEnv.INTERNAL_JOBS_INVOKER_EMAIL?.trim().toLowerCase() || undefined,
} as const;

// Integracao Pipedrive (IQ Indent): SO LEITURA (o cliente HTTP so faz GET). O token e pessoal e vem do Secret Manager.
// Formato invalido NAO derruba o boot: `configured=false` e `configErrors` guarda so os NOMES das envs (nunca valores);
// o erro e logado uma vez aqui. Nenhuma chamada ao Pipedrive acontece no boot nem em /health*.
// Funil, coluna e prazo "oficiais" ficam no banco (IndentIntegrationConfig); estas envs sao o valor inicial.
// O nome da env do token e montado em duas partes para a guarda estatica de `src/` (nada de "api" + "_token" em query).
const PIPEDRIVE_TOKEN_ENV = 'PIPEDRIVE_API' + '_TOKEN';
const PIPEDRIVE_ENV_NAMES = [
  PIPEDRIVE_TOKEN_ENV,
  'PIPEDRIVE_DOMAIN',
  'PIPEDRIVE_PIPELINE_ID',
  'PIPEDRIVE_STAGE_ID',
  'PIPEDRIVE_STAGE_NAME',
  'PIPEDRIVE_ORG_CNPJ_FIELD_KEY',
  'PIPEDRIVE_DEAL_TYPE_FIELD_KEY',
  'PIPEDRIVE_COMEX_USER_ID',
  'PIPEDRIVE_SYNC_SINCE',
] as const;

export interface PipedriveEnv {
  configured: boolean;
  /** Nomes das envs ausentes (com outras definidas) ou em formato invalido. Nunca valores. */
  configErrors: readonly string[];
  apiToken: string | undefined;
  domain: string | undefined;
  pipelineId: number | undefined;
  stageId: number | undefined;
  stageName: string | undefined;
  orgCnpjFieldKey: string | undefined;
  dealTypeFieldKey: string | undefined;
  comexUserId: number | undefined;
  /** `YYYY-MM-DD`: negocios que entraram na coluna antes disso e sem espelho nao viram solicitacao. */
  syncSince: string | undefined;
}

function isRealCalendarDate(value: string): boolean {
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function parsePipedriveEnv(source: Record<string, string | undefined>): PipedriveEnv {
  const read = (name: string): string | undefined => source[name]?.trim() || undefined;
  const anySet = PIPEDRIVE_ENV_NAMES.some((name) => read(name) !== undefined);
  const errors: string[] = [];

  const required = <T>(name: string, parse: (raw: string) => T | undefined): T | undefined => {
    const raw = read(name);
    if (raw === undefined) {
      if (anySet) errors.push(name);
      return undefined;
    }
    const value = parse(raw);
    if (value === undefined) errors.push(name);
    return value;
  };
  const optional = <T>(name: string, parse: (raw: string) => T | undefined): T | undefined => {
    const raw = read(name);
    if (raw === undefined) return undefined;
    const value = parse(raw);
    if (value === undefined) errors.push(name);
    return value;
  };
  const positiveInt = (raw: string): number | undefined => (/^\d{1,9}$/.test(raw) && Number(raw) > 0 ? Number(raw) : undefined);
  const hexKey = (raw: string): string | undefined => (/^[0-9a-f]{40}$/.test(raw) ? raw : undefined);

  const apiToken = required(PIPEDRIVE_TOKEN_ENV, (raw) => (/^\S+$/.test(raw) ? raw : undefined));
  const domain = required('PIPEDRIVE_DOMAIN', (raw) => (/^[a-z0-9-]{1,63}$/.test(raw) ? raw : undefined));
  const pipelineId = required('PIPEDRIVE_PIPELINE_ID', positiveInt);
  const stageId = required('PIPEDRIVE_STAGE_ID', positiveInt);
  const stageName = required('PIPEDRIVE_STAGE_NAME', (raw) => (raw.length <= 200 ? raw : undefined));
  const orgCnpjFieldKey = required('PIPEDRIVE_ORG_CNPJ_FIELD_KEY', hexKey);
  const dealTypeFieldKey = optional('PIPEDRIVE_DEAL_TYPE_FIELD_KEY', hexKey);
  const comexUserId = optional('PIPEDRIVE_COMEX_USER_ID', positiveInt);
  const syncSince = optional('PIPEDRIVE_SYNC_SINCE', (raw) =>
    /^\d{4}-\d{2}-\d{2}$/.test(raw) && isRealCalendarDate(raw) ? raw : undefined,
  );

  const configured =
    errors.length === 0 &&
    apiToken !== undefined &&
    domain !== undefined &&
    pipelineId !== undefined &&
    stageId !== undefined &&
    stageName !== undefined &&
    orgCnpjFieldKey !== undefined;

  return {
    configured,
    configErrors: errors,
    apiToken,
    domain,
    pipelineId,
    stageId,
    stageName,
    orgCnpjFieldKey,
    dealTypeFieldKey,
    comexUserId,
    syncSince,
  };
}

export const pipedriveEnv: PipedriveEnv = parsePipedriveEnv(process.env);

if (pipedriveEnv.configErrors.length > 0) {
  logger.error(
    { envs: pipedriveEnv.configErrors },
    'Configuracao do Pipedrive invalida ou incompleta: integracao desligada (configured=false).',
  );
}
