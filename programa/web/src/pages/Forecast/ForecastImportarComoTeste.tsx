import { textoAvisoModoTeste } from './forecastModoTeste';

interface Props {
  ligado: boolean;
  onMudar: (ligado: boolean) => void;
  rotulo: string;
  yearMonth: string | null;
}

/** Atalho "Importar como teste": caixa + dica + regiao de status estavel (so o conteudo do aviso e condicional). */
export default function ForecastImportarComoTeste({ ligado, onMudar, rotulo, yearMonth }: Props) {
  return (
    <>
      <label className="checkbox-field fit-alternancia">
        <input
          type="checkbox"
          id="fit-alternar"
          checked={ligado}
          onChange={(e) => onMudar(e.target.checked)}
          aria-describedby="fit-dica"
        />
        Importar como teste (não altera cadastro nem histórico)
        <span id="fit-dica" className="fit-dica">
          Só cria a quinzena, que pode ser excluída depois.
        </span>
      </label>
      <div role="status" className="fit-status">
        {ligado && (
          <p id="fit-aviso" className="fit-aviso">
            {textoAvisoModoTeste(rotulo, yearMonth)}
          </p>
        )}
      </div>
    </>
  );
}
