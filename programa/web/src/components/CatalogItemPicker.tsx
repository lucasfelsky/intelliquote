import { useMemo, useState } from 'react';

export interface PickerCatalogItem {
  id: number;
  commercialName: string;
  marketName: string;
  isDangerousGood: boolean;
  family: { id: number; name: string } | null;
}

interface CatalogItemPickerProps {
  items: PickerCatalogItem[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  search: string;
  onSearchChange: (value: string) => void;
  selectedItem?: PickerCatalogItem | null;
  disabled?: boolean;
  children?: React.ReactNode;
}

export function CatalogItemPicker({
  items,
  selectedId,
  onSelect,
  search,
  onSearchChange,
  selectedItem: selectedItemProp,
  disabled,
  children,
}: CatalogItemPickerProps) {
  const grouped = useMemo(() => {
    // Agrupar via reduce (busca por termo é feita no servidor)
    const groups = items.reduce<Record<string, PickerCatalogItem[]>>((acc, item) => {
      const groupName = item.family?.name || 'Sem família';
      if (!acc[groupName]) {
        acc[groupName] = [];
      }
      acc[groupName].push(item);
      return acc;
    }, {});

    // Retorna ordenado: chaves em ordem alfabetica (com "Sem família" no final)
    const sortedKeys = Object.keys(groups).sort((a, b) => {
      if (a === 'Sem família') return 1;
      if (b === 'Sem família') return -1;
      return a.localeCompare(b);
    });

    return sortedKeys.map(key => ({
      family: key,
      items: groups[key] as PickerCatalogItem[]
    }));
  }, [items]);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const effectiveExpanded = useMemo(() => {
    if (search.trim()) {
      return new Set(grouped.map((group) => group.family));
    }
    return expanded;
  }, [search, grouped, expanded]);

  const toggleFamily = (familyName: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(familyName)) {
        next.delete(familyName);
      } else {
        next.add(familyName);
      }
      return next;
    });
  };

  const selectedItem = selectedItemProp ?? items.find(i => i.id === selectedId);

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

      {/* DIREITA: resultados agrupados por família */}
      {!disabled && (
        <div style={{
          border: '1px solid var(--border)',
          borderRadius: 8,
          background: 'var(--surface)',
          maxHeight: 420,
          overflowY: 'auto',
          padding: 8,
        }}>
          {grouped.length === 0 ? (
            <div style={{ padding: 16, textAlign: 'center', color: 'var(--ink-soft)', fontSize: 13 }}>
              Nenhum item encontrado.
            </div>
          ) : (
            grouped.map((group) => {
              const isOpen = effectiveExpanded.has(group.family);
              return (
              <div key={group.family} style={{ marginBottom: 8 }}>
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => toggleFamily(group.family)}
                  style={{
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
                  }}
                >
                  <span>
                    <span aria-hidden="true" style={{ display: 'inline-block', width: 12 }}>
                      {isOpen ? '▾' : '▸'}
                    </span>
                    {group.family}
                  </span>
                  <span style={{ fontWeight: 400, color: 'var(--ink-soft)' }}>
                    {group.items.length}
                  </span>
                </button>
                {isOpen && (
                <div>
                  {group.items.map((item) => {
                    const isSelected = item.id === selectedId;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        disabled={disabled}
                        onClick={() => onSelect(item.id)}
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
                  })}
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
