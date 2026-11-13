import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Sidebar from './Sidebar';
import type { NavItem } from './navConfig';

// Golden do HTML da Sidebar padrao (sem props da variante Indent). Gravado ANTES de editar Sidebar.tsx.
// As listas sao copia LITERAL do PRIMARY_NAV/ADMIN_NAV de antes do item Indent: assim o golden isola a
// regressao do Sidebar.tsx (o item novo do menu nao mexe neste arquivo).
const COMEX = ['admin', 'comprador', 'gestor', 'viewer'];

const ITENS: NavItem[] = [
  { to: '/', label: 'Overview', icon: 'overview', end: true, group: 'main', roles: COMEX },
  { to: '/cotacoes', label: 'Cotações', icon: 'cotacoes', group: 'main', roles: COMEX },
  { to: '/solicitacoes', label: 'Solicitações', icon: 'solicitacoes', group: 'main', roles: [...COMEX, 'comercial'] },
  { to: '/itens', label: 'Itens', icon: 'itens', group: 'main', roles: COMEX },
  { to: '/fornecedores', label: 'Fornecedores', icon: 'fornecedores', group: 'main', roles: COMEX },
  { to: '/forecast', label: 'Forecast', icon: 'forecast', group: 'main', roles: COMEX, tag: 'Beta' },
  { to: '/forwarders', label: 'Forwarders', icon: 'forwarders', group: 'main', roles: COMEX },
  { to: '/familias', label: 'Famílias', icon: 'familias', group: 'main', roles: COMEX },
  { to: '/relatorios', label: 'Relatórios', icon: 'relatorios', group: 'main', roles: COMEX },
  { to: '/manual', label: 'Manual', icon: 'ajuda', group: 'main', roles: [...COMEX, 'comercial'] },
];

const ADMIN: NavItem[] = [
  { to: '/usuarios', label: 'Usuários', icon: 'usuarios', group: 'admin', roles: ['admin'] },
  { to: '/empresa', label: 'Empresa', icon: 'empresa', group: 'admin', roles: ['admin', 'comprador', 'gestor'] },
  { to: '/auditoria', label: 'Auditoria', icon: 'auditoria', group: 'admin', roles: ['admin', 'gestor'] },
  { to: '/templates', label: 'Templates de e-mail', icon: 'templates', group: 'admin', roles: ['admin', 'comprador', 'gestor', 'viewer'] },
];

describe('Sidebar - regressao do markup padrao (golden)', () => {
  it('sem as props da variante Indent o HTML e identico ao golden', async () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/cotacoes']}>
        <Sidebar items={ITENS} adminItems={ADMIN} adminHeader badges={{ '/solicitacoes': 3 }} onAlternar={() => {}} />
      </MemoryRouter>,
    );
    await expect(container.innerHTML).toMatchFileSnapshot('./__snapshots__/sidebar-padrao.html');
  });
});
