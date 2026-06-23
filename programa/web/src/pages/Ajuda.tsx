import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  FAQ_BY_CATEGORY,
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

  // FAQ estatico da aplicacao (respostas rapidas por categoria). A lista
  // renderizada abaixo do grid de artigos ajuda usuarios que preferem
  // resolucoes instantaneas em vez de abrir artigos longos.
  const filteredFaq = useMemo(() => {
    const term = submitted.search.trim().toLowerCase();
    return FAQ_BY_CATEGORY
      .filter((group) => {
        if (submitted.category !== 'all' && group.category !== submitted.category) {
          return false;
        }
        if (!term) return true;
        if (group.label.toLowerCase().includes(term)) return true;
        return group.questions.some(
          (q) =>
            q.question.toLowerCase().includes(term) ||
            q.answer.toLowerCase().includes(term),
        );
      })
      .map((group) => ({
        ...group,
        questions: term
          ? group.questions.filter(
              (q) =>
                q.question.toLowerCase().includes(term) ||
                q.answer.toLowerCase().includes(term),
            )
          : group.questions,
      }))
      .filter((group) => group.questions.length > 0);
  }, [submitted]);

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
          <p>Artigos, tutoriais e respostas rápidas para o dia a dia no IntelliQuote.</p>
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
              placeholder="Palavras-chave do artigo ou pergunta do FAQ"
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
            <p>Nenhum artigo corresponde à busca aplicada. Tente o FAQ abaixo para respostas rápidas.</p>
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

      <section className="card" style={{ marginTop: 16 }}>
        <div className="page-header" style={{ marginBottom: 8 }}>
          <h2>Perguntas frequentes</h2>
          {filteredFaq.length > 0 && (
            <span className="chip">
              {filteredFaq.reduce((acc, g) => acc + g.questions.length, 0)} respostas
            </span>
          )}
        </div>
        {filteredFaq.length === 0 ? (
          <p style={{ color: 'var(--ink-soft)', fontSize: 13 }}>
            Nenhuma pergunta frequente corresponde à busca. Ajuste os filtros ou consulte os artigos acima.
          </p>
        ) : (
          filteredFaq.map((group) => (
            <div key={group.category} style={{ marginBottom: 16 }}>
              <h3
                style={{
                  fontSize: 14,
                  textTransform: 'uppercase',
                  letterSpacing: 1.4,
                  color: 'var(--primary-700)',
                  margin: '8px 0',
                }}
              >
                {group.label}
              </h3>
              {group.questions.map((q) => (
                <details
                  key={q.question}
                  style={{
                    borderTop: '1px solid var(--border)',
                    padding: '8px 0',
                  }}
                >
                  <summary
                    style={{
                      cursor: 'pointer',
                      fontWeight: 600,
                      color: 'var(--ink)',
                      fontSize: 14,
                      padding: '4px 0',
                    }}
                  >
                    {q.question}
                  </summary>
                  <p
                    style={{
                      margin: '8px 0 0 0',
                      color: 'var(--ink-soft)',
                      fontSize: 14,
                      lineHeight: 1.55,
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    {q.answer}
                  </p>
                </details>
              ))}
            </div>
          ))
        )}
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <h2>Atalhos rápidos</h2>
        <p style={{ color: 'var(--ink-soft)', fontSize: 13, marginTop: 4 }}>
          Onde encontrar cada funcionalidade no menu lateral.
        </p>
        <ul
          style={{
            listStyle: 'none',
            padding: 0,
            margin: '12px 0 0 0',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: 10,
          }}
        >
          {HELP_CATEGORIES.map((c) => (
            <li
              key={c.value}
              style={{
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: '10px 12px',
                background: 'var(--surface-muted, #f7fafc)',
                fontSize: 13,
                color: 'var(--ink)',
              }}
            >
              <strong>{c.label}</strong>
              <p
                style={{
                  margin: '4px 0 0 0',
                  color: 'var(--ink-soft)',
                  fontSize: 12,
                }}
              >
                {quickHint(c.value)}
              </p>
            </li>
          ))}
        </ul>
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

function quickHint(category: HelpCategory): string {
  switch (category) {
    case 'general':
      return 'Visão geral do sistema, login e senhas.';
    case 'onboarding':
      return 'Passo a passo dos primeiros cadastros.';
    case 'fornecedor':
      return 'Cadastro de fornecedores e contatos.';
    case 'cotacao':
      return 'Criação, edição e itens da cotação.';
    case 'proposta':
      return 'Respostas do fornecedor pelo portal.';
    case 'comparacao':
      return 'Ranking de propostas e custo landed.';
    case 'auditoria':
      return 'Histórico de alterações do sistema.';
    case 'usuarios':
      return 'Gestão de usuários e perfis de acesso.';
    case 'anexos':
      return 'Envio de PDFs e imagens com a cotação.';
    case 'relatorios':
      return 'Métricas e KPIs consolidados.';
    case 'empresa':
      return 'Perfil da empresa e cópia automática (CC).';
    case 'portal':
      return 'Acesso do fornecedor por link mágico.';
    default:
      return '';
  }
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