import type { UserRole } from '../constants/roles';

export interface AuthenticatedUser {
  id: number;
  name: string;
  email: string;
  role: UserRole;
}
