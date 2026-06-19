export type Role = 'admin' | 'comprador' | 'aprovador' | 'viewer' | string;

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  role: Role;
}

export interface LoginResponse {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface RefreshResponse {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}
