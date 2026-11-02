import { SEMANA_DE_LEMBRETES } from '../dados';

// Semana dos lembretes automaticos: 04:00 (Brasilia) de segunda a sexta; sabado e domingo sem envio. A hora e o traco dizem o mesmo que o ponto.
export default function Semana() {
  return (
    <ul className="manual-semana" role="list">
      {SEMANA_DE_LEMBRETES.map((dia) => (
        <li key={dia.dia} className={dia.folga ? 'manual-dia manual-dia--folga' : 'manual-dia'}>
          <b className="manual-dia__nome">{dia.dia}</b>
          <i className="manual-dia__ponto" aria-hidden="true" />
          {dia.folga ? (
            <>
              <span className="manual-dia__hora" aria-hidden="true">
                {dia.hora}
              </span>
              <span className="sr-only">sem envio</span>
            </>
          ) : (
            <span className="manual-dia__hora">{dia.hora}</span>
          )}
        </li>
      ))}
    </ul>
  );
}
