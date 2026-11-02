import { useEffect, useState } from 'react';
import { Icon } from '@/components/icons';
import { normalizar } from '../busca';
import type { PerguntaFrequente } from '../dados';
import Destacar, { useTermo } from './Destacar';

// Uma pergunta: <details> controlado. Sem busca vale a escolha do leitor; com busca, a pergunta que contem o termo abre sozinha e,
// quando o termo some, tudo volta ao estado de antes (a escolha feita DURANTE a busca vale so ate o termo mudar).
function Pergunta({ pergunta, resposta }: PerguntaFrequente) {
  const termo = useTermo();
  const [aberto, setAberto] = useState(false);
  const [durante, setDurante] = useState<boolean | null>(null);
  useEffect(() => {
    setDurante(null);
  }, [termo]);
  const casa = termo !== '' && normalizar(`${pergunta} ${resposta}`).includes(termo);
  const open = termo ? (durante ?? (casa || aberto)) : aberto;

  return (
    <details className="manual-faq" open={open}>
      <summary
        className="manual-faq__resumo"
        onClick={(evento) => {
          // O estado e do React: o clique so inverte o que esta na tela (nada de abrir/fechar por conta do navegador).
          evento.preventDefault();
          if (termo) setDurante(!open);
          else setAberto(!open);
        }}
      >
        <span>
          <Destacar>{pergunta}</Destacar>
        </span>
        <span className="manual-faq__icone" aria-hidden="true">
          <Icon name="plus" size={16} strokeWidth={2.2} className="manual-faq__mais" />
          <Icon name="minus" size={16} strokeWidth={2.2} className="manual-faq__menos" />
        </span>
      </summary>
      <p className="manual-faq__resposta">
        <Destacar>{resposta}</Destacar>
      </p>
    </details>
  );
}

export default function Faq({ perguntas }: { perguntas: readonly PerguntaFrequente[] }) {
  return (
    <div className="manual-faq-lista">
      {perguntas.map((p) => (
        <Pergunta key={p.pergunta} {...p} />
      ))}
    </div>
  );
}
