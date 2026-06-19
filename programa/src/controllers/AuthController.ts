import type { CookieOptions, Request, Response } from 'express';
import { z } from 'zod';
import { authEnv } from '../config/env';
import { AuthService } from '../services/AuthService';
import {
  ACCESS_TOKEN_COOKIE_NAME,
  getAccessTokenMaxAgeMs,
  getRefreshTokenMaxAgeMs,
  REFRESH_TOKEN_COOKIE_NAME,
} from '../utils/tokens';
import { handleControllerError, HttpError } from '../utils/http';

const loginSchema = z.object({
  email: z.string().email('Informe um e-mail valido.'),
  password: z.string().min(1, 'Informe a palavra-passe.'),
});

const baseCookieOptions: CookieOptions = {
  httpOnly: true,
  path: '/',
  sameSite: 'lax',
  secure: authEnv.cookieSecure,
};

export class AuthController {
  static async login(req: Request, res: Response): Promise<Response> {
    try {
      const data = loginSchema.parse(req.body);
      const result = await AuthService.login(data);

      setAuthCookies(res, result.accessToken, result.refreshToken);

      return res.status(200).json({
        user: result.user,
      });
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async refresh(req: Request, res: Response): Promise<Response> {
    try {
      const fromCookie = req.cookies?.[REFRESH_TOKEN_COOKIE_NAME];
      const fromBody =
        typeof req.body?.refreshToken === 'string' ? req.body.refreshToken : undefined;
      const refreshToken = fromCookie ?? fromBody;

      if (!refreshToken) {
        throw new HttpError(401, 'Refresh token ausente.');
      }

      const result = await AuthService.refresh(refreshToken);
      setAuthCookies(res, result.accessToken, result.refreshToken);

      return res.status(200).json({
        user: result.user,
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        expiresIn: Math.floor(getAccessTokenMaxAgeMs() / 1000),
      });
    } catch (error) {
      clearAuthCookies(res);
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async logout(req: Request, res: Response): Promise<Response> {
    try {
      await AuthService.logout(req.cookies?.[REFRESH_TOKEN_COOKIE_NAME]);
      clearAuthCookies(res);
      return res.status(204).send();
    } catch (error) {
      clearAuthCookies(res);
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async me(req: Request, res: Response): Promise<Response> {
    try {
      if (!req.user) {
        throw new HttpError(401, 'Utilizador nao autenticado.');
      }

      return res.status(200).json({
        user: req.user,
      });
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }
}

function setAuthCookies(
  res: Response,
  accessToken: string,
  refreshToken: string,
): void {
  res.cookie(ACCESS_TOKEN_COOKIE_NAME, accessToken, {
    ...baseCookieOptions,
    maxAge: getAccessTokenMaxAgeMs(),
  });
  res.cookie(REFRESH_TOKEN_COOKIE_NAME, refreshToken, {
    ...baseCookieOptions,
    maxAge: getRefreshTokenMaxAgeMs(),
  });
}

function clearAuthCookies(res: Response): void {
  res.clearCookie(ACCESS_TOKEN_COOKIE_NAME, baseCookieOptions);
  res.clearCookie(REFRESH_TOKEN_COOKIE_NAME, baseCookieOptions);
}
