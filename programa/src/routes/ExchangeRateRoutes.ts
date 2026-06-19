import { Router } from 'express';

import { allowRoles, requireAuth } from '../middlewares/auth';
import { ExchangeRateService } from '../services/ExchangeRateService';
import { handleControllerError } from '../utils/http';

const router = Router();

// Endpoint publico (somente leitura) usado pelo portal do fornecedor para
// saber se ha taxa PTAX em cache para a moeda da cotacao, e assim poder
// esconder o campo de taxa no formulario.
router.get('/api/exchange-rates/current', async (req, res) => {
  try {
    const currency = String(req.query.currency ?? '').trim().toUpperCase();
    if (!currency) {
      const all = await ExchangeRateService.listLatest();
      res.status(200).json({ rates: all });
      return;
    }
    const rate = await ExchangeRateService.getRateToBrl(currency);
    res.status(200).json({ currency, rate });
  } catch (error) {
    const handled = handleControllerError(error);
    res.status(handled.status).json({ message: handled.message });
  }
});

// Endpoint administrativo para forcar refresh manual da PTAX.
router.post(
  '/api/exchange-rates/refresh',
  requireAuth,
  allowRoles(['admin']),
  async (_req, res) => {
    try {
      const snapshots = await ExchangeRateService.refresh();
      res.status(200).json({ refreshed: snapshots.length, snapshots });
    } catch (error) {
      const handled = handleControllerError(error);
      res.status(handled.status).json({ message: handled.message });
    }
  },
);

export { router as exchangeRateRoutes };
