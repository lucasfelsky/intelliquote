import { z } from 'zod';

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
  FIREBASE_ROLE_CLAIM: z.string().optional(),
  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().optional(),
  AUTH_RATE_LIMIT_WINDOW_MS: z.string().optional(),
  AUTH_RATE_LIMIT_MAX: z.string().optional(),
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
  firebaseRoleClaim: parsedEnv.FIREBASE_ROLE_CLAIM ?? 'role',
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
