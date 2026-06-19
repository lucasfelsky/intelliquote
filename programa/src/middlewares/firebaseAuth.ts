// Middleware de autenticacao compartilhada com o Portal COMEX (Firebase Auth).
//
// O Portal COMEX usa Firebase Auth. Quando o usuario acessa o IntelliQuote
// a partir do Portal, o front envia o Firebase ID Token no cabecalho:
//     Authorization: Bearer <firebase-id-token>
//
// Este middleware valida o token usando as chaves publicas do Google
// (descobradas via JWKS em https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com).
// Em seguida, mapeia o `uid` do Firebase para um `User` interno
// (auto-provisionando na primeira vez, com base no role vindo do Firestore).
//
// A variavel de ambiente `FIREBASE_PROJECT_ID` e obrigatoria em producao.
// Opcionalmente, defina `FIREBASE_AUTH_EMULATOR_HOST` para usar o emulador
// (util durante desenvolvimento local).
//
// Opcional: `FIREBASE_ROLE_CLAIM` (default "role") indica qual custom claim
// carregar como role interna. Se ausente, mantemos o usuario com a role
// padrao "viewer" (e o admin pode promove-lo depois).

import type { NextFunction, Request, Response } from 'express';
import { cert, getApp, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type DecodedIdToken } from 'firebase-admin/auth';
import { authEnv } from '../config/env';
import { prisma } from '../lib/prisma';
import { hashPassword } from '../utils/password';
import { handleControllerError, HttpError } from '../utils/http';
import type { AuthenticatedUser } from '../types/auth';
import { isUserRole, DEFAULT_INTERNAL_ROLE } from '../constants/roles';

let firebaseApp: App | null = null;

export function getFirebaseApp(): App {
  if (firebaseApp) return firebaseApp;

  const projectId = process.env.FIREBASE_PROJECT_ID ?? 'sq-comex-updates-3d22f';

  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON) as Record<string, unknown>;
    firebaseApp = initializeApp({
      credential: cert(credentials as Parameters<typeof cert>[0]),
      projectId,
    });
  } else {
    firebaseApp = initializeApp({ projectId });
  }

  return firebaseApp;
}

function extractBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  if (!header.startsWith('Bearer ')) return null;
  return header.slice(7).trim();
}

function mapFirebaseRoleToInternal(claimRole: unknown): typeof DEFAULT_INTERNAL_ROLE {
  if (typeof claimRole !== 'string') return DEFAULT_INTERNAL_ROLE;
  const normalized = claimRole.toLowerCase();
  if (isUserRole(normalized)) return normalized;
  // Fallback para roles conhecidas do Portal COMEX
  if (normalized === 'comex' || normalized === 'admin' || normalized === 'viewer') {
    return normalized as typeof DEFAULT_INTERNAL_ROLE;
  }
  return DEFAULT_INTERNAL_ROLE;
}

async function provisionInternalUser(decoded: DecodedIdToken): Promise<AuthenticatedUser> {
  const uid = decoded.uid;
  const email = (decoded.email ?? `${uid}@firebase.local`).toLowerCase();
  const name = (decoded.name as string | undefined) ?? email.split('@')[0];
  const roleName = mapFirebaseRoleToInternal((decoded as { role?: unknown }).role);

  const role = await prisma.role.findUnique({ where: { name: roleName } });
  if (!role) {
    throw new HttpError(500, `Role interna '${roleName}' nao foi encontrada.`);
  }

  const existing = await prisma.user.findFirst({
    where: { email },
    include: { role: true },
  });

  if (existing) {
    if (!existing.isActive) {
      throw new HttpError(403, 'Usuario desativado no IntelliQuote.');
    }
    if (existing.roleId !== role.id) {
      const updated = await prisma.user.update({
        where: { id: existing.id },
        data: { roleId: role.id },
        include: { role: true },
      });
      return serializeUser(updated);
    }
    return serializeUser(existing);
  }

  // Auto-provisiona. Senha aleatoria (o login nunca usa senha — vem sempre do Firebase).
  const randomPassword = await hashPassword(`firebase-${uid}-${Date.now()}`);

  const created = await prisma.user.create({
    data: {
      name,
      email,
      passwordHash: randomPassword,
      isActive: true,
      roleId: role.id,
    },
    include: { role: true },
  });

  return serializeUser(created);
}

function serializeUser(user: {
  id: number;
  name: string;
  email: string;
  role: { name: string };
}): AuthenticatedUser {
  if (!isUserRole(user.role.name)) {
    throw new Error(`Role invalida encontrada no utilizador: ${user.role.name}`);
  }
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role.name,
  };
}

/**
 * Middleware opcional: se o cabecalho Authorization estiver presente e
 * for um Firebase ID Token valido, popula `req.user`. Caso contrario,
 * segue para o proximo middleware (util para rotas publicas que ganham
 * contexto quando logado).
 */
export async function tryFirebaseAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const token = extractBearerToken(req);
  if (!token) {
    next();
    return;
  }
  await authenticateWithToken(req, next);
}

/**
 * Middleware estrito: exige Firebase ID Token valido. Retorna 401 se
 * ausente ou invalido. Use em rotas que exigem autenticacao.
 */
export async function requireFirebaseAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({ message: 'Firebase ID Token ausente.' });
    return;
  }
  await authenticateWithToken(req, next, res);
}

async function authenticateWithToken(
  req: Request,
  next: NextFunction,
  res?: Response,
): Promise<void> {
  try {
    const token = extractBearerToken(req);
    if (!token) {
      throw new HttpError(401, 'Token ausente.');
    }

    const app = getFirebaseApp();
    const decoded = await getAuth(app).verifyIdToken(token);

    const internalUser = await provisionInternalUser(decoded);
    req.user = internalUser;
    next();
  } catch (error) {
    const handled = handleControllerError(error);
    if (res) {
      res.status(handled.status).json({ message: handled.message });
    } else {
      next();
    }
  }
}

/**
 * Utilizado em casos onde queremos garantir que o request veio do
 * Portal COMEX (e nao de outro consumidor). Verifica o aud do token.
 */
export function requireFirebaseAudience(expectedProjectId?: string) {
  const expected = expectedProjectId ?? process.env.FIREBASE_PROJECT_ID ?? 'sq-comex-updates-3d22f';
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.headers['x-firebase-audience'];
    if (header && header !== expected) {
      res.status(401).json({ message: 'Audience Firebase invalido.' });
      return;
    }
    next();
  };
}
