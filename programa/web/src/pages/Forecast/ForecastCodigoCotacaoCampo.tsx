import { useId } from 'react';

interface Props {
  fonte: string;
  valor: string;
  desabilitado: boolean;
  onChange: (valor: string) => void;
}

// Codigo da cotacao (opcional) da fonte no pop-up "Criar cotacao". Vazio = o servidor gera o codigo. Sem formato proprio:
// o servidor aplica trim + maiusculas e recusa codigo ja usado (inclusive de cotacao excluida).
export function ForecastCodigoCotacaoCampo({ fonte, valor, desabilitado, onChange }: Props) {
  const id = useId();
  const idDica = `${id}-dica`;
  return (
    <div className="fcl-codigo-cotacao">
      <label className="fcl-rotulo" htmlFor={id}>
        Código da cotação (opcional)
      </label>
      <input
        id={id}
        type="text"
        className="input"
        aria-label={`Código da cotação da fonte ${fonte}`}
        aria-describedby={idDica}
        placeholder="Será gerado automaticamente"
        autoComplete="off"
        value={valor}
        disabled={desabilitado}
        onChange={(e) => onChange(e.target.value)}
      />
      <span id={idDica} className="fcl-dica">
        Será gerado automaticamente se ficar em branco.
      </span>
    </div>
  );
}
