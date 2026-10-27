import { useId, useState } from 'react';
import {
  MODELOS,
  TABELA_LUNAR_ATE,
  anosDoModelo,
  preencherComModelo,
  rotuloDoModelo,
  type PreenchimentoModelo,
  type TipoModelo,
} from './forecastOcasioesModelos';

interface Props {
  hoje: string;
  desabilitado: boolean;
  registrarBotao: (chave: string, el: HTMLButtonElement | null) => void;
  onUsar: (preenchimento: PreenchimentoModelo) => void;
}

const GRUPOS: Array<[TipoModelo, string]> = [
  ['fixo', 'Datas fixas (repetem todo ano)'],
  ['pascoa', 'Baseadas na Páscoa (uma por ano)'],
  ['lunar', 'Calendário lunar (uma por ano)'],
];

/** Escolhe um modelo e um ano e so PREENCHE o formulario (nada e gravado ate o usuario salvar). */
export default function ForecastUsarModelo({ hoje, desabilitado, registrarBotao, onUsar }: Props) {
  const baseId = useId();
  const [modeloId, setModeloId] = useState(MODELOS[0]?.id ?? '');
  const [anoEscolhido, setAnoEscolhido] = useState<number | null>(null);

  const modelo = MODELOS.find((m) => m.id === modeloId) ?? MODELOS[0];
  if (!modelo) return null;
  const anos = anosDoModelo(modelo, hoje);
  const ano = anoEscolhido !== null && anos.includes(anoEscolhido) ? anoEscolhido : (anos[0] ?? null);
  const semAno = ano === null;

  const preencher = () => {
    if (ano === null) return;
    const p = preencherComModelo(modelo, ano);
    if (p) onUsar(p);
  };

  return (
    <fieldset className="fco-modelos" disabled={desabilitado}>
      <legend className="field-label">Usar um modelo</legend>
      <div className="fcd-campo">
        <label className="field-label" htmlFor={`${baseId}-modelo`}>
          Modelo
        </label>
        <select id={`${baseId}-modelo`} className="select" value={modelo.id} onChange={(e) => setModeloId(e.target.value)}>
          {GRUPOS.map(([tipo, rotulo]) => (
            <optgroup key={tipo} label={rotulo}>
              {MODELOS.filter((m) => m.tipo === tipo).map((m) => (
                <option key={m.id} value={m.id}>
                  {rotuloDoModelo(m)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      <div className="fcd-campo">
        <label className="field-label" htmlFor={`${baseId}-ano`}>
          Ano
        </label>
        <select
          id={`${baseId}-ano`}
          className="select"
          value={ano === null ? '' : String(ano)}
          onChange={(e) => setAnoEscolhido(Number(e.target.value))}
          disabled={semAno}
        >
          {anos.map((a) => (
            <option key={a} value={String(a)}>
              {a}
            </option>
          ))}
        </select>
      </div>
      <p className="fcd-dica">{modelo.nota}</p>
      {semAno && (
        <p className="fcd-dica">A tabela do Ano Novo chinês cobre até {TABELA_LUNAR_ATE}: atualize o catálogo.</p>
      )}
      <button
        ref={(el) => registrarBotao('modelo', el)}
        type="button"
        className="ghost-button"
        onClick={preencher}
        disabled={semAno}
      >
        Preencher o formulário
      </button>
    </fieldset>
  );
}
