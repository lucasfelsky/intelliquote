import { Prisma, User } from '@prisma/client';
import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { AuditLogService } from '../services/AuditLogService';
import {
  accountSignatureImageSchema,
  accountSignatureTextSchema,
  userCreateSchema,
  userPasswordResetSchema,
  userUpdateSchema,
} from '../validators/domain';
import { detectImage } from '../utils/imageInfo';
import { buildPoSenderSignature } from '../mailer/renderQuotePo';
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

// Limites da imagem da assinatura de e-mail (sem redimensionamento no
// servidor: fora do limite, o usuario precisa reduzir a imagem).
const SIGNATURE_IMAGE_MAX_BYTES = 300 * 1024;
const SIGNATURE_IMAGE_MAX_WIDTH = 600;
const SIGNATURE_IMAGE_MAX_HEIGHT = 300;
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;

function decodeSignatureImage(contentBase64: string): Buffer {
  const withoutPrefix = contentBase64.startsWith('data:')
    ? contentBase64.slice(contentBase64.indexOf(',') + 1)
    : contentBase64;
  const normalized = withoutPrefix.replace(/\s+/g, '');
  // Teto do base64 antes de decodificar (evita alocar buffer enorme).
  if (normalized.length > Math.ceil((SIGNATURE_IMAGE_MAX_BYTES * 4) / 3) + 8) {
    throw new HttpError(400, 'A imagem excede o limite de 300 KB.');
  }
  if (normalized.length === 0 || normalized.length % 4 !== 0 || !BASE64_PATTERN.test(normalized)) {
    throw new HttpError(400, 'Conteudo base64 da imagem invalido.');
  }
  return Buffer.from(normalized, 'base64');
}

function serializeSignatureImage(row: {
  imageData: Uint8Array | null;
  imageMimeType: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
  imageSize: number | null;
}) {
  if (!row.imageData || !row.imageMimeType) return null;
  return {
    dataUri: `data:${row.imageMimeType};base64,${Buffer.from(row.imageData).toString('base64')}`,
    mimeType: row.imageMimeType,
    width: row.imageWidth,
    height: row.imageHeight,
    size: row.imageSize,
  };
}

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

  // ---- Assinatura de e-mail do PROPRIO usuario (/account/email-signature*) ----
  // Sempre sobre req.user.id: nenhuma rota recebe :id (admin nao edita a
  // assinatura de outro usuario -- ela sai em e-mail externo em nome da pessoa).

  static async getEmailSignature(req: Request, res: Response): Promise<Response> {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ message: 'Autenticacao necessaria.' });
      }

      const signature = await prisma.userEmailSignature.findUnique({
        where: { userId: user.id },
      });

      return res.status(200).json({
        name: user.name,
        email: user.email,
        text: signature?.text ?? null,
        image: signature ? serializeSignatureImage(signature) : null,
        fallbackSignature: buildPoSenderSignature({
          name: user.name,
          email: user.email,
          hasImage: false,
        }).plainText.replace(/\r\n/g, '\n'),
      });
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async updateEmailSignatureText(req: Request, res: Response): Promise<Response> {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ message: 'Autenticacao necessaria.' });
      }

      const parsedBody = accountSignatureTextSchema.safeParse(req.body ?? {});
      if (!parsedBody.success) {
        return res.status(400).json({
          message: parsedBody.error.issues[0]?.message ?? 'Dados invalidos.',
        });
      }

      const { text } = parsedBody.data;
      await prisma.userEmailSignature.upsert({
        where: { userId: user.id },
        create: { userId: user.id, text },
        update: { text },
      });

      await AuditLogService.log({
        entityType: 'user',
        entityId: user.id,
        action: 'update_email_signature_text',
        performedById: user.id,
        metadata: { hasText: text !== null, length: text?.length ?? 0 },
      });

      return res.status(200).json({ text });
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async updateEmailSignatureImage(req: Request, res: Response): Promise<Response> {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ message: 'Autenticacao necessaria.' });
      }

      const parsedBody = accountSignatureImageSchema.safeParse(req.body ?? {});
      if (!parsedBody.success) {
        return res.status(400).json({
          message: parsedBody.error.issues[0]?.message ?? 'Dados invalidos.',
        });
      }

      const buffer = decodeSignatureImage(parsedBody.data.contentBase64);
      if (buffer.length === 0) {
        throw new HttpError(400, 'Conteudo da imagem vazio.');
      }
      if (buffer.length > SIGNATURE_IMAGE_MAX_BYTES) {
        throw new HttpError(400, 'A imagem excede o limite de 300 KB.');
      }

      const detected = detectImage(buffer);
      if (!detected) {
        throw new HttpError(400, 'Arquivo de imagem invalido. Use PNG ou JPEG.');
      }
      if (detected.mimeType !== parsedBody.data.fileType) {
        throw new HttpError(
          400,
          'O tipo da imagem enviada nao corresponde ao conteudo do arquivo.',
        );
      }
      if (
        detected.width > SIGNATURE_IMAGE_MAX_WIDTH ||
        detected.height > SIGNATURE_IMAGE_MAX_HEIGHT
      ) {
        throw new HttpError(
          400,
          `Redimensione para no maximo ${SIGNATURE_IMAGE_MAX_WIDTH}x${SIGNATURE_IMAGE_MAX_HEIGHT} px.`,
        );
      }

      const imageFields = {
        imageData: new Uint8Array(buffer),
        imageMimeType: detected.mimeType,
        imageWidth: detected.width,
        imageHeight: detected.height,
        imageSize: buffer.length,
      };
      await prisma.userEmailSignature.upsert({
        where: { userId: user.id },
        create: { userId: user.id, ...imageFields },
        update: imageFields,
      });

      const image = {
        dataUri: `data:${detected.mimeType};base64,${buffer.toString('base64')}`,
        mimeType: detected.mimeType,
        width: detected.width,
        height: detected.height,
        size: buffer.length,
      };

      // Os bytes da imagem NAO entram no AuditLog.
      await AuditLogService.log({
        entityType: 'user',
        entityId: user.id,
        action: 'update_email_signature_image',
        performedById: user.id,
        metadata: {
          mimeType: detected.mimeType,
          width: detected.width,
          height: detected.height,
          size: buffer.length,
        },
      });

      return res.status(200).json({ image });
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async deleteEmailSignatureImage(req: Request, res: Response): Promise<Response> {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ message: 'Autenticacao necessaria.' });
      }

      // updateMany: idempotente (sem registro, nao ha o que zerar).
      await prisma.userEmailSignature.updateMany({
        where: { userId: user.id },
        data: {
          imageData: null,
          imageMimeType: null,
          imageWidth: null,
          imageHeight: null,
          imageSize: null,
        },
      });

      await AuditLogService.log({
        entityType: 'user',
        entityId: user.id,
        action: 'delete_email_signature_image',
        performedById: user.id,
      });

      return res.status(204).send();
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
