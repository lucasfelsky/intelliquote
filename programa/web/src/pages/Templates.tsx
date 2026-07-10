import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import JoditEditor from 'jodit-react';
import {
  listEmailTemplates,
  previewEmailTemplate,
  resetEmailTemplate,
  saveEmailTemplate,
  messageOf,
} from '@/services/emailTemplates';
import type { EmailTemplateDraft } from '@/services/templates';
import { useAuth } from '@/auth/AuthProvider';

const TEMPLATE_CARDS: Array<{
  key: string;
  title: string;
  description: string;
  icon: string;
}> = [
  {
    key: 'quote_dispatch',
    title: 'Envio de cotação',
    description: 'E-mail enviado aos fornecedores com o link do portal para responderem.',
    icon: '✉',
  },
  {
    key: 'quote_reply',
    title: 'Resposta ao fornecedor',
    description: 'E-mail enviado ao fornecedor vencedor ao clicar em “Responder”.',
    icon: '✓',
  },
];

const VARIABLE_CHIPS: Record<string, Array<{ token: string; label: string }>> = {
  quote_dispatch: [
    { token: '{{subject}}', label: 'Assunto' },
    { token: '{{requestCode}}', label: 'Código' },
    { token: '{{productName}}', label: 'Produto' },
    { token: '{{quantity}}', label: 'Quantidade' },
    { token: '{{unit}}', label: 'Unidade' },
    { token: '{{desiredIncoterm}}', label: 'Incoterm' },
    { token: '{{currency}}', label: 'Moeda' },
    { token: '{{deadlineAt}}', label: 'Prazo' },
    { token: '{{expiresAt}}', label: 'Expira em' },
    { token: '{{portalLink}}', label: 'Link do portal' },
    { token: '{{companyName}}', label: 'Empresa' },
    { token: '{{supplierContactName}}', label: 'Contato' },
    { token: '{{itemsRows}}', label: 'Tabela de itens' },
  ],
  quote_reply: [
    { token: '{{subject}}', label: 'Assunto' },
    { token: '{{requestCode}}', label: 'Código' },
    { token: '{{productName}}', label: 'Produto' },
    { token: '{{supplierName}}', label: 'Fornecedor' },
    { token: '{{itemsRows}}', label: 'Tabela de itens' },
  ],
};

const LOCALE_LABELS: Record<string, string> = {
  en: 'Inglês',
  'pt-BR': 'Português',
  es: 'Espanhol',
};

const joditConfig = {
  readonly: false,
  height: 400,
  toolbarButtonSize: 'small' as const,
  buttons: [
    'bold', 'italic', 'underline', '|',
    'ul', 'ol', '|',
    'link', 'table', '|',
    'align', 'left', 'center', 'right', '|',
    'font', 'fontsize', 'brush', '|',
    'undo', 'redo',
  ],
  buttonsMD: ['bold', 'italic', 'underline', '|', 'ul', 'ol', '|', 'link', '|', 'undo', 'redo'],
  buttonsSM: ['bold', 'italic', 'underline', '|', 'ul', 'ol', '|', 'link', '|', 'undo', 'redo'],
  showWordsCounter: false,
  showXPathInStatusbar: false,
  askBeforePasteHTML: false,
  askBeforePasteFromWord: false,
  defaultActionOnPaste: 'insert_only_text' as const,
  placeholder: 'Escreva o conteúdo do e-mail aqui…',
  theme: 'default',
};

