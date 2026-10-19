import 'dotenv/config';
import { app } from './app';
import { logger } from './lib/logger';
import { startExchangeRateScheduler } from './lib/scheduler';

const PORT = Number(process.env.PORT) || 3000;

app.listen(PORT, () => {
  logger.info({ port: PORT }, `IntelliQuote API running on port ${PORT}`);
});

// Jobs agendados (PTAX diaria e lembretes pre-deadline) rodam via Cloud Scheduler
// em /api/internal/jobs/*; aqui so o refresh de boot fora de producao.
startExchangeRateScheduler();
