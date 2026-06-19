// Helpers e tipos para o endpoint de Auditoria.
// O backend devolve snapshots opcionais (before/after) que podem vir como
// string JSON ou objeto já parseado — o consumidor deve tratar os dois casos.

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
  const data = await api.get<AuditLog[]>('/v1/audit', query);
  return Array.isArray(data) ? data : [];
}

export { messageOf } from '@/services/quoteResponses';