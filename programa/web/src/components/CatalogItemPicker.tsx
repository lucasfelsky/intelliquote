import { useMemo } from 'react';

export interface PickerCatalogItem {
  id: number;
  commercialName: string;
  marketName: string;
  isDangerousGood: boolean;
  family: { id: number; name: string } | null;
}

export interface PickerFamilySummary {
  id: number;
  name: string;
}

export interface PickerFamilyItemsEntry {
  items: PickerCatalogItem[];
  isLoading: boolean;
  total: number;
}

interface CatalogItemPickerProps {
  families: PickerFamilySummary[];
  familyItems: Map<number, PickerFamilyItemsEntry>;
  expanded: Set<number>;
  onToggleFamily: (id: number) => void;
  isSearching: boolean;
  searchItems: PickerCatalogItem[];
  selectedId: number | null;
  onSelect: (item: PickerCatalogItem) => void;
  search: string;
  onSearchChange: (value: string) => void;
  selectedItem?: PickerCatalogItem | null;
  disabled?: boolean;
  children?: React.ReactNode;
}

const headerButtonStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  width: '100%',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: 0.5,
  textTransform: 'uppercase',
  color: 'var(--primary)',
  padding: '6px 8px',
  background: 'none',
  border: 'none',
  cursor: 'pointer',
};

function ItemButton({
  item,
  isSelected,
  disabled,
  onSelect,
}: {
  item: PickerCatalogItem;
  isSelected: boolean;
  disabled?: boolean;
  onSelect: (item: PickerCatalogItem) => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onSelect(item)}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        padding: '10px 8px',
        border: 'none',
        borderRadius: 6,
        background: isSelected ? 'var(--primary-50)' : 'var(--surface)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        color: isSelected ? 'var(--primary-700)' : 'var(--ink)',
        fontSize: 13,
      }}
    >
      <span style={{ fontWeight: isSelected ? 600 : 400 }}>
        {item.commercialName}
        {item.isDangerousGood && (
          <span style={{
            marginLeft: 6,
            fontSize: 11,
            background: 'var(--danger)',
            color: 'var(--surface)',
            padding: '2px 4px',
            borderRadius: 4,
          }}>
            DG
          </span>
        )}
      </span>
    </button>
  );
}

export function CatalogItemPicker({
  families,
  familyItems,
  expanded,
  onToggleFamily,
  isSearching,
  searchItems,
  selectedId,
  onSelect,
  search,
  onSearchChange,
  selectedItem: selectedItemProp,
  disabled,
  children,
}: CatalogItemPickerProps) {
  // MODO BUSCA: agrupar os resultados globais por família, sempre expandidos.
  const searchGroups = useMemo(() => {
    const groups = searchItems.reduce<Record<string, PickerCatalogItem[]>>((acc, item) => {
      const groupName = item.family?.name || 'Sem família';
      if (!acc[groupName]) {
        acc[groupName] = [];
      }
      acc[groupName].push(item);
      return acc;
    }, {});

    const sortedKeys = Object.keys(groups).sort((a, b) => {
      if (a === 'Sem família') return 1;
      if (b === 'Sem família') return -1;
      return a.localeCompare(b);
    });

    return sortedKeys.map((key) => ({
      family: key,
      items: groups[key] as PickerCatalogItem[],
    }));
  }, [searchItems]);

  const selectedItem = selectedItemProp ?? null;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
      {/* ESQUERDA: busca + resumo do item selecionado + children (campos do formulário) */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {disabled && selectedItem ? (
          <div style={{
            padding: '10px 12px',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 4,
            color: 'var(--ink-soft)',
          }}>
            {selectedItem.commercialName}
            {selectedItem.isDangerousGood && ' (DG)'}
          </div>
        ) : (
          <>
            <div>
              <label className="field-label" htmlFor="catalogItemSearch">Item *</label>
              <input
                id="catalogItemSearch"
                type="text"
                className="input"
                style={{ width: '100%' }}
                placeholder="Buscar item do catálogo..."
                value={search}
                onChange={(e) => onSearchChange(e.target.value)}
              />
            </div>

            {selectedItem && (
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
                padding: '10px 12px',
                background: 'var(--primary-50)',
                border: '1px solid var(--border)',
                borderRadius: 8,
              }}>
                <strong style={{ fontSize: 14 }}>
                  {selectedItem.commercialName}
                  {selectedItem.isDangerousGood && (
                    <span style={{
                      marginLeft: 6,
                      fontSize: 11,
                      background: 'var(--danger)',
                      color: 'var(--surface)',
                      padding: '2px 4px',
                      borderRadius: 4,
                    }}>
                      DG
                    </span>
                  )}
                </strong>
                <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
                  Família: {selectedItem.family?.name ?? 'Sem família'}
                </span>
              </div>
            )}
          </>
        )}

        {children}
      </div>

      {/* DIREITA: modo busca (resultados agrupados, auto-expandidos) ou modo navegar (pastas lazy) */}
      {!disabled && (
        <div style={{
          border: '1px solid var(--border)',
          borderRadius: 8,
          background: 'var(--surface)',
          maxHeight: 420,
          overflowY: 'auto',
          padding: 8,
        }}>
          {isSearching ? (
            searchGroups.length === 0 ? (
              <div style={{ padding: 16, textAlign: 'center', color: 'var(--ink-soft)', fontSize: 13 }}>
                Nenhum item encontrado.
              </div>
            ) : (
              searchGroups.map((group) => (
                <div key={group.family} style={{ marginBottom: 8 }}>
                  <button type="button" aria-expanded="true" style={headerButtonStyle}>
                    <span>
                      <span aria-hidden="true" style={{ display: 'inline-block', width: 12 }}>▾</span>
                      {group.family}
                    </span>
                    <span style={{ fontWeight: 400, color: 'var(--ink-soft)' }}>{group.items.length}</span>
                  </button>
                  <div>
                    {group.items.map((item) => (
                      <ItemButton
                        key={item.id}
                        item={item}
                        isSelected={item.id === selectedId}
                        disabled={disabled}
                        onSelect={onSelect}
                      />
                    ))}
                  </div>
                </div>
              ))
            )
          ) : families.length === 0 ? (
            <div style={{ padding: 16, textAlign: 'center', color: 'var(--ink-soft)', fontSize: 13 }}>
              Nenhuma família cadastrada.
            </div>
          ) : (
            families.map((family) => {
              const isOpen = expanded.has(family.id);
              const entry = familyItems.get(family.id);
              return (
                <div key={family.id} style={{ marginBottom: 8 }}>
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => onToggleFamily(family.id)}
                    style={headerButtonStyle}
                  >
                    <span>
                      <span aria-hidden="true" style={{ display: 'inline-block', width: 12 }}>
                        {isOpen ? '▾' : '▸'}
                      </span>
                      {family.name}
                    </span>
                    <span style={{ fontWeight: 400, color: 'var(--ink-soft)' }}>
                      {entry && !entry.isLoading ? entry.total : ''}
                    </span>
                  </button>
                  {isOpen && (
                    <div>
                      {!entry || entry.isLoading ? (
                        <div style={{ padding: '8px 8px', color: 'var(--ink-soft)', fontSize: 13 }}>
                          Carregando…
                        </div>
                      ) : entry.items.length === 0 ? (
                        <div style={{ padding: '8px 8px', color: 'var(--ink-soft)', fontSize: 13 }}>
                          Nenhum item nesta família.
                        </div>
                      ) : (
                        <>
                          {entry.items.map((item) => (
                            <ItemButton
                              key={item.id}
                              item={item}
                              isSelected={item.id === selectedId}
                              disabled={disabled}
                              onSelect={onSelect}
                            />
                          ))}
                          {entry.total > entry.items.length && (
                            <div style={{ padding: '6px 8px', color: 'var(--ink-soft)', fontSize: 12 }}>
                              +{entry.total - entry.items.length} — refine pela busca
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
