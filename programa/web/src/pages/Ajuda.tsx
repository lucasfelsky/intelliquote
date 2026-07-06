import { useEffect, useMemo, useState } from 'react';
import {
  FAQ_BY_CATEGORY,
  HELP_CATEGORIES,
  type HelpCategory,
} from '@/services/help';

type CategoryFilter = HelpCategory | 'all';

const DEFAULT_CATEGORY: CategoryFilter = 'all';

export default function Ajuda() {
  // Apenas a secao de perguntas frequentes permanece visivel. As demais
  // secoes (cards de artigos longos e grade de atalhos rapidos) foram
  // removidas por serem consideradas ruido na central de ajuda.
  const [category, setCategory] = useState<CategoryFilter>(DEFAULT_CATEGORY);
  const [search, setSearch] = useState('');

  // Por padrao mantemos todas as categorias expandidas para que o usuario
  // visualize rapidamente o conteudo sem precisar clicar em cada secao.
  const [expanded, setExpanded] = useState<Record<HelpCategory, boolean>>(() => {
    const initial = {} as Record<HelpCategory, boolean>;
    for (const c of HELP_CATEGORIES) initial[c.value] = true;
    return initial;
  });

  const filteredFaq = useMemo(() => {
    const term = search.trim().toLowerCase();
    return FAQ_BY_CATEGORY.filter((group) => {
      if (category !== 'all' && group.category !== category) {
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
  }, [category, search]);

  const totalAnswers = useMemo(
    () => filteredFaq.reduce((acc, g) => acc + g.questions.length, 0),
    [filteredFaq],
  );

  function toggleGroup(group: HelpCategory) {
    setExpanded((current) => ({ ...current, [group]: !current[group] }));
  }

  function handleReset() {
    setCategory(DEFAULT_CATEGORY);
    setSearch('');
  }

  useEffect(() => {
    // Quando o filtro muda, expandimos todas as categorias visiveis para
    // que o conteudo ja apareca sem interacao extra.
    if (filteredFaq.length === 0) return;
    setExpanded((current) => {
      const next = { ...current };
      for (const group of filteredFaq) next[group.category] = true;
      return next;
    });
  }, [filteredFaq]);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <p className="eyebrow">Suporte</p>
          <h1>Central de Ajuda</h1>
          <p>
            Perguntas frequentes sobre cadastro, cotação, fornecedores e Portal.
          </p>
        </div>
      </div>

      <section className="card">
        <form
          onSubmit={(e) => e.preventDefault()}
          className="form-grid"
          style={{ alignItems: 'flex-end' }}
        >
          <div className="form-grid__full">
            <label className="field-label" htmlFor="help-search">
              Buscar
            </label>
            <input
              id="help-search"
              className="input"
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Palavras-chave da pergunta"
            />
          </div>
          <div className="form-grid__full">
            <label className="field-label" htmlFor="help-category">
              Categoria
            </label>
            <select
              id="help-category"
              className="select"
              value={category}
              onChange={(e) => setCategory(e.target.value as CategoryFilter)}
            >
              <option value="all">Todas</option>
              {HELP_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          {(category !== DEFAULT_CATEGORY || search) && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className="ghost-button"
                onClick={handleReset}
              >
                Limpar
              </button>
            </div>
          )}
        </form>
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <div className="page-header" style={{ marginBottom: 8 }}>
          <h2>Perguntas frequentes</h2>
          {totalAnswers > 0 && (
            <span className="chip chip--static">{totalAnswers} respostas</span>
          )}
        </div>
        {filteredFaq.length === 0 ? (
          <div className="empty-state">
            <strong>Nenhuma pergunta encontrada</strong>
            <p>
              Ajuste os filtros acima ou use palavras-chave diferentes para
              refinar a busca.
            </p>
          </div>
        ) : (
          filteredFaq.map((group) => {
            const isOpen = expanded[group.category];
            return (
              <div key={group.category} style={{ marginBottom: 16 }}>
                <button
                  type="button"
                  onClick={() => toggleGroup(group.category)}
                  aria-expanded={isOpen}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    width: '100%',
                    background: 'transparent',
                    border: 'none',
                    padding: '8px 0',
                    cursor: 'pointer',
                    color: 'var(--primary-700)',
                    fontSize: 14,
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: 1.4,
                    font: 'inherit',
                  }}
                >
                  <span>{group.label}</span>
                  <span aria-hidden style={{ fontSize: 18, lineHeight: 1 }}>
                    {isOpen ? '−' : '+'}
                  </span>
                </button>
                {isOpen && (
                  <div style={{ marginTop: 4 }}>
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
                )}
              </div>
            );
          })
        )}
      </section>
    </div>
  );
}
