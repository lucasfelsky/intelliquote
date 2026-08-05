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
}

export function CatalogItemPicker({ items, selectedId, onSelect, disabled }: CatalogItemPickerProps) {
  const [search, setSearch] = useState('');
  
  const filteredAndGrouped = useMemo(() => {
    const term = search.toLowerCase().trim();
    
    // 1. Filtrar
    const filtered = items.filter((item) => {
      if (!term) return true;
      return (
        item.commercialName.toLowerCase().includes(term) ||
        item.marketName.toLowerCase().includes(term)
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

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  function toggleGroup(group: string) {
    setExpanded(curr => ({ ...curr, [group]: !curr[group] }));
  }

  // Pre-expandir os grupos caso houver busca ativa, senao deixa o default
  const activeExpanded = useMemo(() => {
    if (search.trim()) {
      const obj: Record<string, boolean> = {};
      filteredAndGrouped.forEach(g => obj[g.family] = true);
      return obj;
    }
    return expanded;
  }, [search, expanded, filteredAndGrouped]);

  const selectedItem = items.find(i => i.id === selectedId);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {disabled && selectedItem ? (
        <div style={{ 
          padding: '10px 12px', 
          background: 'var(--surface)', 
          border: '1px solid var(--border)', 
          borderRadius: 4, 
          color: 'var(--ink-soft)' 
        }}>
          {selectedItem.commercialName} — {selectedItem.marketName}
          {selectedItem.isDangerousGood && ' (DG)'}
        </div>
      ) : (
        <div style={{ border: '1px solid var(--border)', borderRadius: 4, overflow: 'hidden' }}>
          <div style={{ padding: 8, background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
            <input
              type="text"
              className="input"
              style={{ width: '100%' }}
              placeholder="Buscar item do catálogo..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              disabled={disabled}
            />
          </div>
          
          <div style={{ maxHeight: 300, overflowY: 'auto', background: 'var(--surface)' }}>
            {filteredAndGrouped.length === 0 ? (
              <div style={{ padding: 16, textAlign: 'center', color: 'var(--ink-soft)', fontSize: 13 }}>
                Nenhum item encontrado.
              </div>
            ) : (
              filteredAndGrouped.map((group) => {
                const isOpen = activeExpanded[group.family] ?? false;
                return (
                  <div key={group.family}>
                    <button
                      type="button"
                      onClick={() => toggleGroup(group.family)}
                      aria-expanded={isOpen}
                      disabled={disabled}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        width: '100%',
                        background: 'var(--surface)',
                        border: 'none',
                        borderBottom: '1px solid var(--border)',
                        padding: '8px 12px',
                        cursor: disabled ? 'not-allowed' : 'pointer',
                        color: 'var(--primary-700)',
                        fontSize: 13,
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        letterSpacing: 0.5,
                      }}
                    >
                      <span>{group.family} ({group.items.length})</span>
                      <span aria-hidden style={{ fontSize: 16, lineHeight: 1 }}>
                        {isOpen ? '−' : '+'}
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
                                padding: '10px 12px',
                                border: 'none',
                                borderBottom: '1px solid var(--border)',
                                background: isSelected ? 'var(--primary-50)' : 'var(--surface)',
                                cursor: disabled ? 'not-allowed' : 'pointer',
                                color: isSelected ? 'var(--primary-700)' : 'var(--ink)',
                                fontSize: 13,
                              }}
                            >
                              <div style={{ fontWeight: isSelected ? 600 : 400 }}>
                                {item.commercialName} — {item.marketName}
                                {item.isDangerousGood && (
                                  <span style={{ 
                                    marginLeft: 6, 
                                    fontSize: 11, 
                                    background: 'var(--danger)', 
                                    color: 'var(--surface)',
                                    padding: '2px 4px', 
                                    borderRadius: 4 
                                  }}>
                                    DG
                                  </span>
                                )}
                              </div>
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
        </div>
      )}
    </div>
  );
}
