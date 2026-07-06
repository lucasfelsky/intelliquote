import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  listAuditLogs,
  messageOf,
  type AuditLog,
  type AuditLogFilters,
} from '@/services/audit';

interface FiltersState {
  entityType: string;
  entityId: string;
  action: string;
  performedById: string;
  limit: string;
}

const initialFilters: FiltersState = {
  entityType: '',
  entityId: '',
  action: '',
  performedById: '0',
  limit: '50',
};

function buildFilters(state: FiltersState): AuditLogFilters {
  const performedByIdNum = Number(state.performedById);
  const limitNum = Number(state.limit);
  return {
    entityType: state.entityType.trim() || null,
    entityId: state.entityId.trim() || null,
    action: state.action.trim() || null,
    performedById: Number.isFinite(performedByIdNum) && performedByIdNum > 0
      ? performedByIdNum
      : null,
    limit: Number.isFinite(limitNum) && limitNum > 0 ? Math.min(limitNum, 200) : 50,
  };
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function parseSnapshot(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return value;
    }
  }
  return value;
}

function snapshotJson(value: unknown): string {
  const parsed = parseSnapshot(value);
  if (parsed === null || parsed === undefined) return '';
  try {
    return JSON.stringify(parsed, null, 2);
  } catch {
    return String(parsed);
  }
}

function hasSnapshot(value: unknown): boolean {
  const parsed = parseSnapshot(value);
  if (parsed === null || parsed === undefined) return false;
  if (typeof parsed === 'string') return parsed.trim().length > 0;
  if (Array.isArray(parsed)) return parsed.length > 0;
  if (typeof parsed === 'object') return Object.keys(parsed as Record<string, unknown>).length > 0;
  return true;
}

export default function Auditoria() {
  const [filters, setFilters] = useState<FiltersState>(initialFilters);
  const [submitted, setSubmitted] = useState<FiltersState>(initialFilters);

  const activeFilters = buildFilters(submitted);

  const logs = useQuery({
    queryKey: ['audit', activeFilters],
    queryFn: () => listAuditLogs(activeFilters),
  });

  const list: AuditLog[] = logs.data ?? [];

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted({ ...filters });
  }

  function handleReset() {
    setFilters(initialFilters);
    setSubmitted(initialFilters);
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <p className="eyebrow">Administração</p>
          <h1>Auditoria</h1>
          <p>Histórico de eventos do sistema.</p>
        </div>
      </div>

      <section className="card">
        <form onSubmit={handleSubmit} className="form-grid">
          <div>
            <label className="field-label" htmlFor="audit-entityType">Tipo de entidade</label>
            <input
              id="audit-entityType"
              className="input"
              type="text"
              value={filters.entityType}
              onChange={(e) => setFilters({ ...filters, entityType: e.target.value })}
              placeholder="ex.: quoteRequest, supplier"
            />
          </div>
          <div>
            <label className="field-label" htmlFor="audit-entityId">Identificador</label>
            <input
              id="audit-entityId"
              className="input"
              type="text"
              value={filters.entityId}
              onChange={(e) => setFilters({ ...filters, entityId: e.target.value })}
              placeholder="ex.: 42"
            />
          </div>
          <div>
            <label className="field-label" htmlFor="audit-action">Ação</label>
            <input
              id="audit-action"
              className="input"
              type="text"
              value={filters.action}
              onChange={(e) => setFilters({ ...filters, action: e.target.value })}
              placeholder="ex.: create, update"
            />
          </div>
          <div>
            <label className="field-label" htmlFor="audit-performedById">ID do ator</label>
            <input
              id="audit-performedById"
              className="input"
              type="number"
              min={0}
              value={filters.performedById}
              onChange={(e) => setFilters({ ...filters, performedById: e.target.value })}
              placeholder="0 = ignorar"
            />
          </div>
          <div>
            <label className="field-label" htmlFor="audit-limit">Limite</label>
            <input
              id="audit-limit"
              className="input"
              type="number"
              min={1}
              max={200}
              value={filters.limit}
              onChange={(e) => setFilters({ ...filters, limit: e.target.value })}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
            <button type="submit" className="primary-button">Filtrar</button>
            <button type="button" className="ghost-button" onClick={handleReset}>Limpar</button>
          </div>
        </form>
      </section>

      <section className="card">
        <div className="page-header" style={{ marginBottom: 8 }}>
          <h2>Eventos</h2>
          {list.length > 0 && <span className="chip chip--static">{list.length} resultados</span>}
        </div>
        {logs.isLoading && <p>Carregando eventos…</p>}
        {logs.isError && (
          <div className="empty-state">
            <p>{messageOf(logs.error)}</p>
          </div>
        )}
        {logs.data && list.length === 0 && !logs.isLoading && (
          <div className="empty-state">
            <strong>Sem eventos</strong>
            <p>Nenhum registro de auditoria corresponde aos filtros aplicados.</p>
          </div>
        )}
        {list.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Data/hora</th>
                  <th>Ator</th>
                  <th>Entidade</th>
                  <th>Ação</th>
                  <th>Identificador</th>
                </tr>
              </thead>
              <tbody>
                {list.map((log) => (
                  <LogRow key={log.id} log={log} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function LogRow({ log }: { log: AuditLog }) {
  const actorName = log.performedBy?.name ?? 'Sistema';
  const actorEmail = log.performedBy?.email ?? '—';
  const actorRole = log.performedBy?.role?.name ?? '—';
  const showBefore = hasSnapshot(log.before);
  const showAfter = hasSnapshot(log.after);

  return (
    <tr>
      <td>{formatDateTime(log.createdAt)}</td>
      <td>
        <strong>{actorName}</strong>
        <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{actorEmail}</div>
        <div>
          <span className="badge badge--muted">{actorRole}</span>
        </div>
      </td>
      <td><span className="badge">{log.entityType}</span></td>
      <td><span className="badge badge--info">{log.action}</span></td>
      <td>
        <div>{log.entityId}</div>
        {(showBefore || showAfter) && (
          <details style={{ marginTop: 6 }}>
            <summary
              style={{
                cursor: 'pointer',
                fontSize: 12,
                color: 'var(--primary-700)',
              }}
            >
              Ver diff
            </summary>
            <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {showBefore && (
                <div>
                  <strong style={{ fontSize: 12, color: 'var(--ink-soft)' }}>Antes</strong>
                  <pre
                    style={{
                      background: 'var(--surface-alt)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-sm)',
                      padding: 8,
                      fontSize: 11,
                      maxHeight: 240,
                      overflow: 'auto',
                      margin: '4px 0 0',
                    }}
                  >
                    {snapshotJson(log.before)}
                  </pre>
                </div>
              )}
              {showAfter && (
                <div>
                  <strong style={{ fontSize: 12, color: 'var(--ink-soft)' }}>Depois</strong>
                  <pre
                    style={{
                      background: 'var(--surface-alt)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-sm)',
                      padding: 8,
                      fontSize: 11,
                      maxHeight: 240,
                      overflow: 'auto',
                      margin: '4px 0 0',
                    }}
                  >
                    {snapshotJson(log.after)}
                  </pre>
                </div>
              )}
            </div>
          </details>
        )}
      </td>
    </tr>
  );
}