import { useEffect, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';

// "Visto" por usuario: abrir o detalhe da cotacao registra lastSeenAt (POST /quote-requests/:id/seen);
// a lista usa isso para destacar "Nova resposta". Melhor esforco: falha nao interrompe a tela.

export interface QuoteRequestSeenResult {
  quoteRequestId: number;
  lastSeenAt: string;
}

export async function markQuoteRequestSeen(quoteRequestId: number): Promise<QuoteRequestSeenResult> {
  return api.post<QuoteRequestSeenResult>(`/v1/quote-requests/${quoteRequestId}/seen`, {});
}

/** Marca como vista uma vez por id montado (quando `enabled`) e invalida a lista no sucesso. */
export function useMarkQuoteRequestSeen(quoteRequestId: number, enabled: boolean) {
  const queryClient = useQueryClient();
  const lastMarkedId = useRef<number | null>(null);
  const { mutate } = useMutation({
    mutationFn: (id: number) => markQuoteRequestSeen(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['quote-requests'] }),
  });

  useEffect(() => {
    if (!enabled || !Number.isFinite(quoteRequestId) || lastMarkedId.current === quoteRequestId) return;
    lastMarkedId.current = quoteRequestId;
    mutate(quoteRequestId);
  }, [enabled, quoteRequestId, mutate]);
}
