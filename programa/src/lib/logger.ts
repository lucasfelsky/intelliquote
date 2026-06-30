// Logger minimalista baseado em console para evitar dependencia extra.
// Em producao (Cloud Run) os logs vao para stdout/stderr e sao coletados
// pelo Cloud Logging automaticamente.
import { getCurrentTraceId } from './traceContext';

type Level = 'debug' | 'info' | 'warn' | 'error';

function emit(level: Level, meta: Record<string, unknown> | undefined, message: string): void {
  const traceId = getCurrentTraceId();
  const line = {
    level,
    time: new Date().toISOString(),
    ...(traceId ? { traceId } : {}),
    ...(meta ?? {}),
    msg: message,
  };
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  fn(JSON.stringify(line));
}

export const logger = {
  debug: (meta: Record<string, unknown> | undefined, message: string): void => {
    if (process.env.LOG_LEVEL === 'debug') {
      emit('debug', meta, message);
    }
  },
  info: (meta: Record<string, unknown> | undefined, message: string): void => emit('info', meta, message),
  warn: (meta: Record<string, unknown> | undefined, message: string): void => emit('warn', meta, message),
  error: (meta: Record<string, unknown> | undefined, message: string): void => emit('error', meta, message),
};
