import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import {
  executeComparison,
  listComparisons,
  messageOf,
  type ComparisonRecord,
  type ComparisonResult,
} from '@/services/quoteResponses';

interface QuoteRequestSummary {
  id: number;
  requestCode: string;
  productName: string;
  status: 'open' | 'closed';
}

function formatNumber(value: number | undefined | null, fractionDigits = 2): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  return value.toLocaleString('pt-BR', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

function formatCurrency(value: number | undefined | null, currency = 'BRL'): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  return value.toLocaleString('pt-BR', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
    + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function normalizeQuoteRequest(raw: unknown): QuoteRequestSummary {
  if (typeof raw !== 'object' || raw === null) throw new Error('Resposta inesperada.');
  const obj = raw as Record<string, unknown>;
  return {
    id: Number(obj.id),
    requestCode: String(obj.requestCode ?? ''),
    productName: String(obj.productName ?? ''),
    status: (obj.status as 'open' | 'closed') ?? 'open',
  };
}

function unwrapPaginatedList(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    const obj = data as { data?: unknown; items?: unknown };
    if (Array.isArray(obj.data)) return obj.data;
    if (Array.isArray(obj.items)) return obj.items;
  }
  return [];
}

export default function Comparacoes() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const role = user?.role;
  const canCompare = role === 'admin' || role === 'comprador' || role === 'gestor';

  const [selectedId, setSelectedId] = useState<string>('');
  const [priceWeight, setPriceWeight] = useState(1);
  const [paymentWeight, setPaymentWeight] = useState(1);
  const [incotermWeight, setIncotermWeight] = useState(1);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [expandedHistory, setExpandedHistory] = useState<Set<number>>(new Set());

  const quoteRequests = useQuery({
    queryKey: ['quote-requests', 'all'],
    queryFn: async () => {
      const data = await api.get<unknown>('/v1/quote-requests');
      const items = unwrapPaginatedList(data);
      return items.map(normalizeQuoteRequest);
    },
  });

  useEffect(() => {
    if (!selectedId && quoteRequests.data && quoteRequests.data.length > 0) {
      const first = quoteRequests.data[0];
      if (first) setSelectedId(String(first.id));
    }
  }, [quoteRequests.data, selectedId]);

  const numericId = Number(selectedId);
  const selectedQuote = useMemo(
    () => (quoteRequests.data ?? []).find((q) => q.id === numericId) ?? null,
    [quoteRequests.data, numericId],
  );

  const history = useQuery({
    queryKey: ['comparisons', numericId],
    queryFn: () => listComparisons(numericId),
    enabled: Number.isFinite(numericId) && numericId > 0,
  });

  const runMut = useMutation({
    mutationFn: () => {
      const weights = {
        priceWeight,
        paymentTermsWeight: paymentWeight,
        incotermWeight,
      };
      return executeComparison(numericId, weights);
    },
    onSuccess: async () => {
      setFeedback({
        kind: 'ok',
        text: 'Comparação executada, vencedora definida e cotação fechada.',
      });
      await qc.invalidateQueries({ queryKey: ['comparisons', numericId] });
      await qc.invalidateQueries({ queryKey: ['quote-requests'] });
      await qc.invalidateQueries({ queryKey: ['quote-requests', 'all'] });
      await qc.invalidateQueries({ queryKey: ['quote-requests', 'open-closed'] });
      await qc.invalidateQueries({ queryKey: ['quote-responses'] });
    },
    onError: (err) => setFeedback({ kind: 'err', text: messageOf(err) }),
  });

  const canExecute = canCompare && selectedQuote?.status === 'open';

  function toggleExpanded(id: number) {
    setExpandedHistory((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const setPriceWeightRef = useRef(setPriceWeight);
  const setPaymentWeightRef = useRef(setPaymentWeight);
  const setIncotermWeightRef = useRef(setIncotermWeight);

  useEffect(() => { setPriceWeightRef.current = setPriceWeight; }, [setPriceWeight]);
  useEffect(() => { setPaymentWeightRef.current = setPaymentWeight; }, [setPaymentWeight]);
  useEffect(() => { setIncotermWeightRef.current = setIncotermWeight; }, [setIncotermWeight]);

  const setWeightById = (id: 'weight-price' | 'weight-payment' | 'weight-incoterm', next: number) => {
    if (id === 'weight-price') setPriceWeightRef.current(next);
    else if (id === 'weight-payment') setPaymentWeightRef.current(next);
    else setIncotermWeightRef.current(next);
  };

  function WeightSlider({
    label,
    value,
    id,
    min = 0,
    max = 5,
    step = 0.1,
  }: {
    label: string;
    value: number;
    id: 'weight-price' | 'weight-payment' | 'weight-incoterm';
    min?: number;
    max?: number;
    step?: number;
  }) {
    const sliderId = `ws-${id}`;
    const clamp = (n: number) => Math.max(min, Math.min(max, n));
    const pct = (clamp(value) - min) / (max - min) * 100;

    useEffect(() => {
      const el = document.getElementById(sliderId);
      if (!el) return;
      let dragging = false;
      const updateFromEvent = (clientX: number) => {
        const rect = el.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        const raw = min + ratio * (max - min);
        const stepped = Math.round(raw / step) * step;
        const next = Number(clamp(stepped).toFixed(2));
        if (Number.isFinite(next)) {
          setWeightById(id, next);
        }
      };
      const onDown = (ev: PointerEvent) => {
        dragging = true;
        try { el.setPointerCapture(ev.pointerId); } catch { /* ignore */ }
        updateFromEvent(ev.clientX);
        ev.preventDefault();
        ev.stopPropagation();
      };
      const onMove = (ev: PointerEvent) => {
        if (!dragging) return;
        updateFromEvent(ev.clientX);
        ev.preventDefault();
        ev.stopPropagation();
      };
      const onUp = (ev: PointerEvent) => {
        dragging = false;
        try { el.releasePointerCapture(ev.pointerId); } catch { /* ignore */ }
      };
      const onClick = (ev: MouseEvent) => {
        updateFromEvent(ev.clientX);
        ev.preventDefault();
      };
      el.addEventListener('pointerdown', onDown);
      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerup', onUp);
      el.addEventListener('pointercancel', onUp);
      el.addEventListener('click', onClick);
      return () => {
        el.removeEventListener('pointerdown', onDown);
        el.removeEventListener('pointermove', onMove);
        el.removeEventListener('pointerup', onUp);
        el.removeEventListener('pointercancel', onUp);
        el.removeEventListener('click', onClick);
      };
    }, [sliderId, min, max, step, id]);

    return (
      <div
        id={sliderId}
        className="weight-slider"
      >
        <div className="weight-slider__header">
          <label className="field-label" htmlFor={`${id}-display`}>
            {label}
          </label>
          <span className="weight-slider__value" aria-live="polite">
            {value.toFixed(2)}
          </span>
        </div>
        <div
          className="weight-slider__track"
          role="slider"
          aria-label={label}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={Number(value.toFixed(2))}
          tabIndex={0}
        >
          <div className="weight-slider__fill" style={{ width: `${pct}%` }} />
          <div
            className="weight-slider__thumb"
            style={{ left: `calc(${pct}% - 7px)` }}
          />
        </div>
        <div className="weight-slider__scale" aria-hidden="true">
          <span>0</span>
          <span>1</span>
          <span>2</span>
          <span>3</span>
          <span>4</span>
          <span>5</span>
        </div>
      </div>
    );
  }

  function renderResultRows(results: ComparisonResult[]) {
    if (results.length === 0) {
      return (
        <tr>
          <td colSpan={8} style={{ textAlign: 'center', color: 'var(--ink-soft)' }}>
            Sem resultados registrados.
          </td>
        </tr>
      );
    }
    return results.map((r, idx) => (
      <tr key={`${r.quoteResponseId ?? r.supplierId}-${idx}`}>
        <td>{idx + 1}</td>
        <td>
          <strong>{r.supplier?.name ?? `Fornecedor #${r.supplierId}`}</strong>
        </td>
        <td>{formatNumber(r.offeredPrice)}</td>
        <td><span className="badge">{r.offeredIncoterm}</span></td>
        <td>{r.paymentTermsDays} dias</td>
        <td>
          <div>{formatCurrency(r.totalLandedCost, 'BRL')}</div>
          <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
            CIF: {formatCurrency(r.cifValue, 'BRL')}
          </div>
        </td>
        <td>
          <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
            Preço {formatNumber(r.priceScore, 2)} · Pagto {formatNumber(r.paymentTermsScore, 2)} ·
            Inc {formatNumber(r.incotermScore, 2)}
          </div>
          <strong>{formatNumber(r.totalScore, 2)}</strong>
        </td>
        <td>
          {r.isWinner
            ? <span className="badge">Vencedora</span>
            : <span className="badge badge--muted">—</span>}
        </td>
      </tr>
    ));
  }

  const records = history.data?.comparisons ?? [];
  const latest = records[0];

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <p className="eyebrow">Compras</p>
          <h1>Comparações</h1>
          <p>Execute a comparação entre respostas de uma cotação aberta e consulte o histórico auditável.</p>
        </div>
      </div>

      {feedback && (
        <p style={{
          color: feedback.kind === 'err' ? 'var(--danger)' : 'var(--primary-700)',
          fontSize: 13,
          marginBottom: 8,
        }}>
          {feedback.text}
        </p>
      )}

      <section className="card">
        <div className="form-grid" style={{ marginBottom: 12 }}>
          <div>
            <label className="field-label" htmlFor="comparison-quote">Cotação</label>
            <select
              id="comparison-quote"
              className="select"
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
            >
              <option value="">Selecione uma cotação…</option>
              {(quoteRequests.data ?? []).map((q) => (
                <option key={q.id} value={q.id}>
                  {q.requestCode} · {q.productName} {q.status === 'closed' ? '(fechada)' : ''}
                </option>
              ))}
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button
              type="button"
              className="primary-button"
              onClick={() => runMut.mutate()}
              disabled={!canExecute || runMut.isPending}
              title={
                !selectedQuote
                  ? 'Selecione uma cotação.'
                  : !canCompare
                    ? 'Seu perfil não tem permissão para executar comparações.'
                    : selectedQuote.status !== 'open'
                      ? 'A cotação precisa estar aberta.'
                      : ''
              }
            >
              {runMut.isPending ? 'Executando…' : 'Executar comparação'}
            </button>
          </div>
        </div>

        <div className="form-grid weight-grid">
          <WeightSlider
            id="weight-price"
            label="Peso · Preço"
            value={priceWeight}
          />
          <WeightSlider
            id="weight-payment"
            label="Peso · Pagamento"
            value={paymentWeight}
          />
          <WeightSlider
            id="weight-incoterm"
            label="Peso · Incoterm"
            value={incotermWeight}
          />
        </div>

        {!canCompare && (
          <p style={{ color: 'var(--warning)', fontSize: 12, marginTop: 12 }}>
            Seu perfil não tem permissão para executar comparações.
          </p>
        )}
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <div className="page-header" style={{ marginBottom: 8 }}>
          <h2>Última comparação</h2>
          {selectedQuote && (
            <span className={`badge${selectedQuote.status === 'closed' ? ' badge--muted' : ''}`}>
              {selectedQuote.status === 'open' ? 'Aberta' : 'Fechada'}
            </span>
          )}
        </div>
        {!selectedId && (
          <div className="empty-state">
            <p>Selecione uma cotação para visualizar a comparação.</p>
          </div>
        )}
        {selectedId && history.isLoading && <p>Carregando comparações…</p>}
        {selectedId && history.isError && (
          <div className="empty-state">
            <p>Não foi possível carregar o histórico de comparações.</p>
          </div>
        )}
        {selectedId && history.data && !latest && (
          <div className="empty-state">
            <strong>Esta cotação ainda não foi comparada.</strong>
            <p>Use o botão “Executar comparação” para calcular os scores e definir a vencedora.</p>
          </div>
        )}
        {latest && (
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>Fornecedor</th>
                <th>Preço</th>
                <th>Incoterm</th>
                <th>Pagto</th>
                <th>Landed (BRL)</th>
                <th>Scores</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>{renderResultRows(latest.results)}</tbody>
          </table>
        )}
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <div className="page-header" style={{ marginBottom: 8 }}>
          <h2>Histórico de comparações</h2>
        </div>
        {selectedId && history.isLoading && <p>Carregando histórico…</p>}
        {selectedId && history.isError && (
          <div className="empty-state">
            <p>Não foi possível carregar o histórico desta cotação.</p>
          </div>
        )}
        {selectedId && records.length === 0 && !history.isLoading && !history.isError && (
          <div className="empty-state">
            <strong>Sem histórico</strong>
            <p>Quando comparações forem executadas, o histórico aparecerá aqui.</p>
          </div>
        )}
        {records.map((rec: ComparisonRecord) => {
          const winner = rec.results.find((r) => r.isWinner);
          const isOpen = expandedHistory.has(rec.id);
          return (
            <article
              key={rec.id}
              className="card"
              style={{
                marginBottom: 12,
                background: 'var(--surface-alt)',
                borderStyle: 'dashed',
              }}
            >
              <div className="page-header" style={{ marginBottom: 8 }}>
                <div>
                  <p className="eyebrow">Comparação #{rec.id}</p>
                  <h3>{formatDateTime(rec.createdAt)}</h3>
                  <p style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
                    Executada por {rec.executedBy?.name ?? 'Sistema'}.
                  </p>
                </div>
                <div className="page-header__actions">
                  <span className="chip">Preço {formatNumber(rec.priceWeight, 2)}</span>
                  <span className="chip">Pagto {formatNumber(rec.paymentTermsWeight, 2)}</span>
                  <span className="chip">Inc {formatNumber(rec.incotermWeight, 2)}</span>
                  <span className="chip">{rec.results.length} propostas</span>
                  {winner
                    ? <span className="badge">{`Vencedora: ${winner.supplier?.name ?? `Fornecedor #${winner.supplierId}`}`}</span>
                    : <span className="badge badge--muted">Sem vencedora</span>}
                </div>
              </div>
              <button
                type="button"
                className="ghost-button"
                onClick={() => toggleExpanded(rec.id)}
              >
                {isOpen ? 'Ocultar detalhes' : 'Ver detalhes'}
              </button>
              {isOpen && (
                <div style={{ marginTop: 12 }}>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Fornecedor</th>
                        <th>Preço</th>
                        <th>Incoterm</th>
                        <th>Pagto</th>
                        <th>Landed (BRL)</th>
                        <th>Scores</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>{renderResultRows(rec.results)}</tbody>
                  </table>
                </div>
              )}
            </article>
          );
        })}
      </section>
    </div>
  );
}