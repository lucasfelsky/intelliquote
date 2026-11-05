import { useConfirm } from '@/components/useConfirm';
import { useEffect, useMemo, useState, useRef } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { messageOf } from '@/services/quoteResponses';
import { Icon } from '@/components/icons';
import { Modal } from '@/components/Modal';
import { Pagination } from '@/components/Pagination';
import {
  catalogForecastKeys,
  codigoLivreNoForecast,
  listCatalogoSemForecast,
  type CatalogForecastVinculo,
} from '@/services/catalogForecast';
import { patchForecastSourceLeadTime } from '@/services/forecastFontes';
import ItemForecastVinculo, { useVinculoDoItem } from './Itens/ItemForecastVinculo';
import ItemVincularForecastModal, { mensagemVinculado } from './Itens/ItemVincularForecastModal';
import ItensSemForecast from './Itens/ItensSemForecast';

interface CatalogItem {
  id: number;
  commercialName: string;
  marketName: string;
  ncm: string | null;
  dbcorpCode: string | null;
  notes: string | null;
  isActive: boolean;
  familyId: number | null;
  family: { id: number; name: string } | null;
  createdAt: string;
  updatedAt: string;
}

type FormState = {
  commercialName: string;
  marketName: string;
  ncm: string;
  dbcorpCode: string;
  familyId: number | '';
  notes: string;
};

const EMPTY_FORM: FormState = {
  commercialName: '',
  marketName: '',
  ncm: '',
  dbcorpCode: '',
  familyId: '',
  notes: '',
};

function normalizeNcm(value: string): string {
  return value.replace(/\D/g, '').slice(0, 8);
}

const PAGE_SIZE = 50;

interface CatalogItemsPagination {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

interface CatalogItemPayload extends Record<string, unknown> {
  commercialName: string;
  marketName: string;
  ncm: string | null;
  dbcorpCode: string | null;
  familyId: number | null;
  notes: string | null;
}

interface ImportErrorLine {
  row: number;
  reason: string;
}

interface ImportPreview {
  validLines: Record<string, unknown>[];
  errorLines: ImportErrorLine[];
  warnings?: string[];
}

interface ImportResult {
  successLines: Record<string, unknown>[];
  errorLines: ImportErrorLine[];
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = String(reader.result ?? '').split(',')[1];
      if (!base64) reject(new Error('Falha ao ler arquivo'));
      else resolve(base64);
    };
    reader.onerror = () => reject(new Error('Erro ao ler arquivo.'));
    reader.readAsDataURL(file);
  });
}

