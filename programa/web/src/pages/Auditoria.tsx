import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  listAuditLogs,
  messageOf,
  type AuditLog,
  type AuditLogFilters,
} from '@/services/audit';
import { Icon } from '@/components/icons';

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
    <div className="page auditoria-page">
      <div className="page-header">
        <div>
          <h1>Auditoria</h1>
          <p>Histórico de eventos do sistema.</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="auditoria-filtros" aria-label="Filtros de auditoria">
        <div className="auditoria-campo">
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
        <div className="auditoria-campo">
          <label className="field-label" htmlFor="audit-entityId">Identificador</label>
          <input
            id="audit-entityId"
            className="input auditoria-campo__mono"
            type="text"
            value={filters.entityId}
            onChange={(e) => setFilters({ ...filters, entityId: e.target.value })}
            placeholder="ex.: 42"
          />
        </div>
        <div className="auditoria-campo">
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
        <div className="auditoria-campo">
          <label className="field-label" htmlFor="audit-performedById">ID do ator</label>
          <input
            id="audit-performedById"
            className="input auditoria-campo__mono"
            type="number"
            min={0}
            value={filters.performedById}
            onChange={(e) => setFilters({ ...filters, performedById: e.target.value })}
            placeholder="0 = ignorar"
          />
        </div>
        <div className="auditoria-campo">
          <label className="field-label" htmlFor="audit-limit">Limite</label>
          <input
            id="audit-limit"
            className="input auditoria-campo__mono"
            type="number"
            min={1}
            max={200}
            value={filters.limit}
            onChange={(e) => setFilters({ ...filters, limit: e.target.value })}
          />
        </div>
        <div className="auditoria-acoes">
          <button type="submit" className="primary-button">
            <Icon name="filter" size={16} />
            Filtrar
          </button>
          <button type="button" className="ghost-button" onClick={handleReset}>Limpar</button>
        </div>
      </form>

      <section className="card auditoria-eventos" aria-labelledby="au-title">
        <div className="auditoria-eventos__cabecalho">
          <h2 id="au-title" className="auditoria-eventos__titulo">Eventos</h2>
          {list.length > 0 && (
            <span className="chip chip--static auditoria-chip">
              <span className="auditoria-mono">{list.length}</span> resultados
            </span>
          )}
        </div>
        {logs.isLoading && (
          <p className="auditoria-carregando" role="status">
            <span className="btn-spinner" aria-hidden="true" />
            Carregando eventos…
          </p>
        )}
        {logs.isError && (
          <div className="auditoria-estado">
            <p className="alert alert--error" role="alert">{messageOf(logs.error)}</p>
          </div>
        )}
        {logs.data && list.length === 0 && !logs.isLoading && (
          <div className="auditoria-estado">
            <div className="empty-state">
              <span className="empty-state__icon">
                <Icon name="file-text" size={36} strokeWidth={1.5} />
              </span>
              <strong className="empty-state__title">Sem eventos</strong>
              <p className="empty-state__text">Nenhum registro de auditoria corresponde aos filtros aplicados.</p>
            </div>
          </div>
        )}
        {list.length > 0 && (
          <div className="table-wrapper">
            <table className="table auditoria-tabela">
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
    <tr className="auditoria-linha">
      <td className="auditoria-data">{formatDateTime(log.createdAt)}</td>
      <td>
        <span className="auditoria-ator">
          <strong>{actorName}</strong>
          <span className="badge badge--muted auditoria-papel">{actorRole}</span>
        </span>
        <span className="auditoria-email">{actorEmail}</span>
      </td>
      <td><span className="badge badge--muted auditoria-entidade">{log.entityType}</span></td>
      <td><span className="badge badge--info auditoria-acao">{log.action}</span></td>
      <td>
        <span className="auditoria-identificador">
          <span className="auditoria-id">{log.entityId}</span>
          {(showBefore || showAfter) && (
            <details className="auditoria-diff">
              <summary className="auditoria-diff__resumo">
                Ver diff
                <Icon name="chevron-down" size={14} strokeWidth={2} className="auditoria-diff__fechado" />
                <Icon name="chevron-up" size={14} strokeWidth={2} className="auditoria-diff__aberto" />
              </summary>
              <div className="auditoria-diff__grade">
                {showBefore && (
                  <div className="auditoria-diff__lado">
                    <strong>Antes</strong>
                    <pre className="auditoria-diff__json">{snapshotJson(log.before)}</pre>
                  </div>
                )}
                {showAfter && (
                  <div className="auditoria-diff__lado">
                    <strong>Depois</strong>
                    <pre className="auditoria-diff__json">{snapshotJson(log.after)}</pre>
                  </div>
                )}
              </div>
            </details>
          )}
        </span>
      </td>
    </tr>
  );
}