export default function Templates() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const qc = useQueryClient();
  const editorRef = useRef(null);

  const templatesQuery = useQuery({
    queryKey: ['email-templates-all'],
    queryFn: () => listEmailTemplates(),
  });

  const availableLocales = useMemo(() => {
    const set = new Set<string>(['en']);
    (templatesQuery.data ?? []).forEach((t) => set.add(t.locale));
    return Array.from(set).sort();
  }, [templatesQuery.data]);

  const [selectedKey, setSelectedKey] = useState<string>('');
  const [locale, setLocale] = useState<string>('en');
  const [draft, setDraft] = useState<EmailTemplateDraft | null>(null);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const [showTextFallback, setShowTextFallback] = useState(false);
  const [htmlBackup, setHtmlBackup] = useState('');

  useEffect(() => {
    if (!selectedKey && TEMPLATE_CARDS.length > 0) {
      const first = TEMPLATE_CARDS[0];
      if (first) setSelectedKey(first.key);
    }
  }, [selectedKey]);

  const current = useMemo(() => {
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

  function insertChip(token: string) {
    if (!draft) return;
    if (editorRef.current) {
      const editor = (editorRef.current as unknown as { selection: { insertHTML: (html: string) => void } }).selection;
      if (editor?.insertHTML) {
        editor.insertHTML(token);
        return;
      }
    }
    setField('htmlBody', `${draft.htmlBody}${token}`);
  }

  const cardInfo = TEMPLATE_CARDS.find((c) => c.key === selectedKey);
  const variables = VARIABLE_CHIPS[selectedKey] ?? [];
  const hasCustomization = current !== null;
  const isModified = draft && preview.data
    ? draft.htmlBody !== (current?.htmlBody ?? preview.data.html)
    : false;

  return (
    <div className="page page--templates">
      <header className="page__header">
        <div>
          <h1>Templates de e-mail</h1>
          <p className="page__subtitle">
            Personalize os e-mails enviados pelo sistema. Escolha um template abaixo para editá-lo.
          </p>
        </div>
      </header>

      <div className="template-cards">
        {TEMPLATE_CARDS.map((card) => {
          const isActive = selectedKey === card.key;
          return (
            <button
              key={card.key}
              type="button"
              className={`template-card${isActive ? ' template-card--active' : ''}`}
              onClick={() => setSelectedKey(card.key)}
            >
              <span className="template-card__icon">{card.icon}</span>
              <div className="template-card__body">
                <strong className="template-card__title">{card.title}</strong>
                <p className="template-card__desc">{card.description}</p>
              </div>
            </button>
          );
        })}
      </div>

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

      {selectedKey && cardInfo && (
        <>
          <section className="card">
            <div className="template-toolbar">
              <div className="template-toolbar__left">
                <label className="field field--inline">
                  <span>Idioma</span>
                  <select value={locale} onChange={(e) => setLocale(e.target.value)}>
                    {availableLocales.map((loc) => (
                      <option key={loc} value={loc}>
                        {LOCALE_LABELS[loc] ?? loc}
                      </option>
                    ))}
                  </select>
                </label>
                <span className="template-source-badge">
                  {hasCustomization ? '✓ Personalizado' : 'Padrão do sistema'}
                  {isModified && ' · alterações não salvas'}
                </span>
              </div>
              <div className="template-toolbar__right">
                {isAdmin && (
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => {
                      if (window.confirm('Restaurar este template para o padrão do sistema? As personalizações serão perdidas.')) {
                        reset.mutate();
                      }
                    }}
                    disabled={reset.isPending || !hasCustomization}
                    title="Volta para o template original do sistema"
                  >
                    {reset.isPending ? 'Restaurando…' : 'Restaurar padrão'}
                  </button>
                )}
                {isAdmin && (
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => draft && save.mutate(draft)}
                    disabled={!draft || save.isPending}
                  >
                    {save.isPending ? 'Salvando…' : 'Salvar'}
                  </button>
                )}
              </div>
            </div>
          </section>

          {variables.length > 0 && (
            <section className="card">
              <div className="template-variables">
                <div className="template-variables__header">
                  <h3>Variáveis</h3>
                  <p className="muted">Clique para inserir no conteúdo do e-mail.</p>
                </div>
                <div className="chip-list">
                  {variables.map((v) => (
                    <button
                      type="button"
                      key={v.token}
                      className="chip"
                      onClick={() => insertChip(v.token)}
                      title={`Inserir ${v.token}`}
                      disabled={!isAdmin}
                    >
                      {v.label}
                    </button>
                  ))}
                </div>
              </div>
            </section>
          )}

          {draft && (
            <section className="card">
              <div className="template-editor-grid">
                <div className="template-editor-side">
                  <label className="field">
                    <span>Assunto</span>
                    <input
                      type="text"
                      className="input"
                      value={draft.subject}
                      onChange={(e) => setField('subject', e.target.value)}
                      disabled={!isAdmin}
                      placeholder="Assunto do e-mail"
                    />
                  </label>

                  <div className="template-editor-label">
                    <h3>Conteúdo do e-mail</h3>
                    {isAdmin && (
                      <button
                        type="button"
                        className="ghost-button ghost-button--sm"
                        onClick={() => {
                          if (showTextFallback) {
                            setHtmlBackup(draft.htmlBody);
                          } else {
                            if (htmlBackup) setField('htmlBody', htmlBackup);
                          }
                          setShowTextFallback(!showTextFallback);
                        }}
                      >
                        {showTextFallback ? 'Editor visual' : 'Editar texto puro'}
                      </button>
                    )}
                  </div>

                  {showTextFallback ? (
                    <textarea
                      className="textarea textarea--code"
                      rows={20}
                      value={draft.htmlBody}
                      onChange={(e) => setField('htmlBody', e.target.value)}
                      disabled={!isAdmin}
                      placeholder="HTML do e-mail"
                    />
                  ) : (
                    <JoditEditor
                      ref={editorRef}
                      value={draft.htmlBody}
                      config={{
                        ...joditConfig,
                        readonly: !isAdmin,
                      }}
                      onChange={(newVal: string) => setField('htmlBody', newVal)}
                    />
                  )}

                  <details className="template-text-toggle">
                    <summary>Versão texto (fallback para clientes que não suportam HTML)</summary>
                    <textarea
                      className="textarea"
                      rows={8}
                      value={draft.textBody}
                      onChange={(e) => setField('textBody', e.target.value)}
                      disabled={!isAdmin}
                      placeholder="Versão em texto puro do e-mail"
                      style={{ marginTop: 8 }}
                    />
                  </details>

                  <label className="checkbox-field" style={{ marginTop: 12 }}>
                    <input
                      type="checkbox"
                      checked={draft.isActive}
                      onChange={(e) => setField('isActive', e.target.checked)}
                      disabled={!isAdmin}
                    />
                    <span>Template ativo</span>
                  </label>
                </div>

                <div className="template-preview-side">
                  <h3>Preview ao vivo</h3>
                  <p className="muted">
                    Assunto: <strong>{preview.data?.subject || draft.subject || '(vazio)'}</strong>
                  </p>
                  {preview.isLoading && <p>Carregando preview…</p>}
                  {preview.data && (
                    <div className="preview-frame">
                      <iframe
                        title="preview-email"
                        srcDoc={preview.data.html || '<p style=\"padding:24px;color:#888;\">Sem conteúdo no template.</p>'}
                      />
                    </div>
                  )}
                </div>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}