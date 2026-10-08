import { useCallback, useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useQueries, useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import type {
  PickerCatalogItem,
  PickerFamilyItemsEntry,
  PickerFamilySummary,
} from '@/components/CatalogItemPicker';

function parseCatalogItemRecord(c: Record<string, unknown>): PickerCatalogItem {
  return {
    id: Number(c.id),
    commercialName: String(c.commercialName ?? ''),
    marketName: String(c.marketName ?? ''),
    family: c.family
      ? { id: Number((c.family as Record<string, unknown>).id), name: String((c.family as Record<string, unknown>).name) }
      : null,
  };
}

function parseCatalogItemList(data: unknown): PickerCatalogItem[] {
  const list = Array.isArray((data as { data?: unknown[] })?.data)
    ? (data as { data: unknown[] }).data
    : Array.isArray(data)
      ? data
      : [];
  return (list as Array<Record<string, unknown>>).map(parseCatalogItemRecord);
}

function parsePaginatedCatalogItems(data: unknown): { items: PickerCatalogItem[]; totalItems: number } {
  const items = parseCatalogItemList(data);
  const totalItems = Number(
    (data as { pagination?: { totalItems?: number } })?.pagination?.totalItems ?? items.length,
  );
  return { items, totalItems };
}

export interface CatalogItemPickerData {
  families: PickerFamilySummary[];
  familyItems: Map<number, PickerFamilyItemsEntry>;
  expanded: Set<number>;
  toggleFamily: (id: number) => void;
  isSearching: boolean;
  searchItems: PickerCatalogItem[];
  search: string;
  setSearch: (value: string) => void;
  reset: () => void;
}

/**
 * Dados do CatalogItemPicker (busca server-side debounced, famílias em pastas
 * e itens lazy por família). Compartilhado entre Nova cotação e Detalhe.
 */
export function useCatalogItemPickerData(enabled: boolean): CatalogItemPickerData {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  // Debounce ~300ms pra busca server-side do catálogo, mesmo padrão do ComparacaoTab.
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const isSearching = debouncedSearch.trim().length > 0;

  // MODO NAVEGAR: todas as famílias ativas viram pastas (fechadas por padrão).
  const familiesQuery = useQuery({
    queryKey: ['item-families'],
    queryFn: async () => {
      const data = await api.get<unknown>('/v1/item-families');
      const list = Array.isArray((data as { data?: unknown[] })?.data)
        ? (data as { data: unknown[] }).data
        : [];
      return (list as Array<Record<string, unknown>>).map((f) => ({
        id: Number(f.id),
        name: String(f.name ?? ''),
      })) as PickerFamilySummary[];
    },
    enabled,
    staleTime: 5 * 60 * 1000,
  });

  // MODO BUSCA: busca global server-side (casa nome/ncm/dbcorpCode/família).
  const searchQuery = useQuery({
    queryKey: ['catalog-items-search', debouncedSearch],
    queryFn: async () => {
      const data = await api.get<unknown>('/v1/catalog-items', {
        search: debouncedSearch,
        pageSize: '100',
      });
      return parseCatalogItemList(data);
    },
    enabled: enabled && isSearching,
    placeholderData: keepPreviousData,
  });

  // Lazy por família: uma query por id expandido, só em MODO NAVEGAR.
  const familyIds = useMemo(() => Array.from(expanded), [expanded]);
  const familyItemQueries = useQueries({
    queries: familyIds.map((id) => ({
      queryKey: ['catalog-items-family', id],
      queryFn: async () => {
        const data = await api.get<unknown>('/v1/catalog-items', {
          family: String(id),
          pageSize: '100',
        });
        return parsePaginatedCatalogItems(data);
      },
      enabled: enabled && !isSearching,
      staleTime: 5 * 60 * 1000,
    })),
  });

  const familyItems = useMemo(() => {
    const map = new Map<number, PickerFamilyItemsEntry>();
    familyIds.forEach((id, idx) => {
      const q = familyItemQueries[idx];
      if (!q) return;
      map.set(id, {
        items: q.data?.items ?? [],
        isLoading: q.isLoading,
        total: q.data?.totalItems ?? 0,
      });
    });
    return map;
  }, [familyIds, familyItemQueries]);

  const toggleFamily = useCallback((id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setSearch('');
    setDebouncedSearch('');
    setExpanded(new Set());
  }, []);

  return {
    families: familiesQuery.data ?? [],
    familyItems,
    expanded,
    toggleFamily,
    isSearching,
    searchItems: searchQuery.data ?? [],
    search,
    setSearch,
    reset,
  };
}
