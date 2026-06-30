import { AsyncLocalStorage } from 'node:async_hooks';

export interface TraceContext {
  traceId: string;
}

const storage = new AsyncLocalStorage<TraceContext>();

export const traceStorage = storage;

export function getCurrentTraceId(): string | undefined {
  return storage.getStore()?.traceId;
}
