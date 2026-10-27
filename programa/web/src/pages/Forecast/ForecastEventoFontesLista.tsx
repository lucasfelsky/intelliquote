import { useMemo, useState } from 'react';
import { nomeDoPais } from './forecastOcasioes';
import type { FonteAtiva } from './forecastEventosAlvos';

interface Props {
  id: (campo: string) => string;
  fontesAtivas: readonly FonteAtiva[];
  marcadas: number[];
  onMudar: (ids: number[]) => void;
  desabilitado: boolean;
  erro?: string;
}

/** Fontes ativas com busca e uma caixa por fonte; a contagem mostra as marcadas mesmo as filtradas pela busca. */
export default function ForecastEventoFontesLista({ id, fontesAtivas, marcadas, onMudar, desabilitado, erro }: Props) {
  const [busca, setBusca] = useState('');
  const ordenadas = useMemo(
    () => [...fontesAtivas].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR') || a.id - b.id),
    [fontesAtivas],
  );
  const termo = busca.trim().toLocaleLowerCase('pt-BR');
  const visiveis = termo === '' ? ordenadas : ordenadas.filter((f) => f.nome.toLocaleLowerCase('pt-BR').includes(termo));
  const nomesMarcados = ordenadas.filter((f) => marcadas.includes(f.id)).map((f) => f.nome);
  const n = marcadas.length;

  const alternar = (fonteId: number, marcar: boolean) =>
    onMudar(marcar ? [...marcadas, fonteId] : marcadas.filter((m) => m !== fonteId));

  return (
    <fieldset className="fco-alvos" disabled={desabilitado}>
      <legend className="field-label">Fontes</legend>
      <label className="field-label" htmlFor={id('fonte')}>
        Buscar fonte
      </label>
      <input
        id={id('fonte')}
        className="input"
        autoComplete="off"
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        aria-invalid={erro ? true : undefined}
        aria-describedby={erro ? id('fonte-erro') : undefined}
      />
      {ordenadas.length === 0 ? (
        <p className="fcd-dica">Nenhuma fonte ativa carregada.</p>
      ) : visiveis.length === 0 ? (
        <p className="fcd-dica">Nenhuma fonte com esse nome.</p>
      ) : (
        <ul className="fco-checklist fco-checklist--rolagem">
          {visiveis.map((f) => (
            <li key={f.id}>
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={marcadas.includes(f.id)}
                  onChange={(e) => alternar(f.id, e.target.checked)}
                />
                {`${f.nome} · ${f.countryCode ? nomeDoPais(f.countryCode) : 'sem país'}`}
              </label>
            </li>
          ))}
        </ul>
      )}
      <p className="fcd-dica" aria-live="polite">
        {n === 0
          ? 'Nenhuma fonte marcada.'
          : `${n === 1 ? '1 fonte marcada' : `${n} fontes marcadas`}${n <= 5 ? `: ${nomesMarcados.join(', ')}` : ''}`}
      </p>
      {erro && (
        <p className="fcd-erro" id={id('fonte-erro')}>
          {erro}
        </p>
      )}
    </fieldset>
  );
}
