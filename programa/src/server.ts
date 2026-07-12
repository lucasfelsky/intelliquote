import 'dotenv/config';
import { app } from './app';
import { logger } from './lib/logger';
import { startExchangeRateScheduler } from './lib/scheduler';
import { startSupplierReminderScheduler } from './lib/reminderScheduler';

const PORT = Number(process.env.PORT) || 3000;

app.listen(PORT, () => {
  logger.info({ port: PORT }, `IntelliQuote API running on port ${PORT}`);
});

startExchangeRateScheduler();
startSupplierReminderScheduler();
