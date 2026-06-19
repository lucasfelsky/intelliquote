import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import path from 'path';
import { authEnv } from './config/env';
import { router } from './routes';
import { HealthService } from './services/HealthService';
import { portalRoutes } from './routes/PortalRoutes';
import { exchangeRateRoutes } from './routes/ExchangeRateRoutes';

const app = express();
const publicPath = process.env.NODE_ENV === 'production'
  ? path.join(process.cwd(), 'dist', 'public')
  : path.join(process.cwd(), 'public');
const allowedOrigins = new Set(authEnv.corsOrigins);

app.set('trust proxy', 1);

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
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
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
// Ja a rota raiz "/" e o `index.html` legacy continuam sendo servidos
// como uma camada extra de fallback para diagnostico; sera removida
// na Fase 8 (cleanup) junto com `public/index.html` e `public/app.js`.
app.get('/', (_req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

// Portal publico do fornecedor: suppliers recebem links magicos
// (ex: intelliquote-api-...run.app/portal?token=...) e esta pagina
// consome `/api/portal/:token`. A pagina em si continua sendo HTML
// estatico (sem dependencia do bundle React) ate migrarmos.
app.get('/portal', (_req, res) => {
  res.sendFile(path.join(publicPath, 'portal.html'));
});

export { app };
