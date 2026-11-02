import { Fragment } from 'react';
import type { TermoDoGlossario } from '../dados';
import Destacar from './Destacar';

// Lista de definicoes (dl): termo e definicao lado a lado (uma coluna so no estreito).
export default function Glossario({ termos }: { termos: readonly TermoDoGlossario[] }) {
  return (
    <dl className="manual-glossario">
      {termos.map((t) => (
        <Fragment key={t.termo}>
          <dt className="manual-glossario__termo">
            <Destacar>{t.termo}</Destacar>
          </dt>
          <dd className="manual-glossario__def">
            <Destacar>{t.definicao}</Destacar>
          </dd>
        </Fragment>
      ))}
    </dl>
  );
}
