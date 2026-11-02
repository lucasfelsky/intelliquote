import Destacar from './Destacar';
import { MARCAS_DA_REGUA } from '../dados';

// Regua dos avisos de vencimento de documento: D-30, D-15, D-7, D0 e vencido. As posicoes vem de uma classe por marca (nada de estilo inline).
export default function Regua() {
  const descricao = `Régua de avisos: ${MARCAS_DA_REGUA.map((m) => `${m.rotulo} (${m.dia})`).join(', ')}.`;
  return (
    <div className="manual-regua" role="img" aria-label={descricao}>
      <div className="manual-regua__trilho" />
      {MARCAS_DA_REGUA.map((marca) => (
        <div key={marca.id} className={marca.classe}>
          <Destacar>
            <b className="manual-regua__dia">{marca.dia}</b>
            <i className="manual-regua__ponto" />
            <span className="manual-regua__rotulo">{marca.rotulo}</span>
          </Destacar>
        </div>
      ))}
    </div>
  );
}
