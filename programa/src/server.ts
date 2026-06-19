import 'dotenv/config';
import { app } from './app';
import { startExchangeRateScheduler } from './lib/scheduler';

const PORT = Number(process.env.PORT) || 3000;

app.listen(PORT, () => {
  console.log(`IntelliQuote API running on port ${PORT}`);
});

startExchangeRateScheduler();
