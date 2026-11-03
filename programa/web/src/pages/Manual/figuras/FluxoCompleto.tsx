import { useId } from 'react';

// Swimlane do ciclo completo (capitulo 1): COMERCIAL, COMEX e FORNECEDOR. Caixas tracejadas = opcionais; a caixa de acao (Vencedora + Ordem de Compra) e a chave.
// Cores e fontes vem das classes manual-sv-* (so tokens); o titulo e os marcadores usam ids de useId (a pagina pode ter mais de um SVG).
export default function FluxoCompleto() {
  const base = useId().replace(/:/g, '');
  const idTitulo = `${base}-titulo`;
  const idSeta = `${base}-seta`;
  const idSetaDestaque = `${base}-seta-destaque`;
  return (
    <svg className="manual-svg manual-svg--fluxo" viewBox="0 0 960 300" width="100%" role="img" aria-labelledby={idTitulo}>
      <title id={idTitulo}>
        Fluxo completo: solicitação do Comercial, cotação, envio, resposta do fornecedor no portal, comparação, vencedora e PO, conclusão e retorno ao Comercial
      </title>
      <defs>
        <marker id={idSeta} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" className="manual-sv-ponta" />
        </marker>
        <marker id={idSetaDestaque} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" className="manual-sv-ponta manual-sv-ponta--destaque" />
        </marker>
      </defs>
      <rect x="0" y="0" width="960" height="92" className="manual-sv-faixa" />
      <rect x="0" y="92" width="960" height="104" className="manual-sv-faixa manual-sv-faixa--alt" />
      <rect x="0" y="196" width="960" height="104" className="manual-sv-faixa" />
      <text x="14" y="22" className="manual-sv-raia">
        COMERCIAL
      </text>
      <text x="14" y="114" className="manual-sv-raia">
        COMEX
      </text>
      <text x="14" y="218" className="manual-sv-raia">
        FORNECEDOR
      </text>

      <path d="M170 68 V144 H234" className="manual-sv-seta" markerEnd={`url(#${idSeta})`} />
      <path d="M342 144 H354" className="manual-sv-seta" markerEnd={`url(#${idSeta})`} />
      <path d="M410 166 V248 H474" className="manual-sv-seta" markerEnd={`url(#${idSeta})`} />
      <path d="M440 236 C 470 200, 500 200, 520 224" className="manual-sv-seta manual-sv-seta--tracejada" markerEnd={`url(#${idSetaDestaque})`} />
      <text x="446" y="206" className="manual-sv-nota">
        lembretes seg–sex
      </text>
      <path d="M582 248 H650 V170" className="manual-sv-seta" markerEnd={`url(#${idSeta})`} />
      <path d="M702 144 H714" className="manual-sv-seta" markerEnd={`url(#${idSeta})`} />
      <path d="M770 166 V222" className="manual-sv-seta" markerEnd={`url(#${idSeta})`} />
      <path d="M822 144 H834" className="manual-sv-seta" markerEnd={`url(#${idSeta})`} />
      <path d="M890 122 V72" className="manual-sv-seta" markerEnd={`url(#${idSeta})`} />

      <rect x="118" y="24" width="104" height="44" rx="10" className="manual-sv-no manual-sv-no--opcional" />
      <text x="170" y="42" textAnchor="middle" className="manual-sv-t">
        Solicitação
      </text>
      <text x="170" y="57" textAnchor="middle" className="manual-sv-t manual-sv-t--leve">
        do cliente
      </text>

      <rect x="238" y="122" width="104" height="44" rx="10" className="manual-sv-no" />
      <text x="290" y="140" textAnchor="middle" className="manual-sv-t">
        Cria a
      </text>
      <text x="290" y="155" textAnchor="middle" className="manual-sv-t manual-sv-t--leve">
        cotação
      </text>

      <rect x="358" y="122" width="104" height="44" rx="10" className="manual-sv-no" />
      <text x="410" y="140" textAnchor="middle" className="manual-sv-t">
        Envia aos
      </text>
      <text x="410" y="155" textAnchor="middle" className="manual-sv-t manual-sv-t--leve">
        fornecedores
      </text>

      <rect x="478" y="226" width="104" height="44" rx="10" className="manual-sv-no" />
      <text x="530" y="244" textAnchor="middle" className="manual-sv-t">
        Responde
      </text>
      <text x="530" y="259" textAnchor="middle" className="manual-sv-t manual-sv-t--leve">
        no portal
      </text>

      <rect x="598" y="122" width="104" height="44" rx="10" className="manual-sv-no" />
      <text x="650" y="140" textAnchor="middle" className="manual-sv-t">
        Compara
      </text>
      <text x="650" y="155" textAnchor="middle" className="manual-sv-t manual-sv-t--leve">
        propostas
      </text>

      <rect x="718" y="122" width="104" height="44" rx="10" className="manual-sv-no manual-sv-no--chave" />
      <text x="770" y="140" textAnchor="middle" className="manual-sv-t manual-sv-t--sobre">
        Vencedora
      </text>
      <text x="770" y="155" textAnchor="middle" className="manual-sv-t manual-sv-t--sobre manual-sv-t--leve">
        + Ordem de Compra
      </text>

      <rect x="718" y="226" width="104" height="44" rx="10" className="manual-sv-no" />
      <text x="770" y="244" textAnchor="middle" className="manual-sv-t">
        Recebe
      </text>
      <text x="770" y="259" textAnchor="middle" className="manual-sv-t manual-sv-t--leve">
        a PO
      </text>

      <rect x="838" y="122" width="104" height="44" rx="10" className="manual-sv-no" />
      <text x="890" y="140" textAnchor="middle" className="manual-sv-t">
        Conclui
      </text>
      <text x="890" y="155" textAnchor="middle" className="manual-sv-t manual-sv-t--leve">
        e avalia
      </text>

      <rect x="838" y="24" width="104" height="44" rx="10" className="manual-sv-no manual-sv-no--opcional" />
      <text x="890" y="42" textAnchor="middle" className="manual-sv-t">
        Vê o preço
      </text>
      <text x="890" y="57" textAnchor="middle" className="manual-sv-t manual-sv-t--leve">
        final
      </text>
    </svg>
  );
}
