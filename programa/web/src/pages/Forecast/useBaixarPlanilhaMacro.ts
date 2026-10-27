// Download da planilha no layout da aba FORECAST (MACRO) do PO.COMP.01. Compartilhado entre o relatorio de compras e
// o cabecalho do painel: mesma chamada (rota do XLSX com layout=macro) e mesmos textos de estado.
import { useMutation } from '@tanstack/react-query';
import { baixarForecastRelatorioXlsx } from '@/services/forecast';

export const TEXTO_GERANDO_MACRO = 'Gerando planilha MACRO…';

export const textoMacroGerada = (fileName: string): string => `Planilha MACRO gerada: ${fileName}`;

/** `mutate(hoje)` com o `hoje` (AAAA-MM-DD) da quinzena: o arquivo sai igual onde quer que seja pedido. */
export function useBaixarPlanilhaMacro(snapshotId: number) {
  return useMutation({
    mutationFn: (hoje: string) => baixarForecastRelatorioXlsx(snapshotId, hoje, 'macro'),
  });
}
