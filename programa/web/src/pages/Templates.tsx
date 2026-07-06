import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listEmailTemplates,
  previewEmailTemplate,
  resetEmailTemplate,
  saveEmailTemplate,
} from '@/services/emailTemplates';
import type { EmailTemplate, EmailTemplateDraft } from '@/services/templates';
import { useAuth } from '@/auth/AuthProvider';

const LOCALE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'en', label: 'en (ingles)' },
  { value: 'pt-BR', label: 'pt-BR' },
  { value: 'es', label: 'es' },
];

const VARIABLE_CHIPS: Record<string, string[]> = {
  quote_dispatch: [
    '{{subject}}', '{{requestCode}}', '{{productName}}', '{{quantity}}', '{{unit}}',
    '{{desiredIncoterm}}', '{{currency}}', '{{deadlineAt}}', '{{expiresAt}}',
    '{{portalLink}}', '{{companyName}}', '{{tradeName}}', '{{taxId}}',
    '{{purchasingEmail}}', '{{supplierContactName}}', '{{itemsRows}}', '{{itemsText}}',
  ],
  quote_reply: [
    '{{subject}}', '{{quoteRequestId}}', '{{requestCode}}', '{{productName}}',
    '{{supplierName}}', '{{itemsRows}}', '{{itemsText}}',
  ],
};

const TEMPLATE_LABELS: Record<string, string> = {
  quote_dispatch: 'Envio de cotação para fornecedores',
  quote_reply: 'Resposta ao fornecedor (botão Responder)',
};

