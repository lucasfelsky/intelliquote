import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Sidebar from './Sidebar';
import { ADMIN_NAV, COMEX_ROLES, PRIMARY_NAV, filterNavByRole } from './navConfig';

function renderSidebar(role: string, badges?: Record<string, number>) {
  return render(
    <MemoryRouter>
      <Sidebar
        items={filterNavByRole(PRIMARY_NAV, role)}
        adminItems={filterNavByRole(ADMIN_NAV, role)}
        adminHeader
        badges={badges}
      />
    </MemoryRouter>,
  );
}

const FORECAST_BETA = /^forecast,\s*beta$/i;

describe('Sidebar - selo (tag)', () => {
  it('comprador: o link Forecast tem nome acessivel "Forecast, Beta" e os vizinhos nao tem selo', () => {
    const { container } = renderSidebar('comprador');
    const link = screen.getByRole('link', { name: FORECAST_BETA });
    expect(link.getAttribute('href')?.endsWith('/forecast')).toBe(true);

    const tags = container.querySelectorAll('.sidebar__tag');
    expect(tags).toHaveLength(1);
    expect(link.contains(tags[0] ?? null)).toBe(true);
    expect(tags[0]?.textContent).toContain('Beta');

    expect(screen.getByRole('link', { name: 'Fornecedores' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Forwarders' })).toBeTruthy();
  });

  it.each(COMEX_ROLES)('%s (COMEX) ve o link Forecast com selo', (role) => {
    renderSidebar(role);
    expect(screen.getByRole('link', { name: FORECAST_BETA })).toBeTruthy();
  });

  it('comercial: nenhum selo e nenhum link Forecast', () => {
    const { container } = renderSidebar('comercial');
    expect(container.querySelectorAll('.sidebar__tag')).toHaveLength(0);
    expect(screen.queryAllByRole('link', { name: /forecast/i })).toHaveLength(0);
  });

  it('o contador de pendentes continua em Solicitações e o Forecast nao ganha contador', () => {
    renderSidebar('comprador', { '/solicitacoes': 2 });
    const solicitacoes = screen.getByRole('link', { name: /Solicitações/ });
    const contador = solicitacoes.querySelector('.sidebar__badge');
    expect(contador).not.toBeNull();
    expect(contador?.getAttribute('aria-label')).toBe('2 pendentes');

    const forecast = screen.getByRole('link', { name: FORECAST_BETA });
    expect(forecast.querySelector('.sidebar__badge')).toBeNull();
  });
});
