import { Icon } from '@/components/icons';
import { forecastErrorMessage } from '@/services/forecast';
import { TEXTO_GERANDO_MACRO, textoMacroGerada, useBaixarPlanilhaMacro } from './useBaixarPlanilhaMacro';

interface Props {
  snapshotId: number;
  /** AAAA-MM-DD da quinzena (`detail.hoje`): o mesmo que o relatorio de compras envia. */
  hoje: string;
}

// Devolve um fragmento: o botao fica direto em `.fc-cabecalho__acoes` (o grupo de acoes do cabecalho) e as mensagens ocupam a linha
// inteira. Montar com `key` da quinzena para limpar sucesso/erro ao trocar de quinzena.
export default function ForecastExportarMacro({ snapshotId, hoje }: Props) {
  const macro = useBaixarPlanilhaMacro(snapshotId);
  return (
    <>
      <button
        type="button"
        className="ghost-button"
        disabled={macro.isPending}
        aria-busy={macro.isPending}
        onClick={() => macro.mutate(hoje)}
      >
        <Icon name="file-x" size={16} />
        {macro.isPending ? TEXTO_GERANDO_MACRO : 'Exportar planilha MACRO (XLSX)'}
      </button>
      {macro.isError && (
        <p role="alert" className="fcme-msg fcme-msg--erro">
          {forecastErrorMessage(macro.error)}
        </p>
      )}
      {macro.isSuccess && (
        <p role="status" className="fcme-msg">
          {textoMacroGerada(macro.data.fileName)}
        </p>
      )}
    </>
  );
}
