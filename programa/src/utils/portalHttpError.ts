import { HttpError } from './http';

/**
 * HttpError cuja mensagem ja esta em ingles e e segura para o fornecedor.
 * As rotas publicas do portal so repassam `message` para instancias desta
 * classe; qualquer outro HttpError (codigo compartilhado com o comprador, em
 * portugues) e traduzido na borda. Estende HttpError, entao `instanceof
 * HttpError` e o status continuam funcionando (ex.: lockout em 404).
 */
export class PortalHttpError extends HttpError {
  constructor(status: number, message: string, code?: string) {
    super(status, message, code);
    this.name = 'PortalHttpError';
  }
}
