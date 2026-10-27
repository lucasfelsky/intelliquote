import { textoAvisoModoTeste } from './forecastModoTeste';

interface Props {
  ligado: boolean;
  onMudar: (ligado: boolean) => void;
  rotulo: string;
  yearMonth: string | null;
  /** Textos opcionais (a previa DBCorp tem os proprios); sem eles valem os da planilha. */
  texto?: string;
  dica?: string;
  aviso?: string;
}

/** Atalho "Importar como teste": caixa + dica + regiao de status estavel (so o conteudo do aviso e condicional). */
export default function ForecastImportarComoTeste({ ligado, onMudar, rotulo, yearMonth, texto, dica, aviso }: Props) {
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
        {texto ?? 'Importar como teste (não altera cadastro nem histórico)'}
        <span id="fit-dica" className="fit-dica">
          {dica ?? 'Só cria a quinzena, que pode ser excluída depois.'}
        </span>
      </label>
      <div role="status" className="fit-status">
        {ligado && (
          <p id="fit-aviso" className="fit-aviso">
            {aviso ?? textoAvisoModoTeste(rotulo, yearMonth)}
          </p>
        )}
      </div>
    </>
  );
}
