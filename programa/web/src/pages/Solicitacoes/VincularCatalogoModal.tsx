import { FormEvent, useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/api/client';
import { CatalogItemPicker, PickerCatalogItem } from '@/components/CatalogItemPicker';
import { Icon } from '@/components/icons';
import { Modal } from '@/components/Modal';
import { useCatalogItemPickerData } from '@/components/useCatalogItemPickerData';
import {
  CommercialRequestForComex,
  CommercialRequestItemForComex,
  linkCommercialRequestItemToCatalog,
} from '@/services/commercialRequests';

type Tab = 'select' | 'create';

const NCM_PATTERN = /^\d{8}$/;

function messageOf(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body as { message?: unknown } | null;
    if (body && typeof body.message === 'string') return body.message;
    return err.message;
  }
  return err instanceof Error ? err.message : 'Erro desconhecido.';
}

interface Props {
  request: CommercialRequestForComex;
  item: CommercialRequestItemForComex;
  onClose: () => void;
}

// Comex: vincula um item NOVO (digitado pelo comercial) ao catalogo, antes de cotar.
// Aba 1: escolhe um item existente. Aba 2: cadastra um item novo no catalogo e vincula.
export function VincularCatalogoModal({ request, item, onClose }: Props) {
  const qc = useQueryClient();
  const picker = useCatalogItemPickerData(true);
  const proposedName = item.proposedName ?? item.commercialName;

  const [tab, setTab] = useState<Tab>('select');
  const [selected, setSelected] = useState<PickerCatalogItem | null>(null);
  const [commercialName, setCommercialName] = useState(proposedName);
  const [marketName, setMarketName] = useState('');
  const [ncm, setNcm] = useState('');
  const [error, setError] = useState<string | null>(null);

  // A busca ja abre com o nome digitado pelo comercial (so uma vez).
  const { setSearch } = picker;
  useEffect(() => {
    setSearch(proposedName);
  }, [proposedName, setSearch]);

  const link = useMutation({
    mutationFn: (catalogItemId: number) =>
      linkCommercialRequestItemToCatalog(request.id, item.id, catalogItemId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['commercial-requests'] });
      onClose();
    },
    onError: (err) => setError(messageOf(err)),
  });

  // Cadastra no catalogo e vincula. Se o vinculo falhar depois do cadastro, o item recem-criado
  // fica selecionado na aba "Selecionar existente" para tentar de novo sem recadastrar.
  const createAndLink = useMutation({
    mutationFn: async () => {
      const trimmedNcm = ncm.trim();
      const created = await api.post<{
        id: number;
        commercialName: string;
        marketName: string;
        family?: { id: number; name: string } | null;
      }>('/v1/catalog-items', {
        commercialName: commercialName.trim(),
        marketName: marketName.trim(),
        ...(trimmedNcm !== '' ? { ncm: trimmedNcm } : {}),
      });
      try {
        await linkCommercialRequestItemToCatalog(request.id, item.id, created.id);
      } catch (linkError) {
        setSelected({
          id: created.id,
          commercialName: created.commercialName,
          marketName: created.marketName,
          family: created.family ?? null,
        });
        setTab('select');
        throw new Error(
          `O item foi cadastrado no catálogo, mas o vínculo falhou: ${messageOf(linkError)} Ele está selecionado: tente vincular de novo.`,
        );
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['commercial-requests'] });
      onClose();
    },
    onError: (err) => setError(messageOf(err)),
  });

  const trimmedNcm = ncm.trim();
  const ncmInvalid = trimmedNcm !== '' && !NCM_PATTERN.test(trimmedNcm);
  const canCreate =
    commercialName.trim() !== '' && marketName.trim() !== '' && !ncmInvalid && !createAndLink.isPending;

  function handleCreate(event: FormEvent) {
    event.preventDefault();
    if (!canCreate) return;
    setError(null);
    createAndLink.mutate();
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`Vincular "${proposedName}" ao catálogo`}
      subtitle={`Solicitação #${request.id}. O item precisa estar no catálogo antes de entrar em uma cotação.`}
      size="wide"
    >
      <div className="vincular-catalogo">
        <div className="vincular-catalogo__modo" role="group" aria-label="Modo">
          <button
            type="button"
            className="vincular-catalogo__aba"
            aria-pressed={tab === 'select'}
            onClick={() => setTab('select')}
          >
            Selecionar existente
          </button>
          <button
            type="button"
            className="vincular-catalogo__aba"
            aria-pressed={tab === 'create'}
            onClick={() => setTab('create')}
          >
            Cadastrar e vincular
          </button>
        </div>

        {tab === 'select' ? (
          <div className="vincular-catalogo__painel">
            <CatalogItemPicker
              families={picker.families}
              familyItems={picker.familyItems}
              expanded={picker.expanded}
              onToggleFamily={picker.toggleFamily}
              isSearching={picker.isSearching}
              searchItems={picker.searchItems}
              selectedId={selected?.id ?? null}
              onSelect={(catalogItem) => {
                setSelected(catalogItem);
                setError(null);
              }}
              search={picker.search}
              onSearchChange={picker.setSearch}
              selectedItem={selected}
            />
            {error && (
              <p role="alert" className="solicitacoes-alerta alert--error">
                <Icon name="alert-triangle" size={18} strokeWidth={1.9} />
                {error}
              </p>
            )}
            <div className="modal-actions">
              <button type="button" className="ghost-button" onClick={onClose}>
                Cancelar
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={!selected || link.isPending}
                onClick={() => {
                  if (!selected) return;
                  setError(null);
                  link.mutate(selected.id);
                }}
              >
                {link.isPending ? 'Vinculando…' : 'Vincular'}
              </button>
            </div>
          </div>
        ) : (
          <form className="vincular-catalogo__painel" onSubmit={handleCreate}>
            <div className="vincular-catalogo__campos">
              <div>
                <label className="field-label" htmlFor="cr-vinc-commercial">Nome comercial *</label>
                <input
                  id="cr-vinc-commercial"
                  className="input"
                  value={commercialName}
                  maxLength={200}
                  onChange={(e) => setCommercialName(e.target.value)}
                />
              </div>
              <div>
                <label className="field-label" htmlFor="cr-vinc-market">Nome de mercado *</label>
                <input
                  id="cr-vinc-market"
                  className="input"
                  value={marketName}
                  maxLength={200}
                  onChange={(e) => setMarketName(e.target.value)}
                />
              </div>
              <div>
                <label className="field-label" htmlFor="cr-vinc-ncm">NCM (opcional)</label>
                <input
                  id="cr-vinc-ncm"
                  className="input"
                  inputMode="numeric"
                  maxLength={8}
                  placeholder="8 dígitos"
                  aria-invalid={ncmInvalid || undefined}
                  value={ncm}
                  onChange={(e) => setNcm(e.target.value)}
                />
                {ncmInvalid && (
                  <p role="alert" className="field-error vincular-catalogo__ncm">
                    NCM inválido. Use 8 dígitos.
                  </p>
                )}
              </div>
            </div>
            {error && (
              <p role="alert" className="solicitacoes-alerta alert--error">
                <Icon name="alert-triangle" size={18} strokeWidth={1.9} />
                {error}
              </p>
            )}
            <div className="modal-actions">
              <button type="button" className="ghost-button" onClick={onClose}>
                Cancelar
              </button>
              <button type="submit" className="primary-button" disabled={!canCreate}>
                {createAndLink.isPending ? 'Cadastrando…' : 'Cadastrar e vincular'}
              </button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
}
