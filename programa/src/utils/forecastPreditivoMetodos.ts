// Forecast preditivo (fase 0): registro unico dos metodos.
import { METODOS_BASELINE } from './forecastPreditivoBaselines';
import { METODOS_INTERMITENTE } from './forecastPreditivoIntermitente';
import { METODOS_SUAVIZACAO } from './forecastPreditivoSuavizacao';
import type { Metodo, MetodoId } from './forecastPreditivoTipos';

export const METODOS: Readonly<Record<MetodoId, Metodo>> = {
  ...METODOS_BASELINE,
  ...METODOS_SUAVIZACAO,
  ...METODOS_INTERMITENTE,
};
