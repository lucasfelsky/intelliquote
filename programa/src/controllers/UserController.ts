import { Prisma, User } from '@prisma/client';
import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { AuditLogService } from '../services/AuditLogService';
import {
  userCreateSchema,
  userPasswordResetSchema,
  userUpdateSchema,
} from '../validators/domain';
import {
  buildPaginatedResponse,
  handleControllerError,
  hasListQuery,
  HttpError,
  parseId,
  parseOptionalQueryString,
  parsePagination,
} from '../utils/http';
import { hashPassword } from '../utils/password';

const userInclude = {
  role: true,
} as const;

export class UserController {
  static async create(req: Request, res: Response): Promise<Response> {
    try {
      const parsedBody = userCreateSchema.safeParse(req.body);

      if (!parsedBody.success) {
        return res.status(400).json({
          message:
            'Informe nome, e-mail, palavra-passe e perfil validos para o utilizador.',
        });
      }

      const payload = parsedBody.data;
      const role = await prisma.role.findUnique({
        where: { name: payload.role },
      });

      if (!role) {
        throw new HttpError(400, 'Perfil informado nao existe.');
      }

      const user = await prisma.user.create({
        data: {
          name: payload.name,
          email: payload.email,
          passwordHash: await hashPassword(payload.password),
          roleId: role.id,
        },
        include: userInclude,
      });

      const serializedUser = serializeUser(user);

      await AuditLogService.log({
        entityType: 'user',
        entityId: user.id,
        action: 'create',
        performedById: req.user?.id ?? null,
        afterData: serializedUser,
      });

      return res.status(201).json(serializedUser);
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async getAll(req: Request, res: Response): Promise<Response> {
    try {
      const where = buildUserWhere(req);
      const orderBy = { name: 'asc' } as const;

      if (!hasListQuery(req)) {
        const users = await prisma.user.findMany({
          where,
          include: userInclude,
          orderBy,
        });

        return res.status(200).json(users.map(serializeUser));
      }

      const pagination = parsePagination(req);
      const [users, totalItems] = await prisma.$transaction([
        prisma.user.findMany({
          where,
          include: userInclude,
          orderBy,
          skip: pagination.skip,
          take: pagination.take,
        }),
        prisma.user.count({ where }),
      ]);

      return res
        .status(200)
        .json(buildPaginatedResponse(users.map(serializeUser), totalItems, pagination));
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async getById(req: Request, res: Response): Promise<Response> {
    try {
      const id = parseId(req.params.id);

      if (!id) {
        return res.status(400).json({ message: 'ID do utilizador invalido.' });
      }

      const user = await prisma.user.findUnique({
        where: { id },
        include: userInclude,
      });

      if (!user) {
        return res.status(404).json({ message: 'Utilizador nao encontrado.' });
      }

      return res.status(200).json(serializeUser(user));
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async update(req: Request, res: Response): Promise<Response> {
    try {
      const id = parseId(req.params.id);

      if (!id) {
        return res.status(400).json({ message: 'ID do utilizador invalido.' });
      }

      const parsedBody = userUpdateSchema.safeParse(req.body);

      if (!parsedBody.success) {
        return res.status(400).json({
          message: 'Os dados enviados para atualizar o utilizador sao invalidos.',
        });
      }

      const payload = parsedBody.data;
      const existingUser = await prisma.user.findUnique({
        where: { id },
        include: userInclude,
      });

      if (!existingUser) {
        return res.status(404).json({ message: 'Utilizador nao encontrado.' });
      }

      if (id === req.user?.id && payload.isActive === false) {
        throw new HttpError(400, 'Nao e permitido desativar a propria conta.');
      }

      if (id === req.user?.id && payload.role && payload.role !== existingUser.role.name) {
        throw new HttpError(400, 'Nao e permitido alterar o proprio perfil.');
      }

      const nextRole = payload.role
        ? await prisma.role.findUnique({ where: { name: payload.role } })
        : null;

      if (payload.role && !nextRole) {
        throw new HttpError(400, 'Perfil informado nao existe.');
      }

      const updatedUser = await prisma.user.update({
        where: { id },
        data: {
          name: payload.name,
          email: payload.email,
          roleId: nextRole?.id,
          isActive: payload.isActive,
        },
        include: userInclude,
      });

      await AuditLogService.log({
        entityType: 'user',
        entityId: updatedUser.id,
        action: 'update',
        performedById: req.user?.id ?? null,
        beforeData: serializeUser(existingUser),
        afterData: serializeUser(updatedUser),
      });

      return res.status(200).json(serializeUser(updatedUser));
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async resetPassword(req: Request, res: Response): Promise<Response> {
    try {
      const id = parseId(req.params.id);

      if (!id) {
        return res.status(400).json({ message: 'ID do utilizador invalido.' });
      }

      const parsedBody = userPasswordResetSchema.safeParse(req.body);

      if (!parsedBody.success) {
        return res.status(400).json({
          message: 'Informe uma nova palavra-passe com pelo menos 8 caracteres.',
        });
      }

      const existingUser = await prisma.user.findUnique({
        where: { id },
        include: userInclude,
      });

      if (!existingUser) {
        return res.status(404).json({ message: 'Utilizador nao encontrado.' });
      }

      const updatedUser = await prisma.$transaction(async (tx) => {
        const user = await tx.user.update({
          where: { id },
          data: {
            passwordHash: await hashPassword(parsedBody.data.password),
          },
          include: userInclude,
        });

        await tx.session.updateMany({
          where: {
            userId: id,
            revokedAt: null,
          },
          data: {
            revokedAt: new Date(),
          },
        });

        await AuditLogService.log(
          {
            entityType: 'user',
            entityId: user.id,
            action: 'reset_password',
            performedById: req.user?.id ?? null,
            beforeData: serializeUser(existingUser),
            afterData: serializeUser(user),
            metadata: {
              revokedActiveSessions: true,
            },
          },
          tx,
        );

        return user;
      });

      return res.status(200).json(serializeUser(updatedUser));
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }
}

function buildUserWhere(req: Request): Prisma.UserWhereInput {
  const search = parseOptionalQueryString(req.query.search);
  const role = parseOptionalQueryString(req.query.role);
  const status = parseOptionalQueryString(req.query.status);
  const where: Prisma.UserWhereInput = {};

  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
    ];
  }

  if (role && role !== 'all') {
    where.role = {
      name: role,
    };
  }

  if (status === 'active') {
    where.isActive = true;
  }

  if (status === 'inactive') {
    where.isActive = false;
  }

  return where;
}

function serializeUser(user: User & { role: { name: string } }) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role.name,
    isActive: user.isActive,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
