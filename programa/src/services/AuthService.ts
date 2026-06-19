import { randomUUID } from 'crypto';
import { isUserRole } from '../constants/roles';
import { prisma } from '../lib/prisma';
import type { AuthenticatedUser } from '../types/auth';
import { HttpError } from '../utils/http';
import { verifyPassword } from '../utils/password';
import {
  createAccessToken,
  createRefreshToken,
  getRefreshTokenExpiresAt,
  hashToken,
  verifyRefreshToken,
} from '../utils/tokens';

interface LoginInput {
  email: string;
  password: string;
}

interface AuthSessionResult {
  user: AuthenticatedUser;
  accessToken: string;
  refreshToken: string;
}

export class AuthService {
  static async login(input: LoginInput): Promise<AuthSessionResult> {
    const email = input.email.trim().toLowerCase();
    const user = await prisma.user.findUnique({
      where: { email },
      include: {
        role: true,
      },
    });

    if (!user || !user.isActive) {
      throw new HttpError(401, 'Credenciais invalidas.');
    }

    const passwordMatches = await verifyPassword(input.password, user.passwordHash);

    if (!passwordMatches) {
      throw new HttpError(401, 'Credenciais invalidas.');
    }

    const sessionId = randomUUID();
    const refreshToken = createRefreshToken({
      userId: user.id,
      sessionId,
    });

    await prisma.session.create({
      data: {
        id: sessionId,
        userId: user.id,
        refreshTokenHash: hashToken(refreshToken),
        expiresAt: getRefreshTokenExpiresAt(),
      },
    });

    return {
      user: serializeUser(user),
      accessToken: createAccessToken({
        userId: user.id,
        email: user.email,
        name: user.name,
        role: user.role.name,
      }),
      refreshToken,
    };
  }

  static async refresh(refreshToken: string): Promise<AuthSessionResult> {
    const payload = verifyRefreshToken(refreshToken);
    const userId = Number(payload.sub);

    const session = await prisma.session.findUnique({
      where: { id: payload.sessionId },
      include: {
        user: {
          include: {
            role: true,
          },
        },
      },
    });

    if (!session) {
      throw new HttpError(401, 'Sessao invalida.');
    }

    if (session.revokedAt || session.expiresAt.getTime() <= Date.now()) {
      throw new HttpError(401, 'Sessao expirada.');
    }

    if (session.userId !== userId || !session.user.isActive) {
      throw new HttpError(401, 'Sessao invalida.');
    }

    if (session.refreshTokenHash !== hashToken(refreshToken)) {
      await prisma.session.update({
        where: { id: session.id },
        data: { revokedAt: new Date() },
      });

      throw new HttpError(401, 'Sessao invalida.');
    }

    const rotatedRefreshToken = createRefreshToken({
      userId: session.user.id,
      sessionId: session.id,
    });

    await prisma.session.update({
      where: { id: session.id },
      data: {
        refreshTokenHash: hashToken(rotatedRefreshToken),
        expiresAt: getRefreshTokenExpiresAt(),
        revokedAt: null,
      },
    });

    return {
      user: serializeUser(session.user),
      accessToken: createAccessToken({
        userId: session.user.id,
        email: session.user.email,
        name: session.user.name,
        role: session.user.role.name,
      }),
      refreshToken: rotatedRefreshToken,
    };
  }

  static async logout(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) {
      return;
    }

    try {
      const payload = verifyRefreshToken(refreshToken);
      await prisma.session.updateMany({
        where: {
          id: payload.sessionId,
          revokedAt: null,
        },
        data: {
          revokedAt: new Date(),
        },
      });
    } catch (_error) {
      return;
    }
  }

  static async getAuthenticatedUserById(
    userId: number,
  ): Promise<AuthenticatedUser> {
    const user = await prisma.user.findFirst({
      where: {
        id: userId,
        isActive: true,
      },
      include: {
        role: true,
      },
    });

    if (!user) {
      throw new HttpError(401, 'Utilizador autenticado nao encontrado.');
    }

    return serializeUser(user);
  }

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
