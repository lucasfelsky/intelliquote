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
  const changedAttr = changed ? 'true' : undefined;
  const className = changed ? 'price-history__celula price-history__celula--alterada' : 'price-history__celula';
  if (!item) {
    return <td data-changed={changedAttr} className={className}>—</td>;
  }
  if (item.isUnavailable) {
    return (
      <td data-changed={changedAttr} className={className}>
        <span className="badge badge--warning">Indisponível</span>
      </td>
    );
  }
  // Preços por incoterm alternativo (#95): só quando há 2+ entradas; o principal fica em destaque.
  const alternatives = (item.incotermPrices ?? []).filter(
    (entry) => entry.incoterm !== row.offeredIncoterm,
  );
  return (
    <td data-changed={changedAttr} className={className}>
      <div className="price-history__preco">{formatCurrency(Number(item.unitPrice), row.currency)}</div>
      <small className="price-history__apoio">qtd {item.quantity.toLocaleString('pt-BR')}</small>
      {(item.incotermPrices?.length ?? 0) >= 2 && alternatives.length > 0 && (
        <div className="price-history__alternativos">
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
      {historyQuery.isPending && <p className="price-history__estado">Carregando histórico…</p>}
      {historyQuery.isError && (
        <div className="alert alert--error" role="alert">Não foi possível carregar o histórico: {messageOf(historyQuery.error)}</div>
      )}
      {historyQuery.isSuccess && rows.length === 0 && (
        <p className="price-history__estado">{EMPTY_HISTORY_MESSAGE}</p>
      )}
      {historyQuery.isSuccess && rows.length > 0 && (
        <div className="table-wrapper price-history__tabela">
          <table className="table">
            <thead>
              <tr>
                <th className="price-history__fixa">Data / origem</th>
                {columns.map((column) => (
                  <th
                    key={column.quoteRequestItemId}
                    title={column.productName}
                    className={column.itemCode ? 'price-history__codigo' : undefined}
                  >
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
                    <td className="price-history__fixa">
                      <div className="price-history__data">{formatDateTime(row.recordedAt)}</div>
                      <span
                        className={row.source === 'portal' ? 'badge badge--info price-history__origem' : 'badge badge--muted price-history__origem'}
                        title={actor?.title}
                      >
                        {sourceLabel(row.source)}
                      </span>
                      {actor && (
                        <small className="price-history__autor" title={actor.title}>
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
                    {/* Incoterm/moeda alterados: celula destacada + valor anterior em texto menor (o selo troca para o navy). */}
                    <td
                      data-changed={incotermChanged ? 'true' : undefined}
                      className={incotermChanged ? 'price-history__celula price-history__celula--alterada' : 'price-history__celula'}
                    >
                      <span className={incotermChanged ? 'chip chip--static price-history__incoterm--alterado' : 'chip chip--static'}>
                        {row.offeredIncoterm}
                      </span>
                      {incotermChanged && previous && (
                        <small className="price-history__apoio">antes: {previous.offeredIncoterm}</small>
                      )}
                    </td>
                    <td
                      data-changed={totalChanged ? 'true' : undefined}
                      className={totalChanged ? 'price-history__celula price-history__celula--alterada' : 'price-history__celula'}
                    >
                      <div className="price-history__preco">{formatCurrency(Number(row.offeredPrice), row.currency)}</div>
                      {currencyChanged && previous && (
                        <small className="price-history__apoio">moeda: {previous.currency} {'\u2192'} {row.currency}</small>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="modal-actions">
        <button type="button" className="ghost-button price-history__fechar" onClick={onClose}>Fechar</button>
      </div>
    </Modal>
  );
}
