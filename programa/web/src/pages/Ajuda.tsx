import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  HELP_CATEGORIES,
  listHelpArticles,
  messageOf,
  type HelpArticle,
  type HelpCategory,
  type HelpFilters,
} from '@/services/help';

interface FiltersState {
  search: string;
  category: HelpCategory | 'all';
}

const initialFilters: FiltersState = {
  search: '',
  category: 'all',
};

const SUMMARY_MAX = 150;

function summarize(content: string): string {
  const trimmed = content.trim();
  if (trimmed.length <= SUMMARY_MAX) return trimmed;
  return `${trimmed.slice(0, SUMMARY_MAX).trimEnd()}…`;
}

function categoryLabel(value: HelpCategory): string {
  const found = HELP_CATEGORIES.find((c) => c.value === value);
  return found?.label ?? value;
}

export default function Ajuda() {
  const [filters, setFilters] = useState<FiltersState>(initialFilters);
  const [submitted, setSubmitted] = useState<FiltersState>(initialFilters);
  const [activeArticle, setActiveArticle] = useState<HelpArticle | null>(null);

  const activeFilters: HelpFilters = useMemo(() => {
    const result: HelpFilters = {};
    if (submitted.search.trim()) result.search = submitted.search.trim();
    if (submitted.category !== 'all') result.category = submitted.category;
    return result;
  }, [submitted]);

  const articles = useQuery({
    queryKey: ['help', 'articles', activeFilters],
    queryFn: () => listHelpArticles(activeFilters),
  });

  const list: HelpArticle[] = articles.data ?? [];

  useEffect(() => {
    if (!activeArticle) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActiveArticle(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeArticle]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted({ ...filters });
  }

  function handleReset() {
    setFilters(initialFilters);
    setSubmitted(initialFilters);
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <p className="eyebrow">Suporte</p>
          <h1>Central de Ajuda</h1>
          <p>Artigos e tutoriais do IntelliQuote.</p>
        </div>
      </div>

      <section className="card">
        <form
          onSubmit={handleSubmit}
          className="form-grid"
          style={{ alignItems: 'flex-end' }}
        >
          <div className="form-grid__full">
            <label className="field-label" htmlFor="help-search">Buscar</label>
            <input
              id="help-search"
              className="input"
              type="text"
              value={filters.search}
              onChange={(e) => setFilters({ ...filters, search: e.target.value })}
              placeholder="Palavras-chave do artigo"
            />
          </div>
          <div className="form-grid__full">
            <label className="field-label" htmlFor="help-category">Categoria</label>
            <select
              id="help-category"
              className="select"
              value={filters.category}
              onChange={(e) => setFilters({ ...filters, category: e.target.value as FiltersState['category'] })}
            >
              <option value="all">Todas</option>
              {HELP_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" className="primary-button">Buscar</button>
            <button type="button" className="ghost-button" onClick={handleReset}>Limpar</button>
          </div>
        </form>
      </section>

      <section className="card">
        <div className="page-header" style={{ marginBottom: 8 }}>
          <h2>Artigos</h2>
          {list.length > 0 && <span className="chip">{list.length} resultados</span>}
        </div>
        {articles.isLoading && <p>Carregando artigos…</p>}
        {articles.isError && (
          <div className="empty-state">
            <p>{messageOf(articles.error)}</p>
          </div>
        )}
        {articles.data && list.length === 0 && !articles.isLoading && (
          <div className="empty-state">
            <strong>Sem artigos</strong>
            <p>Nenhum artigo corresponde à busca aplicada.</p>
          </div>
        )}
        {list.length > 0 && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
              gap: 12,
            }}
          >
            {list.map((article) => (
              <button
                key={article.id}
                type="button"
                className="help-card"
                onClick={() => setActiveArticle(article)}
                style={{
                  textAlign: 'left',
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                  padding: 16,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  cursor: 'pointer',
                  font: 'inherit',
                  color: 'var(--ink)',
                  boxShadow: 'var(--shadow-sm)',
                  transition: 'transform 0.12s, box-shadow 0.12s',
                }}
              >
                <span
                  className="chip"
                  style={{ alignSelf: 'flex-start', background: 'var(--primary-50)', color: 'var(--primary-700)', borderColor: 'var(--primary)' }}
                >
                  {categoryLabel(article.category)}
                </span>
                <strong style={{ fontSize: 15, color: 'var(--ink)' }}>{article.title}</strong>
                <span style={{ fontSize: 13, color: 'var(--ink-soft)' }}>
                  {summarize(article.content)}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      {activeArticle && (
        <ArticleModal
          article={activeArticle}
          onClose={() => setActiveArticle(null)}
        />
      )}
    </div>
  );
}

function ArticleModal({
  article,
  onClose,
}: {
  article: HelpArticle;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <article
        className="modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-modal-title"
      >
        <span
          className="chip"
          style={{ alignSelf: 'flex-start', background: 'var(--primary-50)', color: 'var(--primary-700)', borderColor: 'var(--primary)' }}
        >
          {categoryLabel(article.category)}
        </span>
        <h2 id="help-modal-title">{article.title}</h2>
        <div
          style={{
            whiteSpace: 'pre-wrap',
            color: 'var(--ink)',
            lineHeight: 1.55,
            fontSize: 14,
          }}
        >
          {article.content}
        </div>
        <div className="modal__actions">
          <button type="button" className="ghost-button" onClick={onClose}>
            Fechar
          </button>
        </div>
      </article>
    </div>
  );
}