import Destacar from './Destacar';
import { EMAIL_DE_EXEMPLO } from '../dados';

const CLASSE_DO_ENDERECO = {
  principal: 'manual-email__endereco manual-email__endereco--principal',
  primeiro: 'manual-email__endereco manual-email__endereco--primeiro',
  comum: 'manual-email__endereco',
} as const;

// Cabecalho do e-mail de envio: quem recebe o que (Para, Cc dos demais contatos, Cc da equipe so no 1o e-mail e o Assunto).
export default function EmailExemplo() {
  return (
    <dl className="manual-email">
      {EMAIL_DE_EXEMPLO.map((linha, i) => (
        <div key={`${linha.rotulo}-${i}`} className="manual-email__linha">
          <dt className="manual-email__k">{linha.rotulo}</dt>
          <dd className="manual-email__v">
            <Destacar>
              {linha.enderecos?.map((e) => (
                <span key={e.endereco} className={CLASSE_DO_ENDERECO[e.tipo]}>
                  {e.endereco}
                </span>
              ))}
              {linha.texto}
              {linha.nota ? <span className="manual-email__nota">{linha.nota}</span> : null}
            </Destacar>
          </dd>
        </div>
      ))}
    </dl>
  );
}
