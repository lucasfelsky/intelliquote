import { describe, expect, it } from 'vitest';
import {
  ADMIN_NAV,
  COMEX_ROLES,
  PRIMARY_NAV,
  filterNavByRole,
  isComercialRole,
  type NavItem,
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

  it.each(COMEX_ROLES)('%s (COMEX) ve Forecast', (role) => {
    expect(visiblePaths(role)).toContain('/forecast');
  });

  it('Forecast aponta para /forecast, vem depois de Fornecedores e nao aparece para comercial', () => {
    const paths = PRIMARY_NAV.map((item) => item.to);
    expect(paths.indexOf('/forecast')).toBe(paths.indexOf('/fornecedores') + 1);
    expect(visiblePaths('comercial')).not.toContain('/forecast');
  });

  it('Forecast tem icone proprio (nenhum outro item usa o mesmo glifo)', () => {
    const all = [...PRIMARY_NAV, ...ADMIN_NAV];
    const forecast = all.find((item) => item.to === '/forecast');
    expect(forecast).toBeDefined();
    expect(all.filter((item) => item.icon === forecast?.icon)).toHaveLength(1);
  });

  it('so o Forecast tem selo, e o selo e "Beta"', () => {
    const comSelo = [...PRIMARY_NAV, ...ADMIN_NAV].filter((i) => i.tag).map((i) => [i.to, i.tag]);
    expect(comSelo).toEqual([['/forecast', 'Beta']]);
  });

  it('o selo nao altera o filtro por papel', () => {
    const semTag = (items: NavItem[]) => items.map(({ tag: _tag, ...rest }) => rest);
    for (const role of [...COMEX_ROLES, 'comercial']) {
      const esperado = [
        ...filterNavByRole(semTag(PRIMARY_NAV), role),
        ...filterNavByRole(semTag(ADMIN_NAV), role),
      ].map((item) => item.to);
      expect(visiblePaths(role), role).toEqual(esperado);
    }
    expect(visiblePaths('comercial')).toEqual(['/solicitacoes']);
  });

  it('papel ausente: so itens sem roles (nenhum no menu principal)', () => {
    expect(visiblePaths(undefined)).toEqual([]);
    expect(visiblePaths(null)).toEqual([]);
  });
});