export default function Itens() {
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<CatalogItem | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [page, setPage] = useState(1);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const [modalVinculo, setModalVinculo] = useState<{ item: CatalogItem; modo: 'vincular' | 'reativar' } | null>(null);
  const leadTimeGravado = useRef(false);

  // Import states
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importStep, setImportStep] = useState<'upload' | 'preview' | 'result'>('upload');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importError, setImportError] = useState('');
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const itemsQuery = useQuery({
    queryKey: ['catalog-items', { search: search.trim(), includeInactive: showInactive, page }],
    queryFn: async () => {
      const data = await api.get<{ data?: CatalogItem[]; pagination?: CatalogItemsPagination }>(
        '/v1/catalog-items',
        {
          ...(search.trim() ? { search: search.trim() } : {}),
          includeInactive: showInactive,
          page,
          pageSize: PAGE_SIZE,
        },
      );
      return {
        items: Array.isArray(data?.data) ? data.data : [],
        pagination: data?.pagination ?? null,
      };
    },
    placeholderData: keepPreviousData,
  });
  const items = useMemo(() => itemsQuery.data?.items ?? [], [itemsQuery.data]);
  const pagination = itemsQuery.data?.pagination ?? null;
  const totalPages = pagination?.totalPages ?? 1;
  const totalItems = pagination?.totalItems ?? items.length;

  useEffect(() => {
    setPage(1);
  }, [search, showInactive]);

  // Itens ativos com codigo fora do Forecast (selo "Fora do Forecast"); o painel usa a mesma consulta.
  const semForecastQuery = useQuery({
    queryKey: catalogForecastKeys.semForecast,
    queryFn: listCatalogoSemForecast,
    staleTime: 30_000,
  });
  const semForecastIds = useMemo(() => new Set((semForecastQuery.data ?? []).map((i) => i.id)), [semForecastQuery.data]);
  const vinc = useVinculoDoItem(form.dbcorpCode, editing);

  const familiesQuery = useQuery({
    queryKey: ['item-families', { includeInactive: false }],
    queryFn: async () => {
      const res = await api.get<{ data?: { id: number; name: string }[] }>('/v1/item-families', { includeInactive: false });
      return res?.data ?? [];
    },
  });
  const families = familiesQuery.data ?? [];

  const familyOptions = useMemo(() => {
    const options: { id: number; name: string; disabled?: boolean }[] = families.map((f) => ({
      id: f.id,
      name: f.name,
    }));
    const currentFamily = editing?.family;
    if (currentFamily && !families.some((f) => f.id === currentFamily.id)) {
      options.push({
        id: currentFamily.id,
        name: `${currentFamily.name} (inativa)`,
        disabled: true,
      });
    }
    return options;
  }, [families, editing]);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    vinc.limpar();
    setFeedback(null);
  }

  function openEdit(item: CatalogItem) {
    setEditing(item);
    setForm({
      commercialName: item.commercialName,
      marketName: item.marketName,
      ncm: item.ncm ?? '',
      dbcorpCode: item.dbcorpCode ?? '',
      familyId: item.familyId ?? '',
      notes: item.notes ?? '',
    });
    vinc.limpar();
    setFeedback(null);
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  const save = useMutation({
    mutationFn: async (vars: { id: number | null; payload: CatalogItemPayload; leadTimeDias: number | null }) => {
      leadTimeGravado.current = false;
      const forecast = vars.payload.forecast as { modo?: string; sourceId?: number } | undefined;
      // O lead time pertence a FONTE: grava antes do item (o backend recusa fonte sem lead time).
      if (vars.leadTimeDias !== null && forecast?.modo === 'novo' && typeof forecast.sourceId === 'number') {
        await patchForecastSourceLeadTime(forecast.sourceId, vars.leadTimeDias);
        leadTimeGravado.current = true;
      }
      return vars.id === null
        ? api.post<{ forecastVinculo?: CatalogForecastVinculo | null }>('/v1/catalog-items', vars.payload)
        : api.put<{ forecastVinculo?: CatalogForecastVinculo | null }>(`/v1/catalog-items/${vars.id}`, vars.payload);
    },
    onSuccess: (data, vars) => {
      qc.invalidateQueries({ queryKey: ['catalog-items'] });
      qc.invalidateQueries({ queryKey: ['forecast'] });
      const vinculado = mensagemVinculado(data?.forecastVinculo);
      const base = `Item "${vars.payload.commercialName}" ${vars.id === null ? 'criado' : 'atualizado'}.`;
      setFeedback({ kind: 'success', message: vinculado ? `${base} ${vinculado}` : base });
      if (vars.id === null) setForm(EMPTY_FORM);
      if (vars.id === null || vars.payload.forecast) vinc.limpar();
    },
    onError: (err) => {
      const prefixo = leadTimeGravado.current ? 'O lead time da fonte foi gravado, mas o item não foi salvo. ' : '';
      setFeedback({ kind: 'error', message: prefixo + messageOf(err) });
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.commercialName.trim() || !form.marketName.trim()) {
      setFeedback({ kind: 'error', message: 'Informe o nome comercial e o nome de mercado.' });
      return;
    }
    if (form.ncm && form.ncm.length !== 8) {
      setFeedback({ kind: 'error', message: 'O NCM deve ter 8 dígitos.' });
      return;
    }
    const validacao = vinc.validar();
    if (!validacao.ok) {
      setFeedback({ kind: 'error', message: validacao.erro });
      return;
    }
    setFeedback(null);
    const payload: CatalogItemPayload = {
      commercialName: form.commercialName.trim(),
      marketName: form.marketName.trim(),
      ncm: form.ncm.trim() || null,
      dbcorpCode: form.dbcorpCode.trim() || null,
      familyId: form.familyId !== '' ? Number(form.familyId) : null,
      notes: form.notes.trim() || null,
    };
    if (validacao.forecast) payload.forecast = validacao.forecast;
    save.mutate({ id: editing ? editing.id : null, payload, leadTimeDias: validacao.leadTimeDias });
  }

  const softDelete = useMutation({
    mutationFn: (item: CatalogItem) => api.del(`/v1/catalog-items/${item.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['catalog-items'] });
      setFeedback({ kind: 'success', message: 'Item inativado.' });
    },
    onError: (err) => setFeedback({ kind: 'error', message: messageOf(err) }),
  });

  const reactivate = useMutation({
    mutationFn: (item: CatalogItem) => api.put(`/v1/catalog-items/${item.id}`, { isActive: true }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['catalog-items'] });
      setFeedback({ kind: 'success', message: 'Item reativado.' });
    },
    onError: (err) => setFeedback({ kind: 'error', message: messageOf(err) }),
  });

  async function handleSoftDelete(item: CatalogItem) {
    // Inativar nao tira o codigo do Forecast (ele segue medindo venda e estoque do DBCorp).
    const noForecast = !!item.dbcorpCode && semForecastQuery.isSuccess && !semForecastIds.has(item.id);
    const aviso = noForecast ? ` O código DBCorp ${item.dbcorpCode} continua no Forecast.` : '';
    if (!(await confirm(`Inativar o item "${item.commercialName}"?${aviso}`))) return;
    softDelete.mutate(item);
  }

  async function handleReactivate(item: CatalogItem) {
    // Reativar item com codigo fora do Forecast exige o vinculo: abre o modal (o backend recusaria com 400).
    if (item.dbcorpCode && (await codigoLivreNoForecast(qc, item.dbcorpCode))) {
      setModalVinculo({ item, modo: 'reativar' });
      return;
    }
    reactivate.mutate(item);
  }

  function openImportModal() {
    setIsImportModalOpen(true);
    setImportStep('upload');
    setImportFile(null);
    setImportError('');
    setImportPreview(null);
    setImportResult(null);
  }

  function closeImportModal() {
    setIsImportModalOpen(false);
    if (importStep === 'result') {
      qc.invalidateQueries({ queryKey: ['catalog-items'] });
    }
  }

  const previewImport = useMutation({
    mutationFn: async (file: File) => {
      const contentBase64 = await readFileAsBase64(file);
      const res = await api.post<{ data: ImportPreview }>('/v1/catalog-items/import', { contentBase64 });
      return res.data;
    },
    onSuccess: (data) => {
      setImportPreview(data);
      setImportStep('preview');
    },
    onError: (err) => setImportError(messageOf(err) || 'Erro ao processar arquivo.'),
  });

  const confirmImport = useMutation({
    mutationFn: async () => {
      const res = await api.post<{ data: ImportResult }>('/v1/catalog-items/import/confirm', {
        items: importPreview?.validLines ?? [],
      });
      return res.data;
    },
    onSuccess: (data) => {
      setImportResult(data);
      setImportStep('result');
      qc.invalidateQueries({ queryKey: ['catalog-items'] });
    },
    onError: (err) => setImportError(messageOf(err) || 'Erro ao confirmar importação.'),
  });

  function handlePreviewImport() {
    if (!importFile) return;
    setImportError('');
    previewImport.mutate(importFile);
  }

  function handleConfirmImport() {
    if (!importPreview?.validLines.length) return;
    setImportError('');
    confirmImport.mutate();
  }

  return (
    <div className="page itens-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Catálogo</p>
          <h1>Itens</h1>
          <p className="page-subtitle">
            Catálogo de itens utilizado nas cotações. O nome comercial fica visível para o time
            interno; o nome de mercado é o que o fornecedor vê no portal.
          </p>
        </div>
        <div className="page-header__actions">
          <button type="button" className="ghost-button" onClick={openImportModal}>
            <Icon name="upload" size={16} strokeWidth={1.9} />
            Importar
          </button>
          <button type="button" className="primary-button" onClick={openCreate}>
            <Icon name="plus" size={16} strokeWidth={2.2} />
            Novo item
          </button>
        </div>
      </header>

      <section className="itens-filters" aria-label="Filtros do catálogo">
        <div className="itens-filters__search">
          <Icon name="search" size={16} strokeWidth={1.9} />
          <input
            type="search"
            placeholder="Buscar por nome comercial, de mercado, NCM ou código DBCorp"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Buscar item"
          />
        </div>
        <div className="itens-filters__stats" aria-live="polite">
          <span><strong>{totalItems}</strong> {totalItems === 1 ? 'item' : 'itens'} no total</span>
        </div>
        <label className={`itens-filters__toggle${showInactive ? ' itens-filters__toggle--active' : ''}`}>
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          Mostrar inativos
        </label>
      </section>

      {feedback && (
        <div
          role="status"
          className={`itens-page__alerta alert--${feedback.kind}`}
        >
          <Icon name={feedback.kind === 'success' ? 'check' : 'alert-triangle'} size={18} strokeWidth={feedback.kind === 'success' ? 2 : 1.9} />
          {feedback.message}
        </div>
      )}

      <ItensSemForecast onConcluido={(message) => setFeedback({ kind: 'success', message })} />

      <div className="itens-page__split">
        <section className="card itens-page__catalogo" aria-label="Lista de itens do catálogo">
          <div className="itens-page__catalogo-cabecalho">
              <h2>Catálogo</h2>
            <p>Clique em um cartão para editar.</p>
            </div>

          {itemsQuery.isLoading ? (
            <div className="itens-empty" role="status">
              <span className="btn-spinner" aria-hidden="true" />
              Carregando…
            </div>
          ) : itemsQuery.isError ? (
            <div role="alert" className="itens-empty itens-empty--erro">{messageOf(itemsQuery.error)}</div>
          ) : items.length === 0 ? (
            <div className="itens-empty">
              <strong>Nenhum item encontrado</strong>
              <p>
                {search.trim()
                  ? 'Tente ajustar a busca ou limpar os filtros.'
                  : 'Cadastre o primeiro item do catálogo para começar.'}
              </p>
            </div>
          ) : (
            <div className="itens-grid">
              {items.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={`itens-card${item.isActive ? '' : ' itens-card--inactive'}${editing?.id === item.id ? ' itens-card--editando' : ''}`}
                  onClick={() => openEdit(item)}
                  aria-label={`Editar item ${item.commercialName}`}
                >
                  <div className="itens-card__head">
                    <div className="itens-card__titulos">
                      <div className="itens-card__name">{item.commercialName}</div>
                      <div className="itens-card__market">{item.marketName}</div>
                    </div>
                    <div className="itens-card__badges">
                      <span
                        className={`badge itens-card__badge${item.isActive ? '' : ' badge--muted'}`}
                      >
                        {item.isActive ? 'Ativo' : 'Inativo'}
                      </span>
                      {semForecastIds.has(item.id) && (
                        <span
                          className="badge badge--muted itens-card__badge"
                          title="O código DBCorp deste item não está no Forecast: ele fica fora do cálculo."
                        >
                          Fora do Forecast
                        </span>
                      )}
                      {item.family && (
                        <span className="badge badge--muted itens-card__badge">
                          {item.family.name}
                        </span>
                      )}
                    </div>
                  </div>

                  {item.notes && <div className="itens-card__notes">{item.notes}</div>}

                  <div className="itens-card__rodape">
                  <div className="itens-card__meta">
                    {item.ncm && (
                      <span>NCM <strong>{item.ncm}</strong></span>
                    )}
                    {item.dbcorpCode && (
                      <span>DBCorp <strong>{item.dbcorpCode}</strong></span>
                    )}
                    {!item.ncm && !item.dbcorpCode && <span>Sem NCM nem DBCorp</span>}
                  </div>

                  <div className="itens-card__actions">
                    <span
                      role="button"
                      tabIndex={0}
                      className="itens-card__action"
                      onClick={(e) => {
                        e.stopPropagation();
                        openEdit(item);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          e.stopPropagation();
                          openEdit(item);
                        }
                      }}
                    >
                      Editar
                    </span>
                    {item.isActive && semForecastIds.has(item.id) && (
                      <span
                        role="button"
                        tabIndex={0}
                        className="itens-card__action"
                        onClick={(e) => {
                          e.stopPropagation();
                          setModalVinculo({ item, modo: 'vincular' });
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            e.stopPropagation();
                            setModalVinculo({ item, modo: 'vincular' });
                          }
                        }}
                      >
                        Vincular ao Forecast
                      </span>
                    )}
                    {item.isActive ? (
                      <span
                        role="button"
                        tabIndex={0}
                        className="itens-card__action itens-card__action--danger"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleSoftDelete(item);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            e.stopPropagation();
                            void handleSoftDelete(item);
                          }
                        }}
                      >
                        Inativar
                      </span>
                    ) : (
                      <span
                        role="button"
                        tabIndex={0}
                          className="itens-card__action itens-card__action--reativar"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleReactivate(item);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            e.stopPropagation();
                            void handleReactivate(item);
                          }
                        }}
                      >
                        Reativar
                      </span>
                    )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {!itemsQuery.isLoading && !itemsQuery.isError && items.length > 0 && totalPages > 1 && (
            <Pagination
              page={page}
              totalPages={totalPages}
              totalItems={totalItems}
              onPrevious={() => setPage((p) => Math.max(1, p - 1))}
              onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
            />
          )}
        </section>

        <aside className="card itens-form-card" aria-label="Formulário de item">
          <div className="itens-form__cabecalho">
            <span className="eyebrow">{editing ? 'Editando' : 'Novo'}</span>
            <h2>{editing ? editing.commercialName : 'Cadastrar item'}</h2>
          <p className="itens-form__hint">
            Preencha os dados abaixo. O NCM é validado com 8 dígitos e o nome de mercado
            deve ser único.
          </p>
          </div>
          <form className="itens-form" onSubmit={handleSubmit}>
            <label className="field">
              <span>Nome comercial *</span>
              <input
                type="text"
                className="input"
                value={form.commercialName}
                onChange={(e) => setForm({ ...form, commercialName: e.target.value })}
                placeholder="Ex.: Poliisobutileno TPO"
                required
              />
            </label>
            <label className="field">
              <span>Nome de mercado / fornecedor *</span>
              <input
                type="text"
                className="input"
                value={form.marketName}
                onChange={(e) => setForm({ ...form, marketName: e.target.value })}
                placeholder="Ex.: TPO PIB 3500"
                required
              />
            </label>
            <label className="field">
              <span>Família</span>
              <select
                className="input"
                value={form.familyId}
                onChange={(e) => setForm({ ...form, familyId: e.target.value ? Number(e.target.value) : '' })}
              >
                <option value="">Sem família</option>
                {familyOptions.map(f => (
                  <option key={f.id} value={f.id} disabled={f.disabled}>{f.name}</option>
                ))}
              </select>
            </label>
            <div className="itens-form__row">
              <label className="field">
                <span>NCM</span>
                <input
                  type="text"
                  className="input"
                  value={form.ncm}
                  onChange={(e) => setForm({ ...form, ncm: normalizeNcm(e.target.value) })}
                  placeholder="8 dígitos"
                  inputMode="numeric"
                  maxLength={8}
                />
              </label>
              <label className="field">
                <span>Código DBCorp</span>
                <input
                  type="text"
                  className="input"
                  value={form.dbcorpCode}
                  onChange={(e) => {
                    setForm({ ...form, dbcorpCode: e.target.value });
                    vinc.limpar();
                  }}
                  placeholder="Ex.: PI-TPO"
                />
              </label>
            </div>
            {vinc.aplicavel && (
              <ItemForecastVinculo
                codigo={form.dbcorpCode}
                exigido={vinc.codigoMudou}
                familiaDoItem={form.familyId === '' ? null : form.familyId}
                nomeSugerido={form.commercialName}
                valor={vinc.vinculo}
                onChange={vinc.setVinculo}
                erro={vinc.erro}
                desabilitado={save.isPending}
              />
            )}
            <label className="field">
              <span>Observações</span>
              <textarea
                className="textarea"
                rows={3}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Anotações internas, contexto, restrições…"
              />
            </label>
            <div className="itens-form__actions">
              {editing && (
                <button type="button" className="ghost-button" onClick={openCreate}>
                  Cancelar
                </button>
              )}
              <button type="submit" className="primary-button" disabled={save.isPending}>
                {save.isPending ? 'Salvando…' : editing ? 'Atualizar item' : 'Cadastrar item'}
              </button>
            </div>
          </form>
        </aside>
      </div>

      {modalVinculo && (
        <ItemVincularForecastModal
          item={modalVinculo.item}
          modo={modalVinculo.modo}
          onFechar={() => setModalVinculo(null)}
          onConcluido={(message) => {
            setModalVinculo(null);
            setFeedback({ kind: 'success', message });
          }}
        />
      )}

      <Modal isOpen={isImportModalOpen} onClose={closeImportModal} title="Importar Itens do Catálogo">
        <div className="import-modal-content importacao-itens">
          {importStep === 'upload' && (
            <div className="importacao-passo">
              <div className="importacao-introducao">
                <p className="importacao-texto">
                  Selecione uma planilha (xlsx) com as colunas na seguinte ordem:
              </p>
                <ol className="importacao-colunas">
                  <li>Nome Comercial</li>
                  <li>Nome de Mercado</li>
                  <li>NCM</li>
                  <li>Código DB</li>
                  <li>Família</li>
                  <li>
                    <span className="importacao-colunas__ignorada">
                      (coluna ignorada — DG agora é informado pelo fornecedor na resposta)
                    </span>
                  </li>
                  <li>Notas</li>
                </ol>
              </div>
              <label className="importacao-arquivo importacao-arquivo--itens">
              <input
                type="file"
                accept=".xlsx"
                ref={fileInputRef}
                onChange={(e) => setImportFile(e.target.files?.[0] || null)}
                  className="importacao-arquivo__input"
              />
                <span className="importacao-arquivo__icone">
                  <Icon name="file-text" size={20} strokeWidth={1.9} />
                </span>
                <span className="importacao-arquivo__botao">Escolher arquivo</span>
                <span className="importacao-arquivo__nome importacao-mono">
                  {importFile ? importFile.name : 'Nenhum arquivo escolhido'}
                </span>
              </label>
              {importError && (
                <div
                  role="alert"
                  className="importacao-alerta alert--error"
                >
                  <Icon name="alert-triangle" size={18} strokeWidth={1.9} />
                  <div className="importacao-alerta__corpo">{importError}</div>
                </div>
              )}
              <div className="modal-actions">
                <button type="button" className="ghost-button" onClick={closeImportModal} disabled={previewImport.isPending}>Cancelar</button>
                <button type="button" className="primary-button" onClick={handlePreviewImport} disabled={!importFile || previewImport.isPending}>
                  <Icon name="upload" size={16} strokeWidth={1.9} />
                  {previewImport.isPending ? 'Processando...' : 'Carregar e Validar'}
                </button>
              </div>
            </div>
          )}

          {importStep === 'preview' && importPreview && (
            <div className="importacao-passo">
              <p className="importacao-resumo">
                Encontramos <strong className="importacao-resumo__ok">{importPreview.validLines.length}</strong> itens válidos e <strong className="importacao-resumo__erro">{importPreview.errorLines.length}</strong> linhas com erro.
              </p>
              
              {importPreview.errorLines.length > 0 && (
                <div
                  role="alert"
                  className="importacao-alerta alert--error"
                >
                  <Icon name="alert-triangle" size={18} strokeWidth={1.9} />
                  <div className="importacao-alerta__corpo">
                    <strong className="importacao-alerta__titulo">Linhas com erro (serão ignoradas):</strong>
                    <ul className="importacao-alerta__lista">
                    {importPreview.errorLines.map((e, idx) => (
                        <li key={idx}>Linha <span className="importacao-mono">{e.row}</span>: {e.reason}</li>
                    ))}
                  </ul>
                  </div>
                </div>
              )}

              {(importPreview.warnings?.length ?? 0) > 0 && (
                <div
                  role="status"
                  className="importacao-alerta alert--warning"
                >
                  <Icon name="info" size={18} strokeWidth={1.9} />
                  <div className="importacao-alerta__corpo">
                    <strong className="importacao-alerta__titulo">Avisos:</strong>
                    <ul className="importacao-alerta__lista">
                    {importPreview.warnings?.map((w, idx) => (
                      <li key={idx}>{w}</li>
                    ))}
                  </ul>
                </div>
                </div>
              )}

              {importError && (
                <div
                  role="alert"
                  className="importacao-alerta alert--error"
                >
                  <Icon name="alert-triangle" size={18} strokeWidth={1.9} />
                  <div className="importacao-alerta__corpo">{importError}</div>
                </div>
              )}

              <div className="modal-actions">
                <button type="button" className="ghost-button" onClick={() => setImportStep('upload')} disabled={confirmImport.isPending}>Voltar</button>
                <button type="button" className="primary-button" onClick={handleConfirmImport} disabled={importPreview.validLines.length === 0 || confirmImport.isPending}>
                  {confirmImport.isPending ? 'Importando...' : 'Confirmar Importação'}
                </button>
              </div>
            </div>
          )}

          {importStep === 'result' && importResult && (
            <div className="importacao-passo">
              <div
                role="status"
                className="importacao-alerta importacao-alerta--centro alert--success"
              >
                <Icon name="check" size={18} strokeWidth={2} />
                <span>
                  <strong className="importacao-mono">{importResult.successLines.length}</strong> itens importados com sucesso!
                </span>
              </div>

              <p className="importacao-texto">
                Itens com código DBCorp fora do Forecast aparecem em "Catálogo sem Forecast" para vincular.
              </p>

              {importResult.errorLines.length > 0 && (
                <div
                  role="alert"
                  className="importacao-alerta alert--error"
                >
                  <Icon name="alert-triangle" size={18} strokeWidth={1.9} />
                  <div className="importacao-alerta__corpo">
                    <strong className="importacao-alerta__titulo">Erros ao salvar no banco:</strong>
                    <ul className="importacao-alerta__lista">
                    {importResult.errorLines.map((e, idx) => (
                        <li key={idx}>Linha <span className="importacao-mono">{e.row}</span>: {e.reason}</li>
                    ))}
                  </ul>
                </div>
                </div>
              )}

              <div className="modal-actions">
                <button type="button" className="primary-button" onClick={closeImportModal}>Concluir</button>
              </div>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
