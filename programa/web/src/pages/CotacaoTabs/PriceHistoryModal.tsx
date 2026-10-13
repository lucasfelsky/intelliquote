import { useQuery } from '@tanstack/react-query';
import { Modal } from '@/components/Modal';
import { messageOf, type QuoteResponse } from '@/services/quoteResponses';
import {
  getPriceHistory,
  priceHistoryQueryKey,
  type PriceHistoryColumn,
  type PriceHistoryRow,
} from '@/services/priceHistory';

// Pop-up "Histórico" da aba Respostas: uma linha por versão em que algo de preço
// mudou (portal ou edição manual); colunas = itens; destaque do que mudou vs a
// linha anterior (calculado no servidor). CSS: .table/.badge/.table-wrapper + dialog.modal-dialog--xl.

const CHANGED_STYLE = { fontWeight: 700, background: 'rgba(0, 174, 145, 0.15)' } as const;
const STICKY_STYLE = { position: 'sticky', left: 0, background: 'var(--surface)', zIndex: 2 } as const;
const STICKY_HEADER_STYLE = { ...STICKY_STYLE, background: 'var(--surface-alt)' } as const;
const PORTAL_BADGE_STYLE = { background: 'rgba(0, 174, 145, 0.15)', color: 'var(--primary-700)' } as const;
const CHANGED_BADGE_STYLE = { fontWeight: 700, background: 'var(--primary-700)', color: '#fff' } as const;

export const EMPTY_HISTORY_MESSAGE = 'Histórico disponível a partir das próximas respostas ou edições.';

function formatCurrency(value: number | undefined | null, currency: string): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  return value.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }) + ' ' + currency;
}

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  // Fuso do navegador, igual ao restante da aba (nunca toISOString para exibir).
  return date.toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function sourceLabel(source: string): string {
  return source === 'portal' ? 'via portal' : source;
}

// "Nome <email>" (portal) vira so' o nome na celula; o valor completo vai para o title.
function actorDisplay(actorName: string | null): { name: string; title: string } | null {
  if (!actorName) return null;
  const [name] = actorName.split(' <');
  return { name: name || actorName, title: actorName };
}

function ItemCell({ row, column, changed }: { row: PriceHistoryRow; column: PriceHistoryColumn; changed: boolean }) {
  const item = row.items.find((entry) => entry.quoteRequestItemId === column.quoteRequestItemId);
  const style = changed ? CHANGED_STYLE : undefined;
  const changedAttr = changed ? 'true' : undefined;
  if (!item) {
    return <td data-changed={changedAttr} style={style}>—</td>;
  }
  if (item.isUnavailable) {
    return (
      <td data-changed={changedAttr} style={style}>
        <span className="badge badge--warning">Indisponível</span>
      </td>
    );
  }
  // Preços por incoterm alternativo (#95): só quando há 2+ entradas; o principal fica em destaque.
  const alternatives = (item.incotermPrices ?? []).filter(
    (entry) => entry.incoterm !== row.offeredIncoterm,
  );
  return (
    <td data-changed={changedAttr} style={style}>
      <div>{formatCurrency(Number(item.unitPrice), row.currency)}</div>
      <small style={{ color: 'var(--ink-soft)' }}>qtd {item.quantity.toLocaleString('pt-BR')}</small>
      {(item.incotermPrices?.length ?? 0) >= 2 && alternatives.length > 0 && (
        <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
          {alternatives.map((entry) => (
            <div key={entry.incoterm}>{entry.incoterm} {formatCurrency(Number(entry.unitPrice), row.currency)}</div>
          ))}
        </div>
      )}
    </td>
  );
}

export function PriceHistoryModal({ response, onClose }: { response: QuoteResponse; onClose: () => void }) {
  const supplierName = response.supplier?.name ?? `Fornecedor #${response.supplierId}`;

  const historyQuery = useQuery({
    queryKey: priceHistoryQueryKey(response.id),
    queryFn: () => getPriceHistory(response.id),
  });

  const columns = historyQuery.data?.columns ?? [];
  const rows = historyQuery.data?.rows ?? [];

  return (
    <Modal isOpen onClose={onClose} size="xl" title={`Histórico de preços — ${supplierName}`}>
      {historyQuery.isPending && <p style={{ color: 'var(--ink-soft)' }}>Carregando histórico…</p>}
      {historyQuery.isError && (
        <div className="alert alert--error" role="alert">Não foi possível carregar o histórico: {messageOf(historyQuery.error)}</div>
      )}
      {historyQuery.isSuccess && rows.length === 0 && (
        <p style={{ color: 'var(--ink-soft)' }}>{EMPTY_HISTORY_MESSAGE}</p>
      )}
      {historyQuery.isSuccess && rows.length > 0 && (
        <div className="table-wrapper">
          <table className="table" style={{ whiteSpace: 'nowrap' }}>
            <thead>
              <tr>
                <th style={STICKY_HEADER_STYLE}>Data / origem</th>
                {columns.map((column) => (
                  <th key={column.quoteRequestItemId} title={column.productName}>
                    {column.itemCode ?? column.productName}
                  </th>
                ))}
                <th>Incoterm</th>
                <th>Total da proposta</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const previous = index > 0 ? rows[index - 1] : undefined;
                const incotermChanged = row.changedFields.includes('offeredIncoterm');
                const currencyChanged = row.changedFields.includes('currency');
                const totalChanged = row.changedFields.includes('offeredPrice') || currencyChanged;
                const actor = actorDisplay(row.actorName);
                return (
                  <tr key={row.id}>
                    {/* Data + badge de origem + autor empilhados na coluna fixa (cabe no 390px). */}
                    <td style={STICKY_STYLE}>
                      <div>{formatDateTime(row.recordedAt)}</div>
                      <span
                        className="badge"
                        style={row.source === 'portal' ? PORTAL_BADGE_STYLE : undefined}
                        title={actor?.title}
                      >
                        {sourceLabel(row.source)}
                      </span>
                      {actor && (
                        <small
                          title={actor.title}
                          style={{ display: 'block', whiteSpace: 'normal', maxWidth: 160, color: 'var(--ink-soft)' }}
                        >
                          {actor.name}
                        </small>
                      )}
                    </td>
                    {columns.map((column) => (
                      <ItemCell
                        key={column.quoteRequestItemId}
                        row={row}
                        column={column}
                        changed={row.changedItemIds.includes(column.quoteRequestItemId)}
                      />
                    ))}
                    {/* Incoterm/moeda alterados: celula destacada + valor anterior em texto menor (o badge tem fundo proprio). */}
                    <td data-changed={incotermChanged ? 'true' : undefined} style={incotermChanged ? CHANGED_STYLE : undefined}>
                      <span className="badge" style={incotermChanged ? CHANGED_BADGE_STYLE : undefined}>{row.offeredIncoterm}</span>
                      {incotermChanged && previous && (
                        <small style={{ display: 'block', color: 'var(--ink-soft)' }}>antes: {previous.offeredIncoterm}</small>
                      )}
                    </td>
                    <td data-changed={totalChanged ? 'true' : undefined} style={totalChanged ? CHANGED_STYLE : undefined}>
                      <div>{formatCurrency(Number(row.offeredPrice), row.currency)}</div>
                      {currencyChanged && previous && (
                        <small style={{ display: 'block', color: 'var(--ink-soft)' }}>moeda: {previous.currency} → {row.currency}</small>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="row-actions" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
        <button type="button" className="ghost-button" onClick={onClose}>Fechar</button>
      </div>
    </Modal>
  );
}
