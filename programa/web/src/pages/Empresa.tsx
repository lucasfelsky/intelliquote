import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/api/client';

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
}

function toNullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export default function Empresa() {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<CompanyProfile | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const profile = useQuery({
    queryKey: ['company-profile'],
    queryFn: () => api.get<CompanyProfile>('/api/v1/company-profile'),
  });

  useEffect(() => {
    if (profile.data && draft === null) {
      setDraft(profile.data);
    }
  }, [profile.data, draft]);

  const save = useMutation({
    mutationFn: (payload: CompanyProfile) =>
      api.put<CompanyProfile>('/api/v1/company-profile', {
        companyName: payload.companyName.trim(),
        tradeName: toNullable(payload.tradeName ?? ''),
        taxId: toNullable(payload.taxId ?? ''),
        addressLine1: toNullable(payload.addressLine1 ?? ''),
        addressLine2: toNullable(payload.addressLine2 ?? ''),
        city: toNullable(payload.city ?? ''),
        state: toNullable(payload.state ?? ''),
        postalCode: toNullable(payload.postalCode ?? ''),
        country: toNullable(payload.country ?? ''),
        purchasingEmail: toNullable(payload.purchasingEmail ?? ''),
        purchasingPhone: toNullable(payload.purchasingPhone ?? ''),
        website: toNullable(payload.website ?? ''),
        logoUrl: toNullable(payload.logoUrl ?? ''),
      }),
    onSuccess: (data) => {
      qc.setQueryData(['company-profile'], data);
      setDraft(data);
      setSavedAt(new Date().toLocaleString('pt-BR'));
      setFormError(null);
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

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft) return;
    if (!draft.companyName?.trim()) {
      setFormError('Informe a razão social.');
      return;
    }
    save.mutate(draft);
  }

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
