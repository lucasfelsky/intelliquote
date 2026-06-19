import { randomBytes } from 'crypto';
import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { AuditLogService } from '../services/AuditLogService';
import {
  passwordRecoveryRequestSchema,
  passwordRecoveryResetSchema,
} from '../validators/domain';
import { handleControllerError, HttpError } from '../utils/http';
import { hashPassword, verifyPassword } from '../utils/password';

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hora
const TOKEN_BYTES = 32;

export class PasswordRecoveryController {
  static async request(req: Request, res: Response): Promise<Response> {
    try {
      const parsed = passwordRecoveryRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          message: 'Informe um e-mail valido para iniciar a recuperacao.',
        });
      }

      const email = parsed.data.email.trim().toLowerCase();
      const user = await prisma.user.findUnique({ where: { email } });
      const genericMessage =
        'Se o e-mail estiver cadastrado, um link de recuperacao sera gerado. Procure na sua caixa de entrada e na area de Administracao > Tokens de recuperacao para visualizar o link (ambiente piloto).';

      if (!user || !user.isActive) {
        return res.status(200).json({ message: genericMessage });
      }

      await prisma.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      });

      const tokenValue = randomBytes(TOKEN_BYTES).toString('hex');
      const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

      const record = await prisma.passwordResetToken.create({
        data: {
          token: tokenValue,
          userId: user.id,
          expiresAt,
        },
      });

      await AuditLogService.log({
        entityType: 'password_reset',
        entityId: record.id,
        action: 'request',
        performedById: user.id,
        metadata: { email, expiresAt: expiresAt.toISOString() },
      });

      return res.status(200).json({
        message: genericMessage,
        ...(process.env.NODE_ENV === 'production'
          ? {}
          : { devToken: tokenValue, expiresAt: expiresAt.toISOString() }),
      });
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async reset(req: Request, res: Response): Promise<Response> {
    try {
      const parsed = passwordRecoveryResetSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          message: 'Token ou palavra-passe invalidos.',
        });
      }

      const { token, password } = parsed.data;
      const record = await prisma.passwordResetToken.findUnique({
        where: { token },
        include: { user: true },
      });

      if (!record || record.usedAt || record.expiresAt.getTime() <= Date.now()) {
        throw new HttpError(
          400,
          'Token invalido ou expirado. Solicite um novo link de recuperacao.',
        );
      }

      if (!record.user.isActive) {
        throw new HttpError(400, 'Conta desativada. Procure um administrador.');
      }

      const newHash = await hashPassword(password);
      const sameAsOld = await verifyPassword(password, record.user.passwordHash);

      await prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: record.userId },
          data: { passwordHash: newHash },
        });
        await tx.passwordResetToken.update({
          where: { id: record.id },
          data: { usedAt: new Date() },
        });
        await tx.session.updateMany({
          where: { userId: record.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await AuditLogService.log(
          {
            entityType: 'password_reset',
            entityId: record.id,
            action: 'reset',
            performedById: record.userId,
            metadata: {
              sameAsPrevious: sameAsOld,
              revokedActiveSessions: true,
            },
          },
          tx,
        );
      });

      return res.status(200).json({
        message: 'Palavra-passe atualizada. Faca login com a nova senha.',
      });
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async listForAdmin(req: Request, res: Response): Promise<Response> {
    try {
      const tokens = await prisma.passwordResetToken.findMany({
        where: { usedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { id: true, name: true, email: true } } },
        take: 20,
      });
      const mapped = (tokens as Array<typeof tokens[number] & { user: { id: number; name: string; email: string } }>).map((token) => ({
        id: token.id,
        token: token.token,
        user: token.user,
        expiresAt: token.expiresAt,
        createdAt: token.createdAt,
      }));
      return res.status(200).json(mapped);
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }
}