function templateLabel(key: string): string {
  return TEMPLATE_LABELS[key] ?? key.replace(/_/g, ' ');
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export default function Templates() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const qc = useQueryClient();

  const templatesQuery = useQuery({
    queryKey: ['email-templates-all'],
    queryFn: () => listEmailTemplates(),
  });

  const availableKeys = useMemo(() => {
    // Une as keys ja salvas no banco com as keys conhecidas (TEMPLATE_LABELS),
    // pra templates ainda nao customizados (ex.: quote_reply recem-criado)
    // aparecerem no seletor mesmo sem linha no banco ainda — o primeiro
    // "Salvar template" cria a linha via upsert.
    const set = new Set<string>([...Object.keys(TEMPLATE_LABELS)]);
    (templatesQuery.data ?? []).forEach((t) => set.add(t.key));
    return Array.from(set).sort();
  }, [templatesQuery.data]);

  const availableLocales = useMemo(() => {
    const set = new Set<string>();
    (templatesQuery.data ?? []).forEach((t) => set.add(t.locale));
    const list = Array.from(set).sort();
    return list.length > 0 ? list : LOCALE_OPTIONS.map((l) => l.value);
  }, [templatesQuery.data]);

  const [selectedKey, setSelectedKey] = useState<string>('');
  const [locale, setLocale] = useState<string>('en');
  const [draft, setDraft] = useState<EmailTemplateDraft | null>(null);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  useEffect(() => {
    if (!selectedKey && availableKeys.length > 0) {
      setSelectedKey(availableKeys[0] ?? '');
    }
  }, [availableKeys, selectedKey]);

  const current = useMemo<EmailTemplate | null>(() => {
    if (!selectedKey) return null;
    return templatesQuery.data?.find((t) => t.key === selectedKey && t.locale === locale) ?? null;
  }, [templatesQuery.data, selectedKey, locale]);

  const preview = useQuery({
    queryKey: ['email-templates-preview', selectedKey, locale],
    queryFn: () => previewEmailTemplate(selectedKey, locale),
    enabled: Boolean(selectedKey),
  });

  useEffect(() => {
    if (current) {
      setDraft({
        subject: current.subject,
        htmlBody: current.htmlBody,
        textBody: current.textBody,
        isActive: current.isActive,
      });
    } else if (preview.data && preview.data.source === 'fallback' && preview.data.html) {
      // Sem customização salva ainda: pré-popula o editor com o template
      // padrão (renderizado pelo /preview) em vez de deixar em branco, pra
      // o admin ter um ponto de partida real em vez de começar do zero.
      setDraft({
        subject: preview.data.subject,
        htmlBody: preview.data.html,
        textBody: preview.data.text,
        isActive: true,
      });
    } else if (!current) {
      setDraft({ subject: '', htmlBody: '', textBody: '', isActive: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, preview.data]);

  const save = useMutation({
    mutationFn: (payload: EmailTemplateDraft) => saveEmailTemplate(selectedKey, locale, payload),
    onSuccess: () => {
      setFeedback({ kind: 'ok', msg: 'Template salvo com sucesso.' });
      qc.invalidateQueries({ queryKey: ['email-templates-all'] });
      qc.invalidateQueries({ queryKey: ['email-templates-preview', selectedKey, locale] });
    },
    onError: (err) => setFeedback({ kind: 'err', msg: messageOf(err) }),
  });

  const reset = useMutation({
    mutationFn: () => resetEmailTemplate(selectedKey, locale),
    onSuccess: () => {
      setFeedback({ kind: 'ok', msg: 'Template restaurado para o padrão.' });
      qc.invalidateQueries({ queryKey: ['email-templates-all'] });
      qc.invalidateQueries({ queryKey: ['email-templates-preview', selectedKey, locale] });
    },
    onError: (err) => setFeedback({ kind: 'err', msg: messageOf(err) }),
  });

  function setField<K extends keyof EmailTemplateDraft>(key: K, value: EmailTemplateDraft[K]) {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  function insertChip(chip: string) {
    setDraft((prev) => (prev ? { ...prev, htmlBody: `${prev.htmlBody}${chip}` } : prev));
  }

  return (
    <div className="page page--templates">
      <header className="page__header">
        <div>
          <h1>Templates de e-mail</h1>
          <p className="page__subtitle">
            Selecione abaixo qual template você deseja editar. Cada template pode ter
            versões em vários idiomas.
          </p>
        </div>
      </header>

      <section className="card">
        <div className="template-picker">
          <label className="field field--inline">
            <span>Template</span>
            <select
              value={selectedKey}
              onChange={(e) => setSelectedKey(e.target.value)}
              disabled={templatesQuery.isLoading || availableKeys.length === 0}
            >
              {templatesQuery.isLoading && <option value="">Carregando…</option>}
              {!templatesQuery.isLoading && availableKeys.length === 0 && (
                <option value="">Nenhum template cadastrado</option>
              )}
              {availableKeys.map((k) => (
                <option key={k} value={k}>
                  {templateLabel(k)} ({k})
                </option>
              ))}
            </select>
          </label>

          <label className="field field--inline">
            <span>Idioma</span>
            <select value={locale} onChange={(e) => setLocale(e.target.value)}>
              {availableLocales.map((loc) => (
                <option key={loc} value={loc}>
                  {loc}
                </option>
              ))}
            </select>
          </label>

          <div className="template-picker__actions">
            <button
              type="button"
                          className="ghost-button"
              onClick={() => reset.mutate()}
              disabled={!isAdmin || reset.isPending || !current}
            >
              {reset.isPending ? 'Restaurando…' : 'Restaurar padrão'}
            </button>
            <button
              type="button"
                          className="primary-button"
              onClick={() => draft && save.mutate(draft)}
              disabled={!isAdmin || !draft || save.isPending || !selectedKey}
            >
              {save.isPending ? 'Salvando…' : 'Salvar template'}
            </button>
          </div>
        </div>
      </section>

      {!isAdmin && (
        <p className="banner banner--warning">
          Somente administradores podem salvar alterações. Você pode visualizar livremente.
        </p>
      )}

      {feedback && (
        <p
          className={`banner ${feedback.kind === 'ok' ? 'banner--ok' : 'banner--error'}`}
          role="status"
        >
          {feedback.msg}
        </p>
      )}

      {selectedKey && (
        <section className="card">
          <h2>Informações do template</h2>
          <p className="muted">
            Editando <strong>{templateLabel(selectedKey)}</strong> ({selectedKey}) ·
            idioma <strong>{locale}</strong>
          </p>
          <dl className="meta-grid">
            <div>
              <dt>Identificador</dt>
              <dd><code>{selectedKey}</code></dd>
            </div>
            <div>
              <dt>Origem</dt>
              <dd>{preview.data?.source === 'database' ? 'Banco de dados' : 'Arquivo padrão'}</dd>
            </div>
            <div>
              <dt>Atualizado em</dt>
              <dd>{current ? new Date(current.updatedAt).toLocaleString('pt-BR') : '—'}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{preview.data?.isActive ? 'Ativo' : 'Inativo'}</dd>
            </div>
          </dl>
        </section>
      )}

      {selectedKey && (
        <section className="card">
          <h2>Variáveis disponíveis</h2>
          <p className="muted">Clique em uma variável para inseri-la no HTML.</p>
          <div className="chip-list">
            {(VARIABLE_CHIPS[selectedKey] ?? []).map((chip) => (
              <button
                type="button"
                key={chip}
                className="chip"
                onClick={() => insertChip(chip)}
              >
                {chip}
              </button>
            ))}
          </div>
        </section>
      )}

      {draft && selectedKey && (
        <section className="card">
          <h2>Conteúdo</h2>
          <label className="field">
            <span>Assunto</span>
            <input
              type="text"
              value={draft.subject}
              onChange={(e) => setField('subject', e.target.value)}
              disabled={!isAdmin}
            />
          </label>
          <label className="field">
            <span>HTML do e-mail</span>
            <textarea
              className="textarea textarea--code"
              rows={18}
              value={draft.htmlBody}
              onChange={(e) => setField('htmlBody', e.target.value)}
              disabled={!isAdmin}
            />
          </label>
          <label className="field">
            <span>Versão texto (fallback)</span>
            <textarea
              className="textarea"
              rows={8}
              value={draft.textBody}
              onChange={(e) => setField('textBody', e.target.value)}
              disabled={!isAdmin}
            />
          </label>
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={draft.isActive}
              onChange={(e) => setField('isActive', e.target.checked)}
              disabled={!isAdmin}
            />
            <span>Template ativo (usado em todos os envios)</span>
          </label>
        </section>
      )}

      {selectedKey && (
        <section className="card">
          <h2>Preview ao vivo</h2>
          {preview.isLoading && <p>Carregando preview…</p>}
          {preview.data && (
            <>
              <p className="muted">
                <strong>Assunto gerado:</strong> {preview.data.subject || '(vazio)'}
              </p>
              <div className="preview-frame">
                <iframe
                  title="preview-email"
                  srcDoc={preview.data.html || '<p>Sem conteúdo no template.</p>'}
                />
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}