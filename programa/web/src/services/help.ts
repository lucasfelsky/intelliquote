// Helpers e tipos para a Central de Ajuda.
// Os artigos podem ser filtrados por categoria e/ou por uma busca textual
// aproximada. O backend devolve o conteúdo já pronto para exibição.

import { api } from '@/api/client';

export type HelpCategory =
  | 'general'
  | 'fornecedor'
  | 'cotacao'
  | 'proposta'
  | 'comparacao'
  | 'auditoria'
  | 'usuarios'
  | 'anexos'
  | 'relatorios'
  | 'onboarding';

export interface HelpArticle {
  id: number;
  category: HelpCategory;
  title: string;
  content: string;
  displayOrder: number;
}

export interface HelpFilters {
  search?: string | null;
  category?: HelpCategory | null;
}

export const HELP_CATEGORIES: readonly { value: HelpCategory; label: string }[] = [
  { value: 'general', label: 'Geral' },
  { value: 'fornecedor', label: 'Fornecedor' },
  { value: 'cotacao', label: 'Cotação' },
  { value: 'proposta', label: 'Proposta' },
  { value: 'comparacao', label: 'Comparação' },
  { value: 'auditoria', label: 'Auditoria' },
  { value: 'usuarios', label: 'Usuários' },
  { value: 'anexos', label: 'Anexos' },
  { value: 'relatorios', label: 'Relatórios' },
  { value: 'onboarding', label: 'Onboarding' },
];

export async function listHelpArticles(filters: HelpFilters = {}): Promise<HelpArticle[]> {
  const query: Record<string, string | undefined> = {};
  if (filters.search) query.search = filters.search;
  if (filters.category) query.category = filters.category;
  const data = await api.get<HelpArticle[]>('/v1/help/articles', query);
  return Array.isArray(data) ? data : [];
}

export { messageOf } from '@/services/quoteResponses';