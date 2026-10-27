import { useEffect, useRef, useState } from 'react';
import type { AbaFontes } from './ForecastFontesModal';

/**
 * Estado e foco do dialogo aberto pelos dois botoes do cabecalho ("Fontes e lead time" e "Eventos estrangeiros"):
 * `aba` = aba aberta primeiro (`null` = fechado); ao fechar, o foco volta ao botao que abriu.
 */
export function useDialogoFontes() {
  const [aba, setAba] = useState<AbaFontes | null>(null);
  const botaoFontes = useRef<HTMLButtonElement>(null);
  const botaoEventos = useRef<HTMLButtonElement>(null);
  const abriuDe = useRef<AbaFontes | null>(null);

  useEffect(() => {
    if (aba !== null) {
      abriuDe.current = aba;
      return;
    }
    const origem = abriuDe.current;
    if (origem !== null) {
      abriuDe.current = null;
      (origem === 'ocasioes' ? botaoEventos : botaoFontes).current?.focus();
    }
  }, [aba]);

  return { aba, abrir: (a: AbaFontes) => setAba(a), fechar: () => setAba(null), botaoFontes, botaoEventos };
}
