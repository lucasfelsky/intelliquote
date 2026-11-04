import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import {
  CatalogItemPicker,
  type PickerCatalogItem,
  type PickerFamilyItemsEntry,
  type PickerFamilySummary,
} from './CatalogItemPicker';

// Dados sinteticos.
const FAMILIAS: PickerFamilySummary[] = [
  { id: 1, name: 'Acidulantes' },
  { id: 2, name: 'Embalagens' },
  { id: 3, name: 'Conservantes' },
];

const item = (id: number, commercialName: string, family: string | null): PickerCatalogItem => ({
  id,
  commercialName,
  marketName: `${commercialName} (mercado)`,
  family: family ? { id: id * 10, name: family } : null,
});

const ACIDO = item(1, 'Ácido cítrico anidro', 'Acidulantes');

interface Opcoes {
  expanded?: number[];
  familyItems?: Array<[number, PickerFamilyItemsEntry]>;
  isSearching?: boolean;
  searchItems?: PickerCatalogItem[];
  families?: PickerFamilySummary[];
  selectedId?: number | null;
  selectedItem?: PickerCatalogItem | null;
  disabled?: boolean;
  onToggleFamily?: (id: number) => void;
  onSelect?: (item: PickerCatalogItem) => void;
}

function renderPicker(o: Opcoes = {}) {
  return render(
    <CatalogItemPicker
      families={o.families ?? FAMILIAS}
      familyItems={new Map(o.familyItems ?? [])}
      expanded={new Set(o.expanded ?? [])}
      onToggleFamily={o.onToggleFamily ?? vi.fn()}
      isSearching={o.isSearching ?? false}
      searchItems={o.searchItems ?? []}
      selectedId={o.selectedId ?? null}
      onSelect={o.onSelect ?? vi.fn()}
      search=""
      onSearchChange={vi.fn()}
      selectedItem={o.selectedItem ?? null}
      disabled={o.disabled}
    />,
  );
}

