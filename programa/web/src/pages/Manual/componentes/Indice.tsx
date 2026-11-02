import { Fragment, type MouseEvent } from 'react';
import { agruparCapitulos, type CapituloMeta } from '../capitulos';

interface IndiceProps {
  capitulos: readonly CapituloMeta[];
  ativo: string;
  onIr: (id: string) => void;
}

// Indice lateral (>= 1200): grupos + capitulos; o ativo (scrollspy) leva aria-current="location". Some abaixo de 1200 (CSS), onde entra o seletor.
export function Indice({ capitulos, ativo, onIr }: IndiceProps) {
  const grupos = agruparCapitulos(capitulos);
  return (
    <nav className="manual-indice" aria-label="Capítulos do manual">
      {grupos.map((grupo, i) => {
        const idGrupo = `manual-indice-grupo-${i}`;
        return (
          <Fragment key={grupo.grupo}>
            <p id={idGrupo} className="manual-indice__grupo">
              {grupo.grupo}
            </p>
            <ul className="manual-indice__lista" aria-labelledby={idGrupo}>
              {grupo.itens.map((capitulo) => {
                const ehAtivo = capitulo.id === ativo;
                return (
                  <li key={capitulo.id}>
                    <a
                      href={`#${capitulo.id}`}
                      className={ehAtivo ? 'manual-indice__link manual-indice__link--ativo' : 'manual-indice__link'}
                      aria-current={ehAtivo ? 'location' : undefined}
                      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
                        e.preventDefault();
                        onIr(capitulo.id);
                      }}
                    >
                      <span className="manual-indice__n">{capitulo.etapa ?? ''}</span>{' '}
                      <span>{capitulo.titulo}</span>
                    </a>
                  </li>
                );
              })}
            </ul>
          </Fragment>
        );
      })}
    </nav>
  );
}

// Seletor de capitulo (< 1200): no lugar do indice, mesma ordem e mesmos grupos.
export function SeletorCapitulo({ capitulos, ativo, onIr }: IndiceProps) {
  const grupos = agruparCapitulos(capitulos);
  return (
    <div className="manual-indice-select">
      <label className="field-label" htmlFor="manual-indice-select">
        Ir para o capítulo
      </label>
      <select id="manual-indice-select" className="select" value={ativo} onChange={(e) => onIr(e.target.value)}>
        {grupos.map((grupo) => (
          <optgroup key={grupo.grupo} label={grupo.grupo}>
            {grupo.itens.map((capitulo) => (
              <option key={capitulo.id} value={capitulo.id}>
                {capitulo.etapa ? `${capitulo.etapa}. ${capitulo.titulo}` : capitulo.titulo}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}
