export const USER_ROLES = ['admin', 'comprador', 'gestor', 'viewer', 'comercial'] as const;

export type UserRole = (typeof USER_ROLES)[number];

export const DEFAULT_INTERNAL_ROLE: UserRole = 'comprador';

/** Papeis da equipe COMEX (acesso interno ao IntelliQuote). `comercial` fica de fora. */
export const COMEX_ROLES: UserRole[] = ['admin', 'comprador', 'gestor', 'viewer'];

/**
 * Papeis "fixos do banco": o claim do Firebase nao os reverte no login.
 * Os claims do Portal (`user|admin|logistica|compras|viewer`) nunca viram `comercial`;
 * sem esta regra o papel dado pelo admin na tela Usuarios seria desfeito no login seguinte.
 */
export const DB_PINNED_ROLES: readonly UserRole[] = ['comercial'];

export function isUserRole(value: string): value is UserRole {
  return USER_ROLES.includes(value as UserRole);
}

/**
 * Papel efetivo no login Firebase de um usuario existente: papel fixo do banco
 * (ex.: `comercial`) prevalece; para os demais o claim reconcilia como sempre.
 */
export function resolveFirebaseLoginRole(input: {
  claimRole: UserRole;
  currentRole: string | null;
}): UserRole {
  const { claimRole, currentRole } = input;
  if (currentRole && DB_PINNED_ROLES.includes(currentRole as UserRole)) {
    return currentRole as UserRole;
  }
  return claimRole;
}
