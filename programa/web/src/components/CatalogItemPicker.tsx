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
  disabled?: boolean;
  children?: React.ReactNode;
}

export function CatalogItemPicker({ items, selectedId, onSelect, disabled, children }: CatalogItemPickerProps) {
  const [search, setSearch] = useState('');

  const filteredAndGrouped = useMemo(() => {
    const term = search.toLowerCase().trim();

    // 1. Filtrar por nome comercial OU nome da família
    const filtered = items.filter((item) => {
      if (!term) return true;
      return (
        item.commercialName.toLowerCase().includes(term) ||
        (item.family?.name.toLowerCase().includes(term) ?? false)
      );
    });

    // 2. Agrupar via reduce
    const grouped = filtered.reduce<Record<string, PickerCatalogItem[]>>((acc, item) => {
      const groupName = item.family?.name || 'Sem família';
      if (!acc[groupName]) {
        acc[groupName] = [];
      }
      acc[groupName].push(item);
      return acc;
    }, {});

    // Retorna ordenado: chaves em ordem alfabetica (com "Sem família" no final)
    const sortedKeys = Object.keys(grouped).sort((a, b) => {
      if (a === 'Sem família') return 1;
      if (b === 'Sem família') return -1;
      return a.localeCompare(b);
    });

    return sortedKeys.map(key => ({
      family: key,
      items: grouped[key] as PickerCatalogItem[]
    }));
  }, [items, search]);

  const selectedItem = items.find(i => i.id === selectedId);

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
                onChange={(e) => setSearch(e.target.value)}
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
          {filteredAndGrouped.length === 0 ? (
            <div style={{ padding: 16, textAlign: 'center', color: 'var(--ink-soft)', fontSize: 13 }}>
              Nenhum item encontrado.
            </div>
          ) : (
            filteredAndGrouped.map((group) => (
              <div key={group.family} style={{ marginBottom: 8 }}>
                <div style={{
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: 0.5,
                  textTransform: 'uppercase',
                  color: 'var(--primary)',
                  padding: '6px 8px',
                }}>
                  {group.family}
                </div>
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
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
