import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/api/client';

interface DirectoryUser {
  id: number;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
}

interface CompanyProfile {
  id?: number;
  companyName: string;
  tradeName?: string | null;
  taxId?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
  purchasingEmail?: string | null;
  purchasingPhone?: string | null;
  website?: string | null;
  logoUrl?: string | null;
  // Lista de e-mails fixos que recebem copia automatica em todos os
  // envios de cotacao desta empresa. O backend sempre deduplica
  // case-insensitive e descarta entradas invalidas.
  dispatchCc?: string[] | null;
}

function toNullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeCcList(list: string[] | null | undefined): string[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim().toLowerCase();
    if (!trimmed.includes('@')) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function isLikelyEmail(value: string): boolean {
  // Validacao client-side barata para feedback imediato. O backend
  // re-valida com zod e devolve erro 400 se algo escapar.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function roleLabel(role: string): string {
  switch (role) {
    case 'admin':
      return 'Administrador';
    case 'comprador':
      return 'Comprador';
    case 'gestor':
      return 'Gestor';
    case 'viewer':
      return 'Visualizador';
    default:
      return role;
  }
}

export default function Empresa() {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<CompanyProfile | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [ccDraft, setCcDraft] = useState('');
  const [ccError, setCcError] = useState<string | null>(null);
  // Quando ligado, o backend adiciona todos os perfis ativos do sistema
  // (admin / comprador / gestor) como copia automatica, alem dos e-mails
  // externos manuais. O admin usa isso para garantir que a equipe toda
  // acompanha sem precisar marcar usuario por usuario.
  const [autoIncludeProfiles, setAutoIncludeProfiles] = useState(true);
  // Excluidos manuais: perfis que o admin nao quer em copia mesmo com
  // o auto-include ligado. Mapeamos por id do usuario (precisamos do id
  // do users-directory para casar).
  const [excludedProfileIds, setExcludedProfileIds] = useState<Set<number>>(
    () => new Set<number>(),
  );

  const profile = useQuery({
    queryKey: ['company-profile'],
    queryFn: () => api.get<CompanyProfile>('/api/v1/company-profile'),
  });

  // Diretorio leve de perfis do sistema (sem senha, sem contadores).
  // Alimenta a grade de checkboxes "Perfis que recebem CC" abaixo.
  const directory = useQuery({
    queryKey: ['users-directory'],
    queryFn: () => api.get<DirectoryUser[]>('/api/v1/users-directory'),
  });

  useEffect(() => {
    if (profile.data && draft === null) {
      setDraft(profile.data);
    }
  }, [profile.data, draft]);

  // Hidrata o estado do auto-include a partir do dispatchCc persistido.
  // Se o backend ja devolve dispatchCc com todos os perfis ativos, ligamos
  // o toggle. Se nao, mantemos desligado (modo manual legado).
  useEffect(() => {
    if (!directory.data || !draft) return;
    const directoryIds = new Set(
      directory.data.filter((u) => u.isActive).map((u) => u.id),
    );
    const userEmails = new Map<string, number>();
    directory.data.forEach((u) => userEmails.set(u.email.trim().toLowerCase(), u.id));
    const list = normalizeCcList(draft.dispatchCc ?? []);
    const activeUserIds = new Set<number>();
    list.forEach((email) => {
      const id = userEmails.get(email);
      if (typeof id === 'number' && directoryIds.has(id)) activeUserIds.add(id);
    });
    setAutoIncludeProfiles(
      directoryIds.size > 0 && activeUserIds.size === directoryIds.size,
    );
  }, [directory.data, draft]);

  // E-mails ja escolhidos vem do dispatchCc persistido. Separamos em
  //  - selectedUserIds: perfis que foram selecionados via checkbox
  //  - externalEmails: e-mails manuais que nao casam com nenhum perfil
  // Quando o backend devolve dispatchCc com e-mails de usuarios antigos
  // (ex: alguem reusou o e-mail mas trocou de cargo), mantemos eles
  // como externos para nao perder a preferencia do admin.
  const { selectedUserIds, externalEmails, allActiveUserIds } = useMemo(() => {
    const list = normalizeCcList(draft?.dispatchCc ?? []);
    const userEmails = new Map<string, number>();
    (directory.data ?? []).forEach((u) => {
      userEmails.set(u.email.trim().toLowerCase(), u.id);
    });
    const selected = new Set<number>();
    const externals: string[] = [];
    for (const email of list) {
      const userId = userEmails.get(email);
      if (typeof userId === 'number') {
        selected.add(userId);
      } else {
        externals.push(email);
      }
    }
    const allActive = new Set<number>();
    (directory.data ?? [])
      .filter((u) => u.isActive)
      .forEach((u) => allActive.add(u.id));
    return {
      selectedUserIds: selected,
      externalEmails: externals,
      allActiveUserIds: allActive,
    };
  }, [draft?.dispatchCc, directory.data]);

  // Quando o auto-include esta ligado, todos os perfis ativos estao
  // implicitamente em copia. Os checkboxes ficam marcados, mas a UI
  // tambem permite desmarcar para "excluir da copia automatica" — esses
  // ids caem no excludedProfileIds ate o admin salvar.
  useEffect(() => {
    if (!autoIncludeProfiles) {
      setExcludedProfileIds(new Set());
      return;
    }
    const implicit = new Set<number>();
    allActiveUserIds.forEach((id) => {
      if (!selectedUserIds.has(id)) implicit.add(id);
    });
    setExcludedProfileIds(implicit);
  }, [autoIncludeProfiles, allActiveUserIds, selectedUserIds]);

  const save = useMutation({
    mutationFn: (payload: {
      profile: CompanyProfile;
      dispatchCc: string[];
      includeUserProfiles: boolean;
    }) =>
      api.put<CompanyProfile>('/api/v1/company-profile', {
        companyName: payload.profile.companyName.trim(),
        tradeName: toNullable(payload.profile.tradeName ?? ''),
        taxId: toNullable(payload.profile.taxId ?? ''),
        addressLine1: toNullable(payload.profile.addressLine1 ?? ''),
        addressLine2: toNullable(payload.profile.addressLine2 ?? ''),
        city: toNullable(payload.profile.city ?? ''),
        state: toNullable(payload.profile.state ?? ''),
        postalCode: toNullable(payload.profile.postalCode ?? ''),
        country: toNullable(payload.profile.country ?? ''),
        purchasingEmail: toNullable(payload.profile.purchasingEmail ?? ''),
        purchasingPhone: toNullable(payload.profile.purchasingPhone ?? ''),
        website: toNullable(payload.profile.website ?? ''),
        logoUrl: toNullable(payload.profile.logoUrl ?? ''),
        dispatchCc: {
          includeUserProfiles: payload.includeUserProfiles,
          extras: payload.dispatchCc,
        },
      }),
    onSuccess: (data) => {
      qc.setQueryData(['company-profile'], data);
      setDraft(data);
      setSavedAt(new Date().toLocaleString('pt-BR'));
      setFormError(null);
      qc.invalidateQueries({ queryKey: ['company-profile-cc-hint'] });
    },
    onError: (err) => setFormError(messageOf(err)),
  });

  if (profile.isLoading || draft === null) {
    return (
      <div className="page">
        <h1>Empresa</h1>
        <p>Carregando perfil da empresa…</p>
      </div>
    );
  }

  if (profile.isError) {
    return (
      <div className="page">
        <h1>Empresa</h1>
        <div className="empty-state">
          <p>Não foi possível carregar o perfil da empresa.</p>
        </div>
      </div>
    );
  }

  function update<K extends keyof CompanyProfile>(key: K, value: CompanyProfile[K]) {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  }

  function toggleUser(user: DirectoryUser, checked: boolean) {
    if (autoIncludeProfiles) {
      // No modo auto-include, "desmarcar" = adicionar o id a excluded
      // para o backend nao inclui-lo. "Marcar" = remover da excluded.
      setExcludedProfileIds((current) => {
        const next = new Set(current);
        if (checked) next.delete(user.id);
        else next.add(user.id);
        return next;
      });
      return;
    }
    setDraft((current) => {
      if (!current) return current;
      const existing = normalizeCcList(current.dispatchCc ?? []);
      const userEmail = user.email.trim().toLowerCase();
      const withoutUser = existing.filter((e) => e !== userEmail);
      const next = checked
        ? normalizeCcList([...withoutUser, userEmail])
        : withoutUser;
      return { ...current, dispatchCc: next };
    });
  }

  function addExternal() {
    setCcError(null);
    const candidate = ccDraft.trim();
    if (!candidate) {
      setCcError('Digite um e-mail antes de adicionar.');
      return;
    }
    if (!isLikelyEmail(candidate)) {
      setCcError('Formato de e-mail invalido.');
      return;
    }
    // Se o e-mail digitado for de um perfil ja cadastrado, preferimos
    // marcar o checkbox em vez de duplicar como e-mail externo.
    const lower = candidate.toLowerCase();
    const matchedUser = (directory.data ?? []).find(
      (u) => u.email.trim().toLowerCase() === lower,
    );
    if (matchedUser) {
      setDraft((current) => {
        if (!current) return current;
        const existing = normalizeCcList(current.dispatchCc ?? []);
        if (existing.includes(lower)) return current;
        return {
          ...current,
          dispatchCc: normalizeCcList([...existing, lower]),
        };
      });
      setCcDraft('');
      return;
    }
    setDraft((current) => {
      if (!current) return current;
      const existing = normalizeCcList(current.dispatchCc ?? []);
      const normalized = normalizeCcList([...existing, candidate]);
      return { ...current, dispatchCc: normalized };
    });
    setCcDraft('');
  }

  function removeExternal(email: string) {
    setDraft((current) => {
      if (!current) return current;
      const target = email.trim().toLowerCase();
      const filtered = normalizeCcList(current.dispatchCc ?? []).filter((e) => e !== target);
      return { ...current, dispatchCc: filtered };
    });
  }

  function handleCcKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addExternal();
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft) return;
    if (!draft.companyName?.trim()) {
      setFormError('Informe a razão social.');
      return;
    }
    // Quando o admin liga o auto-include, mandamos apenas os e-mails
    // externos como `extras` — o backend adiciona todos os perfis ativos
    // (com excecao dos excludedProfileIds, se houver). Quando esta
    // desligado, mandamos exatamente o que o admin marcou na UI.
    let externals: string[];
    if (autoIncludeProfiles) {
      const base = normalizeCcList(draft.dispatchCc ?? []);
      const kept = base.filter((email) => {
        const userId = (directory.data ?? []).find(
          (u) => u.email.trim().toLowerCase() === email,
        )?.id;
        if (typeof userId !== 'number') return true;
        return excludedProfileIds.has(userId);
      });
      externals = kept;
    } else {
      externals = normalizeCcList(draft.dispatchCc ?? []);
    }
    save.mutate({
      profile: draft,
      dispatchCc: externals,
      includeUserProfiles: autoIncludeProfiles,
    });
  }

  const activeUsers = (directory.data ?? []).filter((u) => u.isActive);
  const inactiveUsers = (directory.data ?? []).filter((u) => !u.isActive);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <p className="eyebrow">Administração</p>
          <h1>Perfil da empresa</h1>
          <p>Esses dados aparecem nos documentos de cotação e nos e-mails automáticos.</p>
        </div>
        {savedAt && <span className="badge">Salvo às {savedAt}</span>}
      </div>

      <form className="card" onSubmit={handleSubmit}>
        <div className="form-grid">
          <div>
            <label className="field-label">Razão social *</label>
            <input
              className="input"
              value={draft.companyName}
              onChange={(e) => update('companyName', e.target.value)}
              required
            />
          </div>
          <div>
            <label className="field-label">Nome fantasia</label>
            <input
              className="input"
              value={draft.tradeName ?? ''}
              onChange={(e) => update('tradeName', e.target.value)}
            />
          </div>
          <div>
            <label className="field-label">CNPJ / Tax ID</label>
            <input
              className="input"
              value={draft.taxId ?? ''}
              onChange={(e) => update('taxId', e.target.value)}
            />
          </div>
          <div>
            <label className="field-label">Website</label>
            <input
              className="input"
              value={draft.website ?? ''}
              onChange={(e) => update('website', e.target.value)}
            />
          </div>
          <div className="form-grid__full">
            <label className="field-label">Endereço (linha 1)</label>
            <input
              className="input"
              value={draft.addressLine1 ?? ''}
              onChange={(e) => update('addressLine1', e.target.value)}
            />
          </div>
          <div className="form-grid__full">
            <label className="field-label">Endereço (linha 2)</label>
            <input
              className="input"
              value={draft.addressLine2 ?? ''}
              onChange={(e) => update('addressLine2', e.target.value)}
            />
          </div>
          <div>
            <label className="field-label">Cidade</label>
            <input
              className="input"
              value={draft.city ?? ''}
              onChange={(e) => update('city', e.target.value)}
            />
          </div>
          <div>
            <label className="field-label">UF / Estado</label>
            <input
              className="input"
              value={draft.state ?? ''}
              onChange={(e) => update('state', e.target.value)}
            />
          </div>
          <div>
            <label className="field-label">CEP</label>
            <input
              className="input"
              value={draft.postalCode ?? ''}
              onChange={(e) => update('postalCode', e.target.value)}
            />
          </div>
          <div>
            <label className="field-label">País</label>
            <input
              className="input"
              value={draft.country ?? ''}
              onChange={(e) => update('country', e.target.value)}
            />
          </div>
          <div>
            <label className="field-label">E-mail de compras</label>
            <input
              className="input"
              type="email"
              value={draft.purchasingEmail ?? ''}
              onChange={(e) => update('purchasingEmail', e.target.value)}
            />
          </div>
          <div>
            <label className="field-label">Telefone de compras</label>
            <input
              className="input"
              value={draft.purchasingPhone ?? ''}
              onChange={(e) => update('purchasingPhone', e.target.value)}
            />
          </div>
          <div className="form-grid__full">
            <label className="field-label">URL do logotipo</label>
            <input
              className="input"
              value={draft.logoUrl ?? ''}
              onChange={(e) => update('logoUrl', e.target.value)}
              placeholder="https://…"
            />
          </div>
        </div>

        <div className="form-grid__full" style={{ marginTop: 28 }}>
          <label className="field-label">Cópia automática (CC)</label>
          <p className="field-hint">
            Esses e-mails recebem cópia de <strong>todos</strong> os envios de cotação desta empresa,
            além dos destinatários escolhidos no modal de envio. Útil para manter o escritório de
            compras, a gerência ou o financeiro informados.
          </p>

          <div
            className="cc-mode-toggle"
            style={{
              marginTop: 12,
              padding: 12,
              border: '1px solid var(--border, #e3e8ee)',
              borderRadius: 8,
              background: 'var(--surface-muted, #f7fafc)',
            }}
          >
            <label
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'flex-start',
                cursor: 'pointer',
                fontSize: 14,
              }}
            >
              <input
                type="checkbox"
                checked={autoIncludeProfiles}
                onChange={(e) => setAutoIncludeProfiles(e.target.checked)}
                style={{ width: 16, height: 16, marginTop: 2 }}
              />
              <span>
                <strong>Incluir todos os perfis ativos automaticamente</strong>
                <span
                  style={{
                    display: 'block',
                    color: 'var(--text-muted, #6b7785)',
                    fontSize: 12,
                    marginTop: 2,
                  }}
                >
                  Quando ligado, todo perfil ativo (admin, comprador, gestor, visualizador)
                  entra em cópia dos envios. Desmarque abaixo quem você não quer
                  receber. Adicione e-mails externos no campo ao lado para
                  destinatários que não têm login (ex: financeiro externo, auditoria).
                </span>
              </span>
            </label>
          </div>

          <fieldset
            className="cc-users"
            style={{
              marginTop: 12,
              border: '1px solid var(--border, #e3e8ee)',
              borderRadius: 8,
              padding: 12,
            }}
          >
            <legend className="field-label" style={{ padding: '0 6px', fontSize: 13 }}>
              {autoIncludeProfiles
                ? `Perfis do sistema (${allActiveUserIds.size - excludedProfileIds.size} de ${allActiveUserIds.size} em cópia)`
                : `Perfis do sistema (${selectedUserIds.size} selecionado${selectedUserIds.size === 1 ? '' : 's'})`}
            </legend>
            {directory.isLoading && (
              <p style={{ color: 'var(--text-muted, #6b7785)', fontSize: 13 }}>
                Carregando perfis…
              </p>
            )}
            {!directory.isLoading && activeUsers.length === 0 && (
              <p style={{ color: 'var(--text-muted, #6b7785)', fontSize: 13 }}>
                Nenhum perfil ativo cadastrado.
              </p>
            )}
            {activeUsers.length > 0 && (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {activeUsers.map((user) => {
                  const checked = autoIncludeProfiles
                    ? !excludedProfileIds.has(user.id)
                    : selectedUserIds.has(user.id);
                  return (
                    <li
                      key={user.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '6px 4px',
                        borderBottom: '1px solid var(--border, #eef2f6)',
                      }}
                    >
                      <input
                        type="checkbox"
                        id={`cc-user-${user.id}`}
                        checked={checked}
                        onChange={(e) => toggleUser(user, e.target.checked)}
                        style={{ width: 16, height: 16 }}
                      />
                      <label
                        htmlFor={`cc-user-${user.id}`}
                        style={{ flex: 1, cursor: 'pointer', fontSize: 14 }}
                      >
                        <strong>{user.name}</strong>{' '}
                        <span style={{ color: 'var(--text-muted, #6b7785)' }}>
                          &lt;{user.email}&gt;
                        </span>
                      </label>
                      <span
                        className="badge"
                        style={{ fontSize: 11, padding: '2px 8px' }}
                      >
                        {roleLabel(user.role)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            {inactiveUsers.length > 0 && (
              <details style={{ marginTop: 8 }}>
                <summary
                  style={{
                    fontSize: 12,
                    color: 'var(--text-muted, #6b7785)',
                    cursor: 'pointer',
                  }}
                >
                  {inactiveUsers.length} perfil{inactiveUsers.length === 1 ? '' : 's'} inativo
                  {inactiveUsers.length === 1 ? '' : 's'} (desmarcado{selectedUserIds.size === 0 ? '' : 's'} automaticamente)
                </summary>
                <ul style={{ listStyle: 'none', padding: 0, margin: '6px 0 0 0' }}>
                  {inactiveUsers.map((user) => {
                    const checked = autoIncludeProfiles
                      ? !excludedProfileIds.has(user.id)
                      : selectedUserIds.has(user.id);
                    return (
                      <li
                        key={user.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          padding: '4px 4px',
                          opacity: 0.6,
                        }}
                      >
                        <input
                          type="checkbox"
                          id={`cc-user-${user.id}`}
                          checked={checked}
                          onChange={(e) => toggleUser(user, e.target.checked)}
                          style={{ width: 16, height: 16 }}
                        />
                        <label
                          htmlFor={`cc-user-${user.id}`}
                          style={{ flex: 1, cursor: 'pointer', fontSize: 13 }}
                        >
                          {user.name}{' '}
                          <span style={{ color: 'var(--text-muted, #6b7785)' }}>
                            &lt;{user.email}&gt;
                          </span>
                        </label>
                        <span style={{ fontSize: 11, color: 'var(--text-muted, #6b7785)' }}>
                          {roleLabel(user.role)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </details>
            )}
          </fieldset>

          <div style={{ marginTop: 16 }}>
            <label className="field-label" style={{ fontSize: 13 }}>
              E-mails externos
            </label>
            <p
              className="field-hint"
              style={{ marginTop: 2, marginBottom: 6, fontSize: 12 }}
            >
              Para destinatários que não têm login no IntelliQuote (ex: financeiro externo,
              auditoria). Limite de 50 endereços somando perfis + externos.
            </p>
            <div className="cc-input-row" style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <input
                className="input"
                type="email"
                value={ccDraft}
                onChange={(e) => {
                  setCcDraft(e.target.value);
                  if (ccError) setCcError(null);
                }}
                onKeyDown={handleCcKeyDown}
                onBlur={() => {
                  if (ccDraft.trim().length > 0) addExternal();
                }}
                placeholder="ex.: financeiro@sqquimica.com"
              />
              <button type="button" className="ghost-button" onClick={addExternal}>
                Adicionar
              </button>
            </div>
            {ccError && (
              <p style={{ color: 'var(--danger)', marginTop: 6, fontSize: 13 }}>{ccError}</p>
            )}

            {externalEmails.length > 0 && (
              <ul className="cc-list" style={{ marginTop: 12, padding: 0, listStyle: 'none' }}>
                {externalEmails.map((email) => (
                  <li
                    key={email}
                    className="cc-list__item"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 12px',
                      border: '1px solid var(--border, #e3e8ee)',
                      borderRadius: 8,
                      marginBottom: 6,
                      background: 'var(--surface-muted, #f7fafc)',
                      fontSize: 14,
                    }}
                  >
                    <span>{email}</span>
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => removeExternal(email)}
                      style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer' }}
                    >
                      Remover
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {externalEmails.length === 0 && selectedUserIds.size === 0 && !autoIncludeProfiles && (
              <p
                style={{
                  color: 'var(--text-muted, #6b7785)',
                  fontSize: 13,
                  fontStyle: 'italic',
                  marginTop: 12,
                }}
              >
                Nenhum destinatário em cópia automática. Envios sairão apenas para os
                destinatários escolhidos no modal.
              </p>
            )}
          </div>

          <p
            className="field-hint"
            style={{ marginTop: 12, fontSize: 12 }}
          >
            {autoIncludeProfiles
              ? `Modo automático ligado: ${allActiveUserIds.size - excludedProfileIds.size} perfil${
                  allActiveUserIds.size - excludedProfileIds.size === 1 ? '' : 's'
                } em cópia${
                  excludedProfileIds.size > 0
                    ? ` (${excludedProfileIds.size} excluído${excludedProfileIds.size === 1 ? '' : 's'})`
                    : ''
                }, mais ${externalEmails.length} e-mail${
                  externalEmails.length === 1 ? '' : 's'
                } externo${externalEmails.length === 1 ? '' : 's'}.`
              : `Total: ${normalizeCcList(draft.dispatchCc ?? []).length} endereço${
                  normalizeCcList(draft.dispatchCc ?? []).length === 1 ? '' : 's'
                } em cópia automática (${selectedUserIds.size} perfil${
                  selectedUserIds.size === 1 ? '' : 's'
                } + ${externalEmails.length} externo${
                  externalEmails.length === 1 ? '' : 's'
                }).`}
          </p>
        </div>

        {formError && (
          <p style={{ color: 'var(--danger)', marginTop: 12, fontSize: 13 }}>{formError}</p>
        )}

        <div className="page-header__actions" style={{ marginTop: 18, justifyContent: 'flex-end' }}>
          <button
            type="submit"
            className="primary-button"
            disabled={save.isPending}
          >
            {save.isPending ? 'Salvando…' : 'Salvar perfil'}
          </button>
        </div>
      </form>
    </div>
  );
}

function messageOf(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body as { message?: unknown } | null;
    if (body && typeof body.message === 'string') return body.message;
    return err.message;
  }
  return err instanceof Error ? err.message : 'Erro desconhecido.';
}
