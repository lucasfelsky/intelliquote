import { useQuery } from '@tanstack/react-query';
import { Modal } from '@/components/Modal';
import { messageOf } from '@/services/quoteResponses';
import {
  getItemPriceHistory,
  itemPriceHistoryQueryKey,
  type ItemPriceHistoryEntry,
} from '@/services/itemPriceHistory';

// Pop-up "Histórico de preço" do item (aba Itens): todas as cotações ligadas ao mesmo item do
// catálogo, mais recente primeiro. Preço ofertado puro (moeda do fornecedor), sem landed cost.
// CSS: só classes já existentes (tabela, selos e as do histórico por resposta), nenhuma regra nova.

export const EMPTY_ITEM_HISTORY_MESSAGE = 'Ainda não há preços registrados para este item.';
export const NO_CATALOG_MESSAGE = 'Item sem vínculo ao catálogo: mostrando só esta cotação.';
export const TRUNCATED_MESSAGE = 'Mostrando as 300 linhas mais recentes.';

function formatPrice(value: string, currency: string): string {
  const num = Number(value);
  if (Number.isNaN(num)) return '—';
  return `${num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  // Fuso do navegador (nunca toISOString para exibir).
  return date.toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function sourceLabel(source: ItemPriceHistoryEntry['source']): string {
  if (source === 'portal') return 'via portal';
  if (source === 'manual') return 'manual';
  return 'legado';
}

// "+3,20%" / "−1,05%" / "0,00%" / "—" (texto, sem depender de cor).
export function formatVariation(pct: number | null): string {
  if (pct === null || Number.isNaN(pct)) return '—';
  const abs = Math.abs(pct).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (pct > 0) return `+${abs}%`;
  if (pct < 0) return `−${abs}%`;
  return `${abs}%`;
}

export function ItemPriceHistoryModal({
  item,
  onClose,
}: {
  item: { id: number; name: string };
  onClose: () => void;
}) {
  const historyQuery = useQuery({
    queryKey: itemPriceHistoryQueryKey(item.id),
    queryFn: () => getItemPriceHistory(item.id),
  });

  const data = historyQuery.data;
  const entries = data?.entries ?? [];

  return (
    <Modal isOpen onClose={onClose} size="xl" title={`Histórico de preço — ${item.name}`}>
      {historyQuery.isPending && <p className="price-history__estado">Carregando histórico…</p>}
      {historyQuery.isError && (
        <div className="alert alert--error" role="alert">Não foi possível carregar o histórico: {messageOf(historyQuery.error)}</div>
      )}
      {data && data.linkedBy === 'quoteRequestItem' && (
        <p className="price-history__estado" role="status">{NO_CATALOG_MESSAGE}</p>
      )}
      {historyQuery.isSuccess && entries.length === 0 && (
        <p className="price-history__estado">{EMPTY_ITEM_HISTORY_MESSAGE}</p>
      )}
      {historyQuery.isSuccess && entries.length > 0 && (
        <div className="table-wrapper price-history__tabela">
          <table className="table">
            <thead>
              <tr>
                <th className="price-history__fixa">Data</th>
                <th>Cotação</th>
                <th>Fornecedor</th>
                <th>Origem</th>
                <th>Incoterm</th>
                <th>Moeda</th>
                <th>Preço unitário</th>
                <th>Variação</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, index) => (
                <tr key={`${entry.quoteRequestId}-${entry.supplierId}-${entry.recordedAt}-${index}`}>
                  <td className="price-history__fixa">
                    <div className="price-history__data">{formatDateTime(entry.recordedAt)}</div>
                  </td>
                  <td>
                    {entry.isCurrentQuote ? (
                      <span className="badge badge--info" title={entry.requestCode}>esta cotação</span>
                    ) : (
                      entry.requestCode
                    )}
                  </td>
                  <td>{entry.supplierName}</td>
                  <td>
                    <span className={entry.source === 'portal' ? 'badge badge--info price-history__origem' : 'badge badge--muted price-history__origem'}>
                      {sourceLabel(entry.source)}
                    </span>
                  </td>
                  <td><span className="chip chip--static">{entry.incoterm}</span></td>
                  <td>{entry.currency}</td>
                  <td>
                    <div className="price-history__preco">{formatPrice(entry.unitPrice, entry.currency)}</div>
                    <small className="price-history__apoio">por {entry.unit} · qtd {entry.quantity.toLocaleString('pt-BR')}</small>
                    {entry.incotermPrices.length > 0 && (
                      <div className="price-history__alternativos">
                        {entry.incotermPrices.map((alt) => (
                          <div key={alt.incoterm}>{alt.incoterm} {formatPrice(alt.unitPrice, entry.currency)}</div>
                        ))}
                      </div>
                    )}
                  </td>
                  <td>{formatVariation(entry.variationPct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data?.truncated && <p className="price-history__estado">{TRUNCATED_MESSAGE}</p>}
      <div className="modal-actions">
        <button type="button" className="ghost-button price-history__fechar" onClick={onClose}>Fechar</button>
      </div>
    </Modal>
  );
}
