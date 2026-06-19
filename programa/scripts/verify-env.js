const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const target = (process.argv[2] ?? process.env.NODE_ENV ?? 'staging').toLowerCase();
const envFile = resolveEnvFile(target);

loadEnvFile(envFile);

const validations = [
  {
    key: 'DATABASE_URL',
    validate: (value) => startsWithPostgres(value),
    message: 'Precisa apontar para uma ligacao Postgres valida.',
  },
  {
    key: 'DIRECT_URL',
    validate: (value) => (
      startsWithPostgres(value)
      && !isSupabasePoolerUrl(value)
      && !matchesConnectionString(process.env.DATABASE_URL, value)
    ),
    message: 'Precisa apontar para a ligacao direta do banco, sem usar o pooler e sem repetir a DATABASE_URL.',
  },
  {
    key: 'JWT_ACCESS_SECRET',
    validate: (value) => hasStrongSecret(value),
    message: 'Precisa ter pelo menos 16 caracteres e nao pode usar placeholders.',
  },
  {
    key: 'JWT_REFRESH_SECRET',
    validate: (value) => hasStrongSecret(value),
    message: 'Precisa ter pelo menos 16 caracteres e nao pode usar placeholders.',
  },
  {
    key: 'COOKIE_SECURE',
    validate: (value) => (
      target === 'production'
        ? value === 'true'
        : value === 'true' || value === 'false'
    ),
    message: target === 'production'
      ? 'Em producao precisa ser true.'
      : 'Precisa ser true ou false.',
  },
  {
    key: 'CORS_ORIGINS',
    validate: (value) => Boolean(value && value.trim()),
    message: 'Precisa listar pelo menos uma origem valida.',
  },
  {
    key: 'PORT',
    validate: (value) => isPositiveInteger(value),
    message: 'Precisa ser um numero inteiro positivo.',
  },
  {
    key: 'APP_BASE_URL',
    validate: (value) => (
      target === 'local'
        ? startsWithHttp(value)
        : startsWithHttps(value)
    ),
    message: target === 'local'
      ? 'Precisa apontar para a URL local do ambiente.'
      : 'Precisa apontar para a URL publica do ambiente usando https.',
  },
];

const warnings = [];
const errors = [];

for (const rule of validations) {
  const value = process.env[rule.key];

  if (!value) {
    errors.push(`${rule.key}: ausente.`);
    continue;
  }

  if (!rule.validate(value)) {
    errors.push(`${rule.key}: ${rule.message}`);
  }
}

if ((process.env.ADMIN_SEED_PASSWORD ?? '').includes('ChangeMe123!')) {
  warnings.push('ADMIN_SEED_PASSWORD ainda usa o valor padrao de desenvolvimento.');
}

if ((process.env.CORS_ORIGINS ?? '').includes('localhost') && target === 'production') {
  warnings.push('CORS_ORIGINS ainda inclui localhost em producao.');
}

if (errors.length) {
  console.error(`Validacao de ambiente falhou para ${target}.`);

  for (const error of errors) {
    console.error(`- ${error}`);
  }

  if (warnings.length) {
    console.error('Avisos encontrados:');
    for (const warning of warnings) {
      console.error(`- ${warning}`);
    }
  }

  process.exitCode = 1;
  return;
}

console.log(`Ambiente ${target} validado com sucesso.`);

if (warnings.length) {
  console.log('Avisos:');
  for (const warning of warnings) {
    console.log(`- ${warning}`);
  }
}

function startsWithPostgres(value) {
  return typeof value === 'string' && /^(postgres|postgresql):\/\//i.test(value);
}

function startsWithHttp(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value);
}

function startsWithHttps(value) {
  return typeof value === 'string' && /^https:\/\//i.test(value);
}

function hasStrongSecret(value) {
  if (typeof value !== 'string' || value.length < 16) {
    return false;
  }

  const weakFragments = ['change-me', 'substitua', 'example', 'placeholder'];
  return !weakFragments.some((fragment) => value.toLowerCase().includes(fragment));
}

function isPositiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0;
}

function isSupabasePoolerUrl(value) {
  return typeof value === 'string' && /pooler\.supabase\.com/i.test(value);
}

function matchesConnectionString(left, right) {
  return normalizeConnectionString(left) === normalizeConnectionString(right);
}

function normalizeConnectionString(value) {
  return typeof value === 'string'
    ? value.trim().replace(/\/+$/, '').toLowerCase()
    : '';
}

function resolveEnvFile(currentTarget) {
  if (currentTarget === 'production') {
    return '.env.production';
  }

  if (currentTarget === 'staging') {
    return '.env.staging';
  }

  return '.env';
}

function loadEnvFile(fileName) {
  const filePath = path.resolve(process.cwd(), fileName);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Arquivo de ambiente nao encontrado: ${fileName}`);
  }

  dotenv.config({
    path: filePath,
    override: true,
  });
}
