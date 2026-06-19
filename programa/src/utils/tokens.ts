import { createHash } from 'crypto';
import jwt, { type JwtPayload, type SignOptions } from 'jsonwebtoken';
import { authEnv } from '../config/env';
import { HttpError } from './http';

export const ACCESS_TOKEN_COOKIE_NAME = 'intelliquote_access_token';
export const REFRESH_TOKEN_COOKIE_NAME = 'intelliquote_refresh_token';

interface BaseTokenPayload extends JwtPayload {
  type: 'access' | 'refresh';
}

export interface AccessTokenPayload extends BaseTokenPayload {
  sub: string;
  email: string;
  name: string;
  role: string;
  type: 'access';
}

export interface RefreshTokenPayload extends BaseTokenPayload {
  sub: string;
  sessionId: string;
  type: 'refresh';
}

interface AccessTokenInput {
  userId: number;
  email: string;
  name: string;
  role: string;
}

interface RefreshTokenInput {
  userId: number;
  sessionId: string;
}

export function createAccessToken(input: AccessTokenInput): string {
  return jwt.sign(
    {
      email: input.email,
      name: input.name,
      role: input.role,
      type: 'access',
    },
    authEnv.accessSecret,
    {
      expiresIn: authEnv.accessExpiresIn as SignOptions['expiresIn'],
      subject: String(input.userId),
    },
  );
}

export function createRefreshToken(input: RefreshTokenInput): string {
  return jwt.sign(
    {
      sessionId: input.sessionId,
      type: 'refresh',
    },
    authEnv.refreshSecret,
    {
      expiresIn: authEnv.refreshExpiresIn as SignOptions['expiresIn'],
      subject: String(input.userId),
    },
  );
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const payload = verifyToken(token, authEnv.accessSecret);

  if (payload.type !== 'access') {
    throw new HttpError(401, 'Token de acesso invalido.');
  }

  if (
    typeof payload.sub !== 'string' ||
    typeof payload.email !== 'string' ||
    typeof payload.name !== 'string' ||
    typeof payload.role !== 'string'
  ) {
    throw new HttpError(401, 'Token de acesso invalido.');
  }

  return payload as AccessTokenPayload;
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  const payload = verifyToken(token, authEnv.refreshSecret);

  if (payload.type !== 'refresh') {
    throw new HttpError(401, 'Token de refresh invalido.');
  }

  if (typeof payload.sub !== 'string' || typeof payload.sessionId !== 'string') {
    throw new HttpError(401, 'Token de refresh invalido.');
  }

  return payload as RefreshTokenPayload;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function getAccessTokenMaxAgeMs(): number {
  return parseDurationToMs(authEnv.accessExpiresIn);
}

export function getRefreshTokenMaxAgeMs(): number {
  return parseDurationToMs(authEnv.refreshExpiresIn);
}

export function getRefreshTokenExpiresAt(): Date {
  return new Date(Date.now() + getRefreshTokenMaxAgeMs());
}

function verifyToken(token: string, secret: string): BaseTokenPayload {
  try {
    const payload = jwt.verify(token, secret);

    if (typeof payload !== 'object' || payload === null) {
      throw new HttpError(401, 'Token invalido.');
    }

    return payload as BaseTokenPayload;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new HttpError(401, 'Sessao expirada.');
    }

    if (error instanceof jwt.JsonWebTokenError) {
      throw new HttpError(401, 'Token invalido.');
    }

    throw error;
  }
}

function parseDurationToMs(value: string): number {
  const numericValue = Number(value);

  if (Number.isFinite(numericValue) && numericValue > 0) {
    return numericValue * 1000;
  }

  const match = value.trim().match(/^(\d+)(ms|s|m|h|d)$/i);

  if (!match) {
    throw new Error(`Formato de duracao invalido: ${value}`);
  }

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const unitMap: Record<string, number> = {
    ms: 1,
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };

  return amount * unitMap[unit];
}