describe('CatalogItemPicker', () => {
  it('familias: botao com aria-expanded, chevron aria-hidden (direita fechada, baixo aberta) e sem os glifos antigos', () => {
    const { container } = renderPicker({
      expanded: [1],
      familyItems: [[1, { items: [ACIDO], isLoading: false, total: 1 }]],
    });
    const aberta = screen.getByRole('button', { name: /Acidulantes/ });
    const fechada = screen.getByRole('button', { name: /Embalagens/ });
    expect(aberta.getAttribute('aria-expanded')).toBe('true');
    expect(fechada.getAttribute('aria-expanded')).toBe('false');
    expect(aberta.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(aberta.querySelector('path')?.getAttribute('d')).toBe('m6 9 6 6 6-6');
    expect(fechada.querySelector('path')?.getAttribute('d')).toBe('m9 6 6 6-6 6');
    expect(container.textContent).not.toMatch(/[▸▾]/);
  });

  it('clicar na pasta chama onToggleFamily com o id', () => {
    const onToggleFamily = vi.fn();
    renderPicker({ onToggleFamily });
    fireEvent.click(screen.getByRole('button', { name: /Embalagens/ }));
    expect(onToggleFamily).toHaveBeenCalledWith(2);
  });

  it('a contagem so aparece depois de carregar', () => {
    renderPicker({
      expanded: [1, 3],
      familyItems: [
        [1, { items: [ACIDO], isLoading: false, total: 5 }],
        [3, { items: [], isLoading: true, total: 0 }],
      ],
    });
    const contagem = (nome: RegExp) => screen.getByRole('button', { name: nome }).querySelector('.item-picker__contagem')?.textContent;
    expect(contagem(/Acidulantes/)).toBe('5');
    expect(contagem(/Conservantes/)).toBe('');
    expect(contagem(/Embalagens/)).toBe('');
  });

  it('estados da pasta: Carregando… (role=status com spinner aria-hidden), vazia e "+N — refine pela busca"', () => {
    const { container } = renderPicker({
      expanded: [1, 2, 3],
      familyItems: [
        [1, { items: [ACIDO], isLoading: false, total: 9 }],
        [2, { items: [], isLoading: false, total: 0 }],
        [3, { items: [], isLoading: true, total: 0 }],
      ],
    });
    const status = screen.getByRole('status');
    expect(status.textContent).toBe('Carregando…');
    expect(status.querySelector('.btn-spinner')?.getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByText('Nenhum item nesta família.')).toBeTruthy();
    const mais = container.querySelector('.item-picker__mais') as HTMLElement;
    expect(mais.textContent).toBe('+8 — refine pela busca');
    expect(mais.querySelector('.item-picker__mais-num')?.textContent).toBe('+8');
  });

  it('busca: resultados agrupados por familia (Sem familia por ultimo), sempre abertos; vazio mostra "Nenhum item encontrado."', () => {
    const { container, rerender } = renderPicker({
      isSearching: true,
      searchItems: [item(2, 'Ácido esteárico', null), ACIDO, item(3, 'Ácido sórbico', 'Conservantes')],
    });
    const nomes = [...container.querySelectorAll('.item-picker__familia-nome')].map((n) => n.textContent);
    expect(nomes).toEqual(['Acidulantes', 'Conservantes', 'Sem família']);
    for (const botao of container.querySelectorAll('.item-picker__familia')) expect(botao.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('.item-picker__browser--busca')).not.toBeNull();
    rerender(
      <CatalogItemPicker
        families={FAMILIAS}
        familyItems={new Map()}
        expanded={new Set()}
        onToggleFamily={vi.fn()}
        isSearching
        searchItems={[]}
        selectedId={null}
        onSelect={vi.fn()}
        search="zzz"
        onSearchChange={vi.fn()}
      />,
    );
    expect(screen.getByText('Nenhum item encontrado.')).toBeTruthy();
  });

  it('sem familias: "Nenhuma família cadastrada."', () => {
    renderPicker({ families: [] });
    expect(screen.getByText('Nenhuma família cadastrada.')).toBeTruthy();
  });

  it('item selecionado: aria-pressed=true (os demais false); clicar chama onSelect', () => {
    const onSelect = vi.fn();
    const outro = item(7, 'Ácido fosfórico 85%', 'Acidulantes');
    renderPicker({
      expanded: [1],
      familyItems: [[1, { items: [ACIDO, outro], isLoading: false, total: 2 }]],
      selectedId: 1,
      onSelect,
    });
    expect(screen.getByRole('button', { name: 'Ácido cítrico anidro' }).getAttribute('aria-pressed')).toBe('true');
    const nao = screen.getByRole('button', { name: 'Ácido fosfórico 85%' });
    expect(nao.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(nao);
    expect(onSelect).toHaveBeenCalledWith(outro);
  });

  it('resumo do item escolhido: icone check aria-hidden, nome e "Família: …"', () => {
    const { container } = renderPicker({ selectedItem: ACIDO, selectedId: 1 });
    const resumo = container.querySelector('.item-picker__selecionado') as HTMLElement;
    expect(resumo.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(within(resumo).getByText('Ácido cítrico anidro')).toBeTruthy();
    expect(within(resumo).getByText('Família: Acidulantes')).toBeTruthy();
    const semFamilia = renderPicker({ selectedItem: item(8, 'Item solto', null) });
    expect(within(semFamilia.container).getByText('Família: Sem família')).toBeTruthy();
  });

  it('campo de busca: rotulo "Item *" associado, placeholder de sempre e icone de lupa decorativo', () => {
    const { container } = renderPicker();
    const campo = screen.getByLabelText('Item *') as HTMLInputElement;
    expect(campo.id).toBe('catalogItemSearch');
    expect(campo.placeholder).toBe('Buscar item do catálogo...');
    expect(container.querySelector('.item-picker__busca svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('somente leitura (edicao): .item-picker__current com o nome, sem busca e sem navegador de pastas', () => {
    const { container } = renderPicker({ disabled: true, selectedItem: ACIDO });
    expect(container.querySelector('.item-picker--readonly')).not.toBeNull();
    const atual = container.querySelector('.item-picker__current') as HTMLElement;
    expect(atual.textContent).toContain('Item');
    expect(atual.querySelector('.item-picker__current-name')?.textContent).toBe('Ácido cítrico anidro');
    expect(container.querySelector('#catalogItemSearch')).toBeNull();
    expect(container.querySelector('.item-picker__browser')).toBeNull();
  });

  it('nenhum [style] em nenhum estado', () => {
    const { container } = renderPicker({
      expanded: [1, 2, 3],
      familyItems: [
        [1, { items: [ACIDO], isLoading: false, total: 9 }],
        [2, { items: [], isLoading: false, total: 0 }],
        [3, { items: [], isLoading: true, total: 0 }],
      ],
      selectedItem: ACIDO,
      selectedId: 1,
    });
    expect(container.querySelectorAll('[style]')).toHaveLength(0);
  });
});
