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
    <section className="card sol-dev-painel" aria-label="Solicitação de desenvolvimento">
      <div className="sol-dev-painel__topo">
        <h2>Solicitação de desenvolvimento</h2>
        <span className="badge badge--muted">Interno: não chega ao fornecedor</span>
      </div>

      {linked.isLoading && (
        <p className="sol-dev-painel__texto">
          Carregando solicitação…
        </p>
      )}

      {linked.isError && (
        <p role="alert" className="alert alert--error">
          Não foi possível carregar a solicitação de desenvolvimento: {messageOf(linked.error)}
        </p>
      )}

      {linked.isSuccess && requests.length === 0 && (
        <p className="sol-dev-painel__texto">
          Nenhuma solicitação de desenvolvimento ligada a esta cotação.
        </p>
      )}

      {requests.map((request) => {
        const newItems = request.items.filter((item) => item.isNewItem);
        return (
          <div key={request.id} className="sol-dev-painel__solicitacao">
            <p className="sol-dev-painel__resumo">
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
              <div className="sol-dev-painel__anexos">
                <strong className="text-sm">Anexos técnicos</strong>
                <AnexosLista requestId={request.id} attachments={request.attachments} />
              </div>
            ) : (
              <p className="sol-dev-painel__texto">
                Sem anexos técnicos.
              </p>
            )}
          </div>
        );
      })}
    </section>
  );
}
