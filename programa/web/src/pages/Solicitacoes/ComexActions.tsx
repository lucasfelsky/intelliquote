import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '@/api/client';
import { Modal } from '@/components/Modal';
import {
  CommercialRequestForComex,
  fulfillCommercialRequest,
  linkCommercialRequestToQuote,
  OpenQuoteOption,
  rejectCommercialRequest,
  searchOpenQuoteRequests,
} from '@/services/commercialRequests';

const MIN_SEARCH_LENGTH = 2;
const SEARCH_DEBOUNCE_MS = 300;
const MIN_REASON_LENGTH = 3;
const MAX_REASON_LENGTH = 500;
const REQUESTS_KEY = ['commercial-requests'] as const;

type ModalKind = 'link' | 'reject' | 'fulfill';

const MODAL_TEXT_ALIGN = { textAlign: 'left' } as const;

function messageOf(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body as { message?: unknown } | null;
    if (body && typeof body.message === 'string') return body.message;
    return err.message;
  }
  return err instanceof Error ? err.message : 'Erro desconhecido.';
}

interface ModalProps {
  request: CommercialRequestForComex;
  onClose: () => void;
}

function LinkQuoteModal({ request, onClose }: ModalProps) {
  const qc = useQueryClient();
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  const [selected, setSelected] = useState<OpenQuoteOption | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(term.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [term]);

  const search = useQuery({
    queryKey: ['commercial-requests', 'open-quotes', debounced],
    queryFn: () => searchOpenQuoteRequests(debounced),
    enabled: debounced.length >= MIN_SEARCH_LENGTH,
  });

  const link = useMutation({
    mutationFn: (quoteRequestId: number) => linkCommercialRequestToQuote(request.id, quoteRequestId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: REQUESTS_KEY });
      onClose();
    },
    onError: (err) => setError(messageOf(err)),
  });

  const results = search.data ?? [];

  return (
    <Modal isOpen onClose={onClose} title={`Vincular solicitação #${request.id} a uma cotação`}>
      <div style={MODAL_TEXT_ALIGN}>
        <label className="field-label" htmlFor="cr-link-search">Buscar cotação aberta</label>
        <input
          id="cr-link-search"
          className="input"
          placeholder="Código ou descrição (ao menos 2 letras)"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          autoComplete="off"
        />
        {search.isError && (
          <p role="alert" style={{ color: 'var(--danger)' }} className="text-sm">
            {messageOf(search.error)}
          </p>
        )}
        {debounced.length >= MIN_SEARCH_LENGTH && search.isSuccess && results.length === 0 && (
          <p className="text-sm" style={{ color: 'var(--ink-soft)', margin: '4px 0 0' }}>
            Nenhuma cotação aberta encontrada.
          </p>
        )}
        {results.length > 0 && (
          <ul aria-label="Cotações abertas" style={{ listStyle: 'none', margin: '8px 0 0', padding: 0 }}>
            {results.map((quote) => (
              <li key={quote.id}>
                <button
                  type="button"
                  className="ghost-button"
                  style={MODAL_TEXT_ALIGN}
                  aria-pressed={selected?.id === quote.id}
                  onClick={() => setSelected(quote)}
                >
                  {quote.requestCode}
                  {quote.description ? ` — ${quote.description}` : ''}
                  {selected?.id === quote.id ? ' ✓' : ''}
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-sm" style={{ color: 'var(--ink-soft)', marginTop: 12 }}>
          Itens novos não entram nos links já enviados aos fornecedores.
        </p>
        {error && (
          <p role="alert" style={{ color: 'var(--danger)' }} className="text-sm">
            {error}
          </p>
        )}
        <div className="row-actions" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
          <button type="button" className="ghost-button" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={!selected || link.isPending}
            onClick={() => {
              if (!selected) return;
              setError(null);
              link.mutate(selected.id);
            }}
          >
            {link.isPending ? 'Vinculando…' : 'Vincular'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function RejectModal({ request, onClose }: ModalProps) {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const reject = useMutation({
    mutationFn: (text: string) => rejectCommercialRequest(request.id, text),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: REQUESTS_KEY });
      onClose();
    },
    onError: (err) => setError(messageOf(err)),
  });

  const trimmed = reason.trim();
  const canSubmit = trimmed.length >= MIN_REASON_LENGTH && !reject.isPending;

  return (
    <Modal isOpen onClose={onClose} title={`Recusar solicitação #${request.id}`}>
      <div style={MODAL_TEXT_ALIGN}>
        <label className="field-label" htmlFor="cr-reject-reason">Motivo da recusa *</label>
        <textarea
          id="cr-reject-reason"
          className="textarea"
          rows={3}
          maxLength={MAX_REASON_LENGTH}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <p className="text-sm" style={{ color: 'var(--ink-soft)', marginTop: 4 }}>
          O solicitante verá este motivo.
        </p>
        {error && (
          <p role="alert" style={{ color: 'var(--danger)' }} className="text-sm">
            {error}
          </p>
        )}
        <div className="row-actions" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
          <button type="button" className="ghost-button" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={!canSubmit}
            onClick={() => {
              setError(null);
              reject.mutate(trimmed);
            }}
          >
            {reject.isPending ? 'Recusando…' : 'Confirmar recusa'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function FulfillModal({ request, onClose, isAdmin }: ModalProps & { isAdmin: boolean }) {
  const qc = useQueryClient();
  const [withoutPrice, setWithoutPrice] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const fulfill = useMutation({
    mutationFn: (input?: { force: true; note: string }) => fulfillCommercialRequest(request.id, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: REQUESTS_KEY });
      onClose();
    },
    onError: (err) => setError(messageOf(err)),
  });

  const trimmedNote = note.trim();
  const canSubmit =
    !fulfill.isPending && (!withoutPrice || trimmedNote.length >= MIN_REASON_LENGTH);

  return (
    <Modal isOpen onClose={onClose} title={`Marcar solicitação #${request.id} como atendida`}>
      <div style={MODAL_TEXT_ALIGN}>
        <p className="text-sm" style={{ marginTop: 0 }}>
          O solicitante será avisado e verá o preço final do fornecedor vencedor.
        </p>
        {isAdmin && (
          <div>
            <label className="field-label" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={withoutPrice}
                onChange={(e) => {
                  setWithoutPrice(e.target.checked);
                  setError(null);
                }}
              />
              Atender sem preço
            </label>
            {withoutPrice && (
              <div style={{ marginTop: 8 }}>
                <label className="field-label" htmlFor="cr-fulfill-note">Motivo *</label>
                <textarea
                  id="cr-fulfill-note"
                  className="textarea"
                  rows={3}
                  maxLength={MAX_REASON_LENGTH}
                  value={note}
                  onChange={(e) => {
                    setNote(e.target.value);
                    setError(null);
                  }}
                />
              </div>
            )}
          </div>
        )}
        {error && (
          <p role="alert" style={{ color: 'var(--danger)' }} className="text-sm">
            {error}
          </p>
        )}
        <div className="row-actions" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
          <button type="button" className="ghost-button" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={!canSubmit}
            onClick={() => {
              setError(null);
              fulfill.mutate(withoutPrice ? { force: true, note: trimmedNote } : undefined);
            }}
          >
            {fulfill.isPending ? 'Salvando…' : 'Confirmar'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

interface ActionsProps {
  request: CommercialRequestForComex;
  role: string | undefined;
}

// Acoes do COMEX sobre uma solicitacao: so admin e comprador (gestor/viewer so leem).
export function CommercialRequestActions({ request, role }: ActionsProps) {
  const navigate = useNavigate();
  const [modal, setModal] = useState<ModalKind | null>(null);

  const canAct = role === 'admin' || role === 'comprador';
  if (!canAct) return null;
  if (request.status !== 'pending' && request.status !== 'quoting') return null;

  const close = () => setModal(null);

  return (
    <>
      <span className="row-actions">
        {request.status === 'pending' && (
          <>
            <button
              type="button"
              className="ghost-button ghost-button--sm"
              onClick={() => navigate(`/cotacoes/nova?fromCommercialRequest=${request.id}`)}
            >
              Criar cotação
            </button>
            <button
              type="button"
              className="ghost-button ghost-button--sm"
              onClick={() => setModal('link')}
            >
              Vincular a cotação
            </button>
          </>
        )}
        {request.status === 'quoting' && (
          <button
            type="button"
            className="ghost-button ghost-button--sm"
            onClick={() => setModal('fulfill')}
          >
            Marcar atendida
          </button>
        )}
        <button
          type="button"
          className="ghost-button ghost-button--sm danger-button"
          onClick={() => setModal('reject')}
        >
          Recusar
        </button>
      </span>
      {modal !== null && (
        // O <dialog> herda text-align do td do card mobile (direita): fixa a esquerda.
        <div style={MODAL_TEXT_ALIGN}>
          {modal === 'link' && <LinkQuoteModal request={request} onClose={close} />}
          {modal === 'reject' && <RejectModal request={request} onClose={close} />}
          {modal === 'fulfill' && (
            <FulfillModal request={request} onClose={close} isAdmin={role === 'admin'} />
          )}
        </div>
      )}
    </>
  );
}
