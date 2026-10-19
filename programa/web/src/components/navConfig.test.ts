import { describe, expect, it } from 'vitest';
import {
  ADMIN_NAV,
  COMEX_ROLES,
  PRIMARY_NAV,
  filterNavByRole,
  isComercialRole,
} from './navConfig';

function visiblePaths(role: string | null | undefined): string[] {
  return [...filterNavByRole(PRIMARY_NAV, role), ...filterNavByRole(ADMIN_NAV, role)].map(
    (item) => item.to,
  );
}

describe('navConfig', () => {
  it('comercial ve somente /solicitacoes (principal + admin)', () => {
    expect(visiblePaths('comercial')).toEqual(['/solicitacoes']);
  });

  it('isComercialRole so e verdadeiro para comercial', () => {
    expect(isComercialRole('comercial')).toBe(true);
    expect(isComercialRole('admin')).toBe(false);
    expect(isComercialRole(undefined)).toBe(false);
    expect(isComercialRole(null)).toBe(false);
  });

  it('todos os itens de PRIMARY_NAV tem roles explicito', () => {
    for (const item of PRIMARY_NAV) {
      expect(item.roles, item.to).toBeDefined();
      expect(item.roles?.length ?? 0, item.to).toBeGreaterThan(0);
    }
  });

  it.each(['viewer', 'gestor'])('%s ve Solicitacoes e nada novo alem disso', (role) => {
    const paths = visiblePaths(role);
    expect(paths).toContain('/solicitacoes');
    const withoutSolicitacoes = paths.filter((path) => path !== '/solicitacoes');
    // Mesmo conjunto que os papeis COMEX ja viam antes do PR (itens existentes).
    expect(withoutSolicitacoes).toEqual(
      [...PRIMARY_NAV, ...ADMIN_NAV]
        .filter((item) => item.to !== '/solicitacoes')
        .filter((item) => !item.roles || item.roles.includes(role))
        .map((item) => item.to),
    );
    expect(withoutSolicitacoes).toContain('/cotacoes');
  });

  it.each(COMEX_ROLES)('%s (COMEX) ve Solicitacoes', (role) => {
    expect(visiblePaths(role)).toContain('/solicitacoes');
  });

  it('Solicitacoes tem icone proprio (diferente de Templates e dos demais itens)', () => {
    const all = [...PRIMARY_NAV, ...ADMIN_NAV];
    const solicitacoes = all.find((item) => item.to === '/solicitacoes');
    expect(solicitacoes).toBeDefined();
    expect(all.filter((item) => item.icon === solicitacoes?.icon)).toHaveLength(1);
  });

  it('papel ausente: so itens sem roles (nenhum no menu principal)', () => {
    expect(visiblePaths(undefined)).toEqual([]);
    expect(visiblePaths(null)).toEqual([]);
  });
});
