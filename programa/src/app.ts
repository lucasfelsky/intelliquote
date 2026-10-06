import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import path from 'path';
import { authEnv } from './config/env';
import {
  ATTACHMENT_JSON_BODY_LIMIT_BYTES,
  ATTACHMENT_TOO_LARGE_MESSAGE,
} from './constants/attachments';
import { router } from './routes';
import { HealthService } from './services/HealthService';
import { portalRoutes } from './routes/PortalRoutes';
import { exchangeRateRoutes } from './routes/ExchangeRateRoutes';
import { requireAuthBeforeBody } from './middlewares/auth';
import { traceIdMiddleware } from './middlewares/traceId';

const app = express();
const publicPath = process.env.NODE_ENV === 'production'
  ? path.join(process.cwd(), 'dist', 'public')
  : path.join(process.cwd(), 'public');
const allowedOrigins = new Set(authEnv.corsOrigins);

app.set('trust proxy', 1);

// traceId vem antes de tudo: erros de parse de JSON, CORS e auth também
// ganham um id de correlação no log.
app.use(traceIdMiddleware);

app.use(
  helmet({
    contentSecurityPolicy: false,
  }),
);
app.use(
  cors({
    credentials: true,
    origin: (origin, callback) => {
      // Sem Origin = request server-to-server (curl, Firebase Hosting rewrite,
      // Cloud Run proxy, etc). Permitimos para nao bloquear o rewrite.
      if (!origin) {
        callback(null, true);
        return;
      }
      if (allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error('Origin nao permitida pelo CORS.'));
    },
  }),
);
// Handler para preflight/POST que cai no throw acima (origin nao permitida).
// Sem isso o Express devolve HTML 500, e a SPA quebra com "Unexpected token '<'".
app.use((err: Error & { status?: number }, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err?.message?.includes('Origin nao permitida')) {
    res.status(403).json({ message: 'Origem não autorizada.' });
    return;
  }
  next(err);
});

// A autenticacao antecipada precisa dos cookies (nao le o corpo).
app.use(cookieParser());

// Nos prefixos com parser grande, sem login responde 401 antes de bufferizar/parsear
// o corpo; o corpo e drenado para o cliente receber o 401 (nao ECONNRESET), como o
// body-parser faz no 413. O requireAuth das rotas continua valendo.
// Aumentar o limite apenas para as rotas de importação (onde enviamos a planilha base64)
app.use('/api/v1/catalog-items/import', requireAuthBeforeBody, express.json({ limit: '10mb' }));
app.use('/api/v1/suppliers/import', requireAuthBeforeBody, express.json({ limit: '10mb' }));

// Idem para /quote-responses: o botão "Enviar Ordem de Compra" envia um PDF
// em base64 no corpo (POST /:id/purchase-order). Sem este override, o
// parser global de 1mb abaixo rejeita (413) qualquer PDF acima de ~740KB
// ANTES de chegar ao controller. O corpo do reply (mesmo prefixo) é minúsculo,
// sem efeito colateral prático em aumentar o limite aqui também.
// Rota interna autenticada (o portal do fornecedor usa /api/portal/:token, nao este prefixo).
app.use('/api/v1/quote-responses', requireAuthBeforeBody, express.json({ limit: '10mb' }));

// /attachments recebe o arquivo em base64 no JSON (limite de negocio: 5MB).
// Com o parser global de 1mb, qualquer anexo acima de ~740KB seria rejeitado
// com 413 em HTML antes de chegar ao controller. Limite derivado do maximo de
// negocio + overhead do base64; o 413 vira JSON com mensagem amigavel.
app.use(
  '/api/v1/attachments',
  requireAuthBeforeBody,
  express.json({ limit: ATTACHMENT_JSON_BODY_LIMIT_BYTES }),
);
app.use(
  '/api/v1/attachments',
  (err: Error & { type?: string }, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err?.type === 'entity.too.large') {
      res.status(413).json({ message: ATTACHMENT_TOO_LARGE_MESSAGE });
      return;
    }
    next(err);
  },
);

// Limite global de payload para os demais endpoints (proteção genérica)
app.use(express.json({ limit: '1mb' }));
app.use(portalRoutes);
app.use(exchangeRateRoutes);
app.use(router);
app.use(express.static(publicPath));

app.get('/health/live', (_req, res) => {
  res.status(200).json(HealthService.getLiveness());
});

app.get('/health/ready', async (_req, res) => {
  const payload = await HealthService.getReadiness();
  res.status(payload.status === 'ok' ? 200 : 503).json(payload);
});

app.get('/health', async (_req, res) => {
  const payload = await HealthService.getReadiness();
  res.status(payload.status === 'ok' ? 200 : 503).json({
    ...payload,
    buildTag: process.env.BACKEND_BUILD_TAG ?? 'dev',
  });
});

// Serve o bundle SPA React como fallback se o Firebase Hosting cair
// e o usuario acessar o Cloud Run direto. O React app e copiado
// para dist/public/web/ pelo Dockerfile (quando SPA estiver embarcada
// no container); hoje em producao, o index.html servindo e o do Firebase Hosting.
//
// A raiz "/" passa a responder 404 explicito: o frontend React vive
// no Firebase Hosting (intelliquote.portal-comex.com) e nao no Cloud Run.
// Isso substitui o legado `public/index.html` removido na Fase 8.
app.get('/', (_req, res) => {
  res.status(404).json({
    message:
      'API IntelliQuote. O frontend React vive no Firebase Hosting; este endpoint serve apenas /api/** e /portal.',
  });
});

// Portal publico do fornecedor: suppliers recebem links magicos
// (ex: intelliquote-api-...run.app/portal?token=...) e esta pagina
// consome `/api/portal/:token`. A pagina em si continua sendo HTML
// estatico (sem dependencia do bundle React) ate migrarmos.
app.get('/portal', (_req, res) => {
  // Forca revalidacao (ETag/304 continuam validos) para o fornecedor nao ficar
  // preso a uma versao antiga do portal.html em cache.
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(publicPath, 'portal.html'));
});

export { app };
