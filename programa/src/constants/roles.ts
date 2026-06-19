export const USER_ROLES = ['admin', 'comprador', 'gestor', 'viewer'] as const;

export type UserRole = (typeof USER_ROLES)[number];

export const DEFAULT_INTERNAL_ROLE: UserRole = 'comprador';

export function isUserRole(value: string): value is UserRole {
  return USER_ROLES.includes(value as UserRole);
}
