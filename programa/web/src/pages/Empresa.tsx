import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { CreditPartnersSection } from '@/components/CreditPartnersSection';
import { Icon } from '@/components/icons';

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
  // Destinatarios do aviso "nova solicitacao do comercial". Preenchida, o aviso
  // vai so para ela; vazia, vai para a Equipe COMEX em copia (env + dispatchCc).
  commercialRequestNotifyEmails?: string[] | null;
  awardApprovalThreshold?: number | null;
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
  const { user } = useAuth();
  const canChangeApproval = user?.role === 'admin' || user?.role === 'gestor';
  const canEditProfile = ['admin', 'comprador', 'gestor'].includes(user?.role ?? '');
  const qc = useQueryClient();
  const [draft, setDraft] = useState<CompanyProfile | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [ccDraft, setCcDraft] = useState('');
  const [ccError, setCcError] = useState<string | null>(null);
  const [notifyDraft, setNotifyDraft] = useState('');
  const [notifyError, setNotifyError] = useState<string | null>(null);
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
        commercialRequestNotifyEmails: normalizeCcList(
          payload.profile.commercialRequestNotifyEmails ?? [],
        ),
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
      <div className="page empresa-page">
        <h1>Empresa</h1>
        <p className="empresa-carregando" role="status">
          <span className="btn-spinner" aria-hidden="true" />
          Carregando perfil da empresa…
        </p>
      </div>
    );
  }

  if (profile.isError) {
    return (
      <div className="page empresa-page">
        <h1>Empresa</h1>
        <div
          className="empty-state empty-state--erro"
          role="alert"
        >
          <span className="empty-state__icon">
            <Icon name="alert-triangle" size={24} strokeWidth={1.7} />
          </span>
          <strong className="empty-state__title">Não foi possível carregar o perfil da empresa.</strong>
          <p className="empty-state__text">Verifique sua conexão e tente novamente.</p>
          <button type="button" className="ghost-button" onClick={() => profile.refetch()}>
            <Icon name="refresh" size={14} strokeWidth={2} />
            Tentar novamente
          </button>
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

  // Lista propria do aviso "nova solicitacao do comercial": mesmo padrao do CC
  // externo (entrada + Adicionar + Remover), mas sem perfis do sistema.
  function addNotifyEmail() {
    setNotifyError(null);
    const candidate = notifyDraft.trim();
    if (!candidate) {
      setNotifyError('Digite um e-mail antes de adicionar.');
      return;
    }
    if (!isLikelyEmail(candidate)) {
      setNotifyError('Formato de e-mail invalido.');
      return;
    }
    setDraft((current) => {
      if (!current) return current;
      const existing = normalizeCcList(current.commercialRequestNotifyEmails ?? []);
      return {
        ...current,
        commercialRequestNotifyEmails: normalizeCcList([...existing, candidate]),
      };
    });
    setNotifyDraft('');
  }

  function removeNotifyEmail(email: string) {
    setDraft((current) => {
      if (!current) return current;
      const target = email.trim().toLowerCase();
      return {
        ...current,
        commercialRequestNotifyEmails: normalizeCcList(
          current.commercialRequestNotifyEmails ?? [],
        ).filter((e) => e !== target),
      };
    });
  }

  function handleNotifyKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addNotifyEmail();
    }
  }

  function handleCcKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addExternal();
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft || !canEditProfile) return;
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

  const notifyEmails = normalizeCcList(draft.commercialRequestNotifyEmails ?? []);
  const activeUsers = (directory.data ?? []).filter((u) => u.isActive);
  const inactiveUsers = (directory.data ?? []).filter((u) => !u.isActive);

  const plural = (n: number) => (n === 1 ? '' : 's');
  const emCopia = allActiveUserIds.size - excludedProfileIds.size;
  const totalCc = normalizeCcList(draft.dispatchCc ?? []).length;
  const ccResumo = autoIncludeProfiles ? (
    <>
      Modo automático ligado: <span className="cc-mono">{emCopia}</span>
      {` perfil${plural(emCopia)} em cópia`}
      {excludedProfileIds.size > 0 && (
        <>
          {' ('}
          <span className="cc-mono">{excludedProfileIds.size}</span>
          {` excluído${plural(excludedProfileIds.size)})`}
        </>
      )}
      {', mais '}
      <span className="cc-mono">{externalEmails.length}</span>
      {` e-mail${plural(externalEmails.length)} externo${plural(externalEmails.length)}.`}
    </>
  ) : (
    <>
      Total: <span className="cc-mono">{totalCc}</span>
      {` endereço${plural(totalCc)} em cópia automática (`}
      <span className="cc-mono">{selectedUserIds.size}</span>
      {` perfil${plural(selectedUserIds.size)} + `}
      <span className="cc-mono">{externalEmails.length}</span>
      {` externo${plural(externalEmails.length)}).`}
    </>
  );

  return (
    <div className="page empresa-page">
      <div className="page-header">
        <div>
          <h1>Perfil da empresa</h1>
          <p>Esses dados aparecem nos documentos de cotação e nos e-mails automáticos.</p>
        </div>
        {savedAt && (
          <span className="badge empresa-salvo" role="status">
            <Icon name="check" size={14} strokeWidth={2.2} />
            Salvo às <span className="empresa-mono">{savedAt}</span>
          </span>
        )}
      </div>

      <form className="card empresa-formulario" onSubmit={handleSubmit} aria-label="Perfil da empresa">
        {!canEditProfile && (
          <p className="alert empresa-aviso">
            Somente leitura - seu perfil não pode editar os dados da empresa.
          </p>
        )}
        <fieldset className="empresa-conjunto" disabled={!canEditProfile}>
        <section className="empresa-secao empresa-secao--dados" aria-labelledby="em-dados">
          <h2 id="em-dados" className="empresa-secao__eyebrow">Dados cadastrais</h2>
          <div className="empresa-grade">
            <div className="empresa-campo">
              <label className="field-label">Razão social *</label>
              <input
                className="input"
                value={draft.companyName}
                onChange={(e) => update('companyName', e.target.value)}
                required
              />
            </div>
            <div className="empresa-campo">
              <label className="field-label">Nome fantasia</label>
              <input
                className="input"
                value={draft.tradeName ?? ''}
                onChange={(e) => update('tradeName', e.target.value)}
              />
            </div>
            <div className="empresa-campo">
              <label className="field-label">CNPJ / Tax ID</label>
              <input
                className="input empresa-campo__mono"
                value={draft.taxId ?? ''}
                onChange={(e) => update('taxId', e.target.value)}
              />
            </div>
            <div className="empresa-campo">
              <label className="field-label">Website</label>
              <input
                className="input"
                value={draft.website ?? ''}
                onChange={(e) => update('website', e.target.value)}
              />
            </div>
            <div className="empresa-campo empresa-campo--duplo">
              <label className="field-label">Endereço (linha 1)</label>
              <input
                className="input"
                value={draft.addressLine1 ?? ''}
                onChange={(e) => update('addressLine1', e.target.value)}
              />
            </div>
            <div className="empresa-campo empresa-campo--duplo">
              <label className="field-label">Endereço (linha 2)</label>
              <input
                className="input"
                value={draft.addressLine2 ?? ''}
                onChange={(e) => update('addressLine2', e.target.value)}
              />
            </div>
            <div className="empresa-campo">
              <label className="field-label">Cidade</label>
              <input
                className="input"
                value={draft.city ?? ''}
                onChange={(e) => update('city', e.target.value)}
              />
            </div>
            <div className="empresa-campo">
              <label className="field-label">UF / Estado</label>
              <input
                className="input"
                value={draft.state ?? ''}
                onChange={(e) => update('state', e.target.value)}
              />
            </div>
            <div className="empresa-campo">
              <label className="field-label">CEP</label>
              <input
                className="input empresa-campo__mono"
                value={draft.postalCode ?? ''}
                onChange={(e) => update('postalCode', e.target.value)}
              />
            </div>
            <div className="empresa-campo">
              <label className="field-label">País</label>
              <input
                className="input"
                value={draft.country ?? ''}
                onChange={(e) => update('country', e.target.value)}
              />
            </div>
            <div className="empresa-campo">
              <label className="field-label">E-mail de compras</label>
              <input
                className="input"
                type="email"
                value={draft.purchasingEmail ?? ''}
                onChange={(e) => update('purchasingEmail', e.target.value)}
              />
            </div>
            <div className="empresa-campo">
              <label className="field-label">Telefone de compras</label>
              <input
                className="input empresa-campo__mono"
                value={draft.purchasingPhone ?? ''}
                onChange={(e) => update('purchasingPhone', e.target.value)}
              />
            </div>
            <div className="empresa-campo empresa-campo--duplo">
              <label className="field-label">URL do logotipo</label>
              <input
                className="input"
                value={draft.logoUrl ?? ''}
                onChange={(e) => update('logoUrl', e.target.value)}
                placeholder="https://…"
              />
            </div>
          </div>
        </section>

        <section className="empresa-secao" aria-labelledby="em-gatilho">
          <label id="em-gatilho" className="empresa-secao__titulo" htmlFor="em-threshold">
            Gatilho de Aprovação de Adjudicação (R$)
          </label>
          <p className="empresa-dica">
            Valores (Landed Cost CIF BRL) acima deste limite exigirão a aprovação de um Gestor ou Administrador.
            Deixe em branco para não exigir aprovação baseada em valor.
          </p>
          <input
            id="em-threshold"
            className="input empresa-gatilho"
            type="number"
            min="0"
            step="0.01"
            value={draft.awardApprovalThreshold ?? ''}
            disabled={!canChangeApproval}
            onChange={(e) => {
              const val = e.target.value === '' ? null : Number(e.target.value);
              update('awardApprovalThreshold', val);
            }}
            placeholder="Ex.: 50000"
          />
        </section>

        <section className="empresa-secao empresa-secao--cc" aria-labelledby="em-cc">
          <h3 id="em-cc" className="empresa-secao__titulo">Cópia automática (CC)</h3>
          <p className="empresa-dica empresa-dica--cc">
            Esses e-mails recebem cópia de <strong>todos</strong> os envios de cotação desta empresa,
            além dos destinatários escolhidos no modal de envio. Útil para manter o escritório de
            compras, a gerência ou o financeiro informados.
          </p>

          <label className="cc-mode-toggle" htmlFor="em-auto">
            <input
              id="em-auto"
              type="checkbox"
              checked={autoIncludeProfiles}
              onChange={(e) => setAutoIncludeProfiles(e.target.checked)}
            />
            <span className="cc-mode-toggle__texto">
              <strong>Incluir todos os perfis ativos automaticamente</strong>
              <span>
                Quando ligado, todo perfil ativo (admin, comprador, gestor, visualizador)
                entra em cópia dos envios. Desmarque abaixo quem você não quer
                receber. Adicione e-mails externos no campo ao lado para
                destinatários que não têm login (ex: financeiro externo, auditoria).
              </span>
            </span>
          </label>

          <div className="cc-colunas">
            <fieldset className="cc-users">
              <legend>
                {autoIncludeProfiles ? (
                  <>
                    Perfis do sistema (<span className="cc-mono">{allActiveUserIds.size - excludedProfileIds.size}</span> de{' '}
                    <span className="cc-mono">{allActiveUserIds.size}</span> em cópia)
                  </>
                ) : (
                  <>
                    Perfis do sistema (<span className="cc-mono">{selectedUserIds.size}</span>
                    {` selecionado${selectedUserIds.size === 1 ? '' : 's'})`}
                  </>
                )}
              </legend>
              {directory.isLoading && (
                <p className="cc-users__vazio" role="status">
                  Carregando perfis…
                </p>
              )}
              {!directory.isLoading && activeUsers.length === 0 && (
                <p className="cc-users__vazio">
                  Nenhum perfil ativo cadastrado.
                </p>
              )}
              {activeUsers.length > 0 && (
                <ul className="cc-users__lista">
                  {activeUsers.map((user) => {
                    const checked = autoIncludeProfiles
                      ? !excludedProfileIds.has(user.id)
                      : selectedUserIds.has(user.id);
                    return (
                      <li key={user.id} className={`cc-users__item${checked ? '' : ' cc-users__item--desmarcado'}`}>
                        <input
                          type="checkbox"
                          id={`cc-user-${user.id}`}
                          checked={checked}
                          onChange={(e) => toggleUser(user, e.target.checked)}
                        />
                        <label htmlFor={`cc-user-${user.id}`}>
                          <strong>{user.name}</strong>{' '}
                          <span className="cc-users__email">
                            &lt;{user.email}&gt;
                          </span>
                        </label>
                        <span className="badge badge--muted cc-users__papel">
                          {roleLabel(user.role)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
              {inactiveUsers.length > 0 && (
                <details className="cc-users__inativos">
                  <summary>
                    <Icon name="chevron-right" size={14} strokeWidth={2} className="cc-users__fechado" />
                    <Icon name="chevron-down" size={14} strokeWidth={2} className="cc-users__aberto" />
                    <span className="cc-mono">{inactiveUsers.length}</span>
                    {` perfil${inactiveUsers.length === 1 ? '' : 's'} inativo${inactiveUsers.length === 1 ? '' : 's'} (desmarcado${selectedUserIds.size === 0 ? '' : 's'} automaticamente)`}
                  </summary>
                  <ul className="cc-users__lista cc-users__lista--inativos">
                    {inactiveUsers.map((user) => {
                      const checked = autoIncludeProfiles
                        ? !excludedProfileIds.has(user.id)
                        : selectedUserIds.has(user.id);
                      return (
                        <li key={user.id} className="cc-users__item cc-users__item--inativo">
                          <input
                            type="checkbox"
                            id={`cc-user-${user.id}`}
                            checked={checked}
                            onChange={(e) => toggleUser(user, e.target.checked)}
                          />
                          <label htmlFor={`cc-user-${user.id}`}>
                            {user.name}{' '}
                            <span className="cc-users__email">
                              &lt;{user.email}&gt;
                            </span>
                          </label>
                          <span className="cc-users__papel-inativo">
                            {roleLabel(user.role)}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </details>
              )}
            </fieldset>

            <div className="cc-externos">
              <label className="cc-externos__rotulo" htmlFor="em-ext">
                E-mails externos
              </label>
              <p className="empresa-dica empresa-dica--externos">
                Para destinatários que não têm login no IntelliQuote (ex: financeiro externo,
                auditoria). Limite de 50 endereços somando perfis + externos.
              </p>
              <div className="cc-input-row">
                <input
                  id="em-ext"
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
                <p className="empresa-erro" role="alert">{ccError}</p>
              )}

              {externalEmails.length > 0 && (
                <ul className="cc-list">
                  {externalEmails.map((email) => (
                    <li key={email} className="cc-list__item">
                      <span>
                        <Icon name="templates" size={16} />
                        {email}
                      </span>
                      <button
                        type="button"
                        className="link-button cc-list__remover"
                        onClick={() => removeExternal(email)}
                      >
                        Remover
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {externalEmails.length === 0 && selectedUserIds.size === 0 && !autoIncludeProfiles && (
                <p className="cc-vazio">
                  Nenhum destinatário em cópia automática. Envios sairão apenas para os
                  destinatários escolhidos no modal.
                </p>
              )}
            </div>
          </div>

          <p className="cc-resumo">
            <Icon name="info" size={16} />
            <span>{ccResumo}</span>
          </p>
        </section>

        <section className="empresa-secao empresa-secao--avisos" aria-labelledby="em-avisos">
          <label id="em-avisos" className="empresa-secao__titulo" htmlFor="notify-email-input">
            Avisos de nova solicitação (Comercial)
          </label>
          <p className="empresa-dica">
            Quem recebe o e-mail quando o Comercial cria uma solicitação. Se ficar vazio, vai para a
            Equipe COMEX em cópia.
          </p>
          <div className="cc-input-row cc-input-row--avisos">
            <input
              id="notify-email-input"
              className="input"
              type="email"
              value={notifyDraft}
              onChange={(e) => {
                setNotifyDraft(e.target.value);
                if (notifyError) setNotifyError(null);
              }}
              onKeyDown={handleNotifyKeyDown}
              onBlur={() => {
                if (notifyDraft.trim().length > 0) addNotifyEmail();
              }}
              placeholder="ex.: gestor@sqquimica.com"
            />
            <button type="button" className="ghost-button" onClick={addNotifyEmail}>
              Adicionar aviso
            </button>
          </div>
          {notifyError && (
            <p className="empresa-erro" role="alert">{notifyError}</p>
          )}
          {notifyEmails.length > 0 && (
            <ul className="cc-list cc-list--avisos">
              {notifyEmails.map((email) => (
                <li key={email} className="cc-list__item">
                  <span>
                    <Icon name="templates" size={16} />
                    {email}
                  </span>
                  <button
                    type="button"
                    className="link-button cc-list__remover"
                    onClick={() => removeNotifyEmail(email)}
                    aria-label={`Remover ${email} dos avisos de nova solicitação`}
                  >
                    Remover
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {formError && (
          <p className="alert alert--error empresa-erro-geral" role="alert">{formError}</p>
        )}

        <div className="empresa-rodape">
          <button
            type="submit"
            className="primary-button"
            disabled={save.isPending}
          >
            {save.isPending ? 'Salvando…' : 'Salvar perfil'}
          </button>
        </div>
        </fieldset>
      </form>

      <CreditPartnersSection />
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
