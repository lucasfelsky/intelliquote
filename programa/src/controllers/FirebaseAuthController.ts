import type { CookieOptions, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { getAuth } from 'firebase-admin/auth';
import { authEnv } from '../config/env';
import { prisma } from '../lib/prisma';
import { isUserRole, type UserRole } from '../constants/roles';
import { handleControllerError, HttpError } from '../utils/http';
import {
  ACCESS_TOKEN_COOKIE_NAME,
  createAccessToken,
  createRefreshToken,
  getAccessTokenMaxAgeMs,
  getRefreshTokenMaxAgeMs,
  hashToken,
  REFRESH_TOKEN_COOKIE_NAME,
} from '../utils/tokens';
import { hashPassword } from '../utils/password';
import { getFirebaseApp } from '../middlewares/firebaseAuth';

const baseCookieOptions: CookieOptions = {
  httpOnly: true,
  path: '/',
  sameSite: 'lax',
  secure: authEnv.cookieSecure,
};

/**
 * Endpoint que troca um Firebase ID Token (emitido pelo Portal COMEX) por
 * um par de JWTs IntelliQuote (access + refresh), retornados no body em
 * JSON alem de serem gravados em cookies HttpOnly (defesa em profundidade
 * para uso via Cloud Run direto).
 *
 * Auto-provisiona um usuario interno com a role indicada no custom claim
 * `role` do Firebase. Se ausente, usa a role padrao `DEFAULT_INTERNAL_ROLE`.
 */
export class FirebaseAuthController {
  static async exchange(req: Request, res: Response): Promise<Response> {
    try {
      const header = req.headers.authorization;
      if (!header?.startsWith('Bearer ')) {
        throw new HttpError(401, 'Firebase ID Token ausente.');
      }
      const idToken = header.slice(7).trim();

      const app = getFirebaseApp();
      let decoded;
      try {
        decoded = await getAuth(app).verifyIdToken(idToken);
      } catch (fbErr) {
        const e = fbErr as Error & { code?: string };
        throw new HttpError(401, `Firebase ID Token invalido: ${e.code ?? 'verify-failed'} - ${e.message}`);
      }

      const email = (decoded.email ?? '').toLowerCase();
      if (!email) {
        throw new HttpError(400, 'Firebase ID Token sem e-mail.');
      }

      const roleName = mapFirebaseRoleToInternal((decoded as { role?: unknown }).role);
      const role = await prisma.role.findUnique({ where: { name: roleName } });
      if (!role) {
        throw new HttpError(500, `Role interna '${roleName}' nao foi encontrada.`);
      }

      const existing = await prisma.user.findUnique({
        where: { email },
        include: { role: true },
      });

      let userRecord: {
        id: number;
        name: string;
        email: string;
        isActive: boolean;
        role: { name: string };
      };

      if (existing) {
        if (!existing.isActive) {
          throw new HttpError(403, 'Usuario desativado no IntelliQuote.');
        }

        // Se a role mudou no Firebase, atualiza no IntelliQuote.
        if (existing.roleId !== role.id) {
          userRecord = await prisma.user.update({
            where: { id: existing.id },
            data: { roleId: role.id },
            include: { role: true },
          });
        } else {
          userRecord = existing;
        }
      } else {
        const randomPw = await hashPassword(`firebase-${decoded.uid}-${Date.now()}`);
        const displayName =
          (decoded.name as string | undefined)?.trim() || email.split('@')[0];

        userRecord = await prisma.user.create({
          data: {
            name: displayName,
            email,
            passwordHash: randomPw,
            isActive: true,
            roleId: role.id,
          },
          include: { role: true },
        });
      }

      if (!isUserRole(userRecord.role.name)) {
        throw new HttpError(500, `Role invalida: ${userRecord.role.name}`);
      }

      const sessionId = randomUUID();
      const accessToken = createAccessToken({
        userId: userRecord.id,
        email: userRecord.email,
        name: userRecord.name,
        role: userRecord.role.name,
      });
      const refreshToken = createRefreshToken({ userId: userRecord.id, sessionId });

      await prisma.session.create({
        data: {
          id: sessionId,
          userId: userRecord.id,
          refreshTokenHash: hashToken(refreshToken),
          expiresAt: new Date(Date.now() + getRefreshTokenMaxAgeMs()),
        },
      });

      res.cookie(ACCESS_TOKEN_COOKIE_NAME, accessToken, {
        ...baseCookieOptions,
        maxAge: getAccessTokenMaxAgeMs(),
      });
      res.cookie(REFRESH_TOKEN_COOKIE_NAME, refreshToken, {
        ...baseCookieOptions,
        maxAge: getRefreshTokenMaxAgeMs(),
      });

      return res.status(200).json({
        user: {
          id: userRecord.id,
          name: userRecord.name,
          email: userRecord.email,
          role: userRecord.role.name,
        },
        accessToken,
        refreshToken,
        expiresIn: Math.floor(getAccessTokenMaxAgeMs() / 1000),
      });
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }
}

function mapFirebaseRoleToInternal(claimRole: unknown): UserRole {
  if (typeof claimRole !== 'string') {
    return 'comprador';
  }
  const normalized = claimRole.toLowerCase();
  if (isUserRole(normalized)) {
    return normalized;
  }
  return 'comprador';
}
