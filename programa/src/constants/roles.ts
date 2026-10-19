export const USER_ROLES = ['admin', 'comprador', 'gestor', 'viewer', 'comercial'] as const;

export type UserRole = (typeof USER_ROLES)[number];

export const DEFAULT_INTERNAL_ROLE: UserRole = 'comprador';

/** Papeis da equipe COMEX (acesso interno ao IntelliQuote). `comercial` fica de fora. */
export const COMEX_ROLES: UserRole[] = ['admin', 'comprador', 'gestor', 'viewer'];

/**
 * Papeis "fixos do banco": o claim do Firebase nao os reverte no login.
 * A Area Comercial do Portal (claim `user`) promove para `comercial`, mas nunca rebaixa:
 * o proprio usuario edita `area` no Portal, entao um rebaixamento automatico seria
 * manipulavel; sem esta regra o papel dado pelo admin na tela Usuarios seria desfeito no
 * login seguinte.
 */
export const DB_PINNED_ROLES: readonly UserRole[] = ['comercial'];

export function isUserRole(value: string): value is UserRole {
  return USER_ROLES.includes(value as UserRole);
}

/** O claim bruto `role` do Portal e exatamente `user` (so toLowerCase, sem trim). */
export function isPortalUserClaim(rawClaim: unknown): boolean {
  return typeof rawClaim === 'string' && rawClaim.toLowerCase() === 'user';
}

/**
 * Claim bruto `role` do Firebase -> papel interno. So toLowerCase (sem trim, como isPortalUserClaim).
 * Papel interno exato -> ele mesmo; qualquer outra coisa (ausente, nao-string, `user`, `logistica`,
 * `compras`, desconhecido) -> DEFAULT_INTERNAL_ROLE. Nunca devolve nome fora de USER_ROLES.
 * Usada pelos dois caminhos de login (tryFirebaseAuth e POST /auth/firebase).
 */
export function mapFirebaseRoleToInternal(rawClaim: unknown): UserRole {
  if (typeof rawClaim !== 'string') return DEFAULT_INTERNAL_ROLE;
  const normalized = rawClaim.toLowerCase();
  return isUserRole(normalized) ? normalized : DEFAULT_INTERNAL_ROLE;
}

/**
 * Vale ler a Area do Portal no Firestore? So quando pode mudar o resultado:
 * claim `user` e o papel atual nao e um papel fixo do banco.
 */
export function shouldLookupPortalArea(input: {
  rawClaim: unknown;
  currentRole: string | null;
}): boolean {
  const { rawClaim, currentRole } = input;
  return isPortalUserClaim(rawClaim) && !(currentRole && DB_PINNED_ROLES.includes(currentRole as UserRole));
}

/**
 * Papel efetivo no login Firebase: 1) papel fixo do banco (ex.: `comercial`) prevalece;
 * 2) Area Comercial do Portal (`portalCommercial`) promove para `comercial`;
 * 3) para os demais o claim reconcilia como sempre.
 */
export function resolveFirebaseLoginRole(input: {
  claimRole: UserRole;
  currentRole: string | null;
  portalCommercial?: boolean;
}): UserRole {
  const { claimRole, currentRole, portalCommercial } = input;
  if (currentRole && DB_PINNED_ROLES.includes(currentRole as UserRole)) {
    return currentRole as UserRole;
  }
  if (portalCommercial === true) {
    return 'comercial';
  }
  return claimRole;
}
