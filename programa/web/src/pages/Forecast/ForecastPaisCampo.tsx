import { useState } from 'react';
import type { OpcaoPais } from './forecastOcasioes';

interface Props {
  id: string;
  /** Codigo ISO-2 atual ('' = nenhum). */
  valor: string;
  onMudar: (codigo: string) => void;
  opcoes: readonly OpcaoPais[];
  /** Aceita "sem pais" (a opcao vazia vira `Sem país`). */
  permitirVazio?: boolean;
  rotuloVazio?: string;
  invalido?: boolean;
  descritoPor?: string;
  desabilitado?: boolean;
  rotulo: string;
}

const OUTRO = '__outro';

const rotuloDaOpcao = (o: OpcaoPais): string => (o.nome === o.codigo ? o.codigo : `${o.nome} (${o.codigo})`);

/** Select de pais com a lista comum e "Outro (codigo ISO)" (campo de 2 letras, sempre em maiusculas). */
export default function ForecastPaisCampo({
  id,
  valor,
  onMudar,
  opcoes,
  permitirVazio = false,
  rotuloVazio,
  invalido,
  descritoPor,
  desabilitado,
  rotulo,
}: Props) {
  const [escolheuOutro, setEscolheuOutro] = useState(false);
  const foraDaLista = valor !== '' && !opcoes.some((o) => o.codigo === valor);
  const mostrarOutro = escolheuOutro || foraDaLista;

  return (
    <div className="fco-pais">
      <select
        id={id}
        className="select"
        aria-label={rotulo}
        value={mostrarOutro ? OUTRO : valor}
        onChange={(e) => {
          const v = e.target.value;
          if (v === OUTRO) {
            setEscolheuOutro(true);
            onMudar('');
          } else {
            setEscolheuOutro(false);
            onMudar(v);
          }
        }}
        aria-invalid={invalido ? true : undefined}
        aria-describedby={descritoPor}
        disabled={desabilitado}
      >
        <option value="">{rotuloVazio ?? (permitirVazio ? 'Sem país' : 'Escolha o país')}</option>
        {opcoes.map((o) => (
          <option key={o.codigo} value={o.codigo}>
            {rotuloDaOpcao(o)}
          </option>
        ))}
        <option value={OUTRO}>Outro (código ISO)</option>
      </select>
      {mostrarOutro && (
        <input
          className="input fco-pais__codigo"
          maxLength={2}
          autoCapitalize="characters"
          autoComplete="off"
          aria-label="Código ISO do país (2 letras)"
          value={valor}
          onChange={(e) => onMudar(e.target.value.toUpperCase())}
          aria-invalid={invalido ? true : undefined}
          aria-describedby={descritoPor}
          disabled={desabilitado}
        />
      )}
    </div>
  );
}
