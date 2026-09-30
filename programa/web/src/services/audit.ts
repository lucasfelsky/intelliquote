// Helpers e tipos para o endpoint de Auditoria.
// O backend devolve snapshots opcionais em beforeData/afterData (string JSON
// ou objeto já parseado — o consumidor deve tratar os dois casos). Aqui eles
// são mapeados para before/after, que é o que a tela de Auditoria lê.

import { api } from '@/api/client';

export interface AuditLogActorRole {
  name: string;
}

export interface AuditLogActor {
  id: number;
  name: string;
  email: string;
  role: AuditLogActorRole;
}

export interface AuditLog {
  id: number;
  entityType: string;
  entityId: string;
  action: string;
  performedById: number | null;
  createdAt: string;
  before?: unknown;
  after?: unknown;
  performedBy?: AuditLogActor | null;
}

interface AuditLogApiRow extends Omit<AuditLog, 'before' | 'after'> {
  beforeData?: unknown;
  afterData?: unknown;
  metadata?: unknown;
}

export interface AuditLogFilters {
  entityType?: string | null;
  entityId?: string | null;
  action?: string | null;
  performedById?: number | null;
  limit?: number | null;
}

export async function listAuditLogs(filters: AuditLogFilters = {}): Promise<AuditLog[]> {
  const query: Record<string, string | number | undefined> = {};
  if (filters.entityType) query.entityType = filters.entityType;
  if (filters.entityId) query.entityId = filters.entityId;
  if (filters.action) query.action = filters.action;
  if (filters.performedById !== null && filters.performedById !== undefined) {
    query.performedById = filters.performedById;
  }
  if (filters.limit !== null && filters.limit !== undefined) {
    query.limit = filters.limit;
  }
  const data = await api.get<AuditLogApiRow[]>('/v1/audit', query);
  if (!Array.isArray(data)) return [];
  return data.map((row) => ({
    ...row,
    before: row.beforeData ?? null,
    after: row.afterData ?? null,
  }));
}

export { messageOf } from '@/services/quoteResponses';