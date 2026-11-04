import { useMemo } from 'react';
import { Icon } from './icons';

export interface PickerCatalogItem {
  id: number;
  commercialName: string;
  marketName: string;
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
      className="item-picker__item"
      aria-pressed={isSelected}
      disabled={disabled}
      onClick={() => onSelect(item)}
    >
      {item.commercialName}
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
    <div className={disabled ? 'item-picker item-picker--readonly' : 'item-picker'}>
      {/* ESQUERDA: busca + resumo do item selecionado + children (campos do formulário) */}
      <div className="item-picker__main">
        {disabled && selectedItem ? (
          <div className="item-picker__current">
            <span className="field-label" id="itemCurrentLabel">Item</span>
            <span className="item-picker__current-name">
              {selectedItem.commercialName}
            </span>
            <span className="item-picker__current-hint">
              O produto não muda na edição. Para trocar, remova este item e adicione outro.
            </span>
          </div>
        ) : (
          <>
            <div>
              <label className="field-label" htmlFor="catalogItemSearch">Item *</label>
              <div className="item-picker__busca">
                <Icon name="search" size={16} />
                <input
                  id="catalogItemSearch"
                  type="text"
                  className="item-picker__campo"
                  placeholder="Buscar item do catálogo..."
                  value={search}
                  onChange={(e) => onSearchChange(e.target.value)}
                />
              </div>
            </div>

            {selectedItem && (
              <div className="item-picker__selecionado">
                <span className="item-picker__selecionado-icone">
                  <Icon name="check" size={16} strokeWidth={2.4} />
                </span>
                <span className="item-picker__selecionado-texto">
                  <strong>{selectedItem.commercialName}</strong>
                  <span className="item-picker__selecionado-familia">
                    Família: {selectedItem.family?.name ?? 'Sem família'}
                  </span>
                </span>
              </div>
            )}
          </>
        )}

        {children}
      </div>

      {/* DIREITA: modo busca (resultados agrupados, auto-expandidos) ou modo navegar (pastas lazy) */}
      {!disabled && (
        <div className={isSearching ? 'item-picker__browser item-picker__browser--busca' : 'item-picker__browser'}>
          {isSearching ? (
            searchGroups.length === 0 ? (
              <div className="item-picker__estado item-picker__estado--vazio">
                Nenhum item encontrado.
              </div>
            ) : (
              searchGroups.map((group) => (
                <div key={group.family}>
                  <button type="button" className="item-picker__familia" aria-expanded="true">
                    <span className="item-picker__familia-nome">
                      <Icon name="chevron-down" size={12} strokeWidth={2.4} />
                      {group.family}
                    </span>
                    <span className="item-picker__contagem">{group.items.length}</span>
                  </button>
                  <div className="item-picker__itens">
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
            <div className="item-picker__estado item-picker__estado--vazio">
              Nenhuma família cadastrada.
            </div>
          ) : (
            families.map((family) => {
              const isOpen = expanded.has(family.id);
              const entry = familyItems.get(family.id);
              return (
                <div key={family.id}>
                  <button
                    type="button"
                    className="item-picker__familia"
                    aria-expanded={isOpen}
                    onClick={() => onToggleFamily(family.id)}
                  >
                    <span className="item-picker__familia-nome">
                      <Icon name={isOpen ? 'chevron-down' : 'chevron-right'} size={12} strokeWidth={2.4} />
                      {family.name}
                    </span>
                    <span className="item-picker__contagem">
                      {entry && !entry.isLoading ? entry.total : ''}
                    </span>
                  </button>
                  {isOpen && (
                    <div className="item-picker__itens">
                      {!entry || entry.isLoading ? (
                        <div className="item-picker__estado" role="status">
                          <span className="btn-spinner item-picker__spinner" aria-hidden="true" />
                          Carregando…
                        </div>
                      ) : entry.items.length === 0 ? (
                        <div className="item-picker__estado">
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
                            <div className="item-picker__mais">
                              <span className="item-picker__mais-num">+{entry.total - entry.items.length}</span> — refine pela busca
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
