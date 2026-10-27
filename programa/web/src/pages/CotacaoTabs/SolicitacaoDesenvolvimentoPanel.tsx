import { useQuery } from '@tanstack/react-query';
import { ApiError } from '@/api/client';
import { AnexosLista } from '@/pages/Solicitacoes/AnexosTecnicos';
import { NEW_ITEM_BADGE } from '@/pages/Solicitacoes/itemNovo';
import { listCommercialRequests } from '@/services/commercialRequests';

function messageOf(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body as { message?: unknown } | null;
    if (body && typeof body.message === 'string') return body.message;
    return err.message;
  }
  return err instanceof Error ? err.message : 'Erro desconhecido.';
}

const LINKED_PAGE_SIZE = 100;

interface Props {
  quoteRequestId: number;
}

/**
 * Detalhe da cotacao de desenvolvimento: itens novos pedidos pelo comercial (nome digitado ->
 * item do catalogo vinculado, observacao) e anexos tecnicos (so download). Interno: nada disto
 * chega ao fornecedor.
 */
export function SolicitacaoDesenvolvimentoPanel({ quoteRequestId }: Props) {
  const linked = useQuery({
    queryKey: ['commercial-requests', 'by-quote', quoteRequestId],
    // Maximo do backend (100): sem tamanho, a pagina padrao (20) truncaria as solicitacoes ligadas.
    queryFn: () => listCommercialRequests({ quoteRequestId, page: 1, pageSize: LINKED_PAGE_SIZE }),
  });

  const requests = (linked.data?.data ?? []).filter((request) => request.isDevelopment);

  return (
    <section className="card" aria-label="Solicitação de desenvolvimento" style={{ marginBottom: 16 }}>
      <h2 style={{ margin: '0 0 8px', fontSize: 16 }}>Solicitação de desenvolvimento</h2>

      {linked.isLoading && (
        <p className="text-sm" style={{ color: 'var(--ink-soft)' }}>
          Carregando solicitação…
        </p>
      )}

      {linked.isError && (
        <p role="alert" style={{ color: 'var(--danger)' }} className="text-sm">
          Não foi possível carregar a solicitação de desenvolvimento: {messageOf(linked.error)}
        </p>
      )}

      {linked.isSuccess && requests.length === 0 && (
        <p className="text-sm" style={{ color: 'var(--ink-soft)' }}>
          Nenhuma solicitação de desenvolvimento ligada a esta cotação.
        </p>
      )}

      {requests.map((request) => {
        const newItems = request.items.filter((item) => item.isNewItem);
        return (
          <div key={request.id} style={{ marginTop: 8 }}>
            <p className="text-sm" style={{ margin: '0 0 4px' }}>
              <strong>Solicitação #{request.id}</strong> · solicitante: {request.requestedBy.name}
            </p>
            {newItems.length > 0 && (
              <ul className="sol-items-list">
                {newItems.map((item) => {
                  const typed = item.proposedName ?? item.commercialName;
                  return (
                    <li key={item.id}>
                      <span className="badge badge--info">{NEW_ITEM_BADGE}</span> {typed}
                      {item.catalogItemId !== null
                        ? ` → ${item.commercialName} (catálogo)`
                        : ' — sem vínculo ao catálogo'}
                      {item.notes ? ` — Observação: ${item.notes}` : ''}
                    </li>
                  );
                })}
              </ul>
            )}
            {(request.attachments ?? []).length > 0 ? (
              <div style={{ marginTop: 6 }}>
                <strong className="text-sm">Anexos técnicos</strong>
                <AnexosLista requestId={request.id} attachments={request.attachments} />
              </div>
            ) : (
              <p className="text-sm" style={{ margin: '6px 0 0', color: 'var(--ink-soft)' }}>
                Sem anexos técnicos.
              </p>
            )}
          </div>
        );
      })}
    </section>
  );
}
