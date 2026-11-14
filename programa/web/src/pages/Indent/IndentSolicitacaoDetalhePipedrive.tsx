import { FormEvent, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Icon } from '@/components/icons';
import { setIndentRequestReference, type IndentRequestDetail } from '@/services/indentRequests';
import type { IndentPendingOrgCandidate } from '@/services/indentPipedrive';
import { formatCnpj } from './cnpj';
import { formatarDataHora, mensagemDoErro } from './indentFila';

// IQ Indent: partes do detalhe da solicitacao que vem do Pipedrive (mock v14 + decisoes do PR 5): aviso de cliente pendente com a organizacao,
// painel Cliente da pendencia, "Referencia pendente" (digitar NNN/AA), alertas da sincronizacao e detalhes da nota. O texto da nota e SEMPRE texto
// React (nunca HTML) e o IQ nunca escreve no Pipedrive.

type Pendencia = NonNullable<IndentRequestDetail['pendingOrg']>;

export function nomeDaOrganizacao(candidato: IndentPendingOrgCandidate): string {
  return candidato.name.trim() === '' ? `Organização #${candidato.orgId}` : candidato.name;
}

/** Nome mostrado no lugar do cliente enquanto ele esta pendente: o da organizacao (uma so) ou "Cliente pendente" (varias / nenhuma). */
export function nomeDoClientePendente(pendencia: Pendencia | null): string {
  const unica = pendencia?.candidates.length === 1 ? pendencia.candidates[0] : undefined;
  return unica ? nomeDaOrganizacao(unica) : 'Cliente pendente';
}

// ------------------------------------------------------------------------------------------------------------------
// Cliente pendente (D13 e D22)
// ------------------------------------------------------------------------------------------------------------------

/** Texto do aviso: "A organização <b>NOME</b> (Org #N) não tem cliente cadastrado. Vincule antes ..." (varias: lista; nenhuma: texto generico). */
export function AvisoClientePendente({ pendencia, onAbrirFila }: { pendencia: Pendencia | null; onAbrirFila: () => void }) {
  const candidatos = pendencia?.candidates ?? [];
  const fim = 'Vincule antes de escolher fornecedores, para a restrição do cliente valer.';

  let texto;
  if (candidatos.length === 1 && candidatos[0]) {
    texto = (
      <>
        A organização <b>{nomeDaOrganizacao(candidatos[0])}</b> (Org #{candidatos[0].orgId}) não tem cliente cadastrado. {fim}
      </>
    );
  } else if (candidatos.length > 1) {
    texto = (
      <>
        O negócio tem {candidatos.length} organizações sem cliente cadastrado:{' '}
        {candidatos.map((candidato, indice) => (
          <span key={candidato.orgId}>
            {indice > 0 ? ', ' : ''}
            <b>{nomeDaOrganizacao(candidato)}</b> (Org #{candidato.orgId})
          </span>
        ))}
        . {fim}
      </>
    );
  } else {
    texto = <>A organização do negócio não tem cliente cadastrado. {fim}</>;
  }

  return (
    <>
      <div className="alert alert--warning indent-alerta">
        <Icon name="lock" size={18} />
        <span className="indent-alerta__texto">{texto}</span>
      </div>
      <div>
        <button type="button" className="primary-button" onClick={onAbrirFila}>
          Abrir fila de vínculo
        </button>
      </div>
    </>
  );
}

/** Painel "Cliente" enquanto nao ha cliente: CNPJ (ou "—"), cidade e "Org #N" vindos da pendencia + tag "Cliente pendente". */
export function PainelClientePendente({ pendencia, dealType }: { pendencia: Pendencia; dealType: string | null }) {
  const candidatos = pendencia.candidates;
  if (candidatos.length === 0) return null;

  return (
    <section className="indent-painel">
      <div className="indent-painel__cabeca">
        <h2>Cliente</h2>
        <span className="indent-tag indent-tag--manual">Cliente pendente</span>
      </div>
      {candidatos.map((candidato, indice) => (
        <dl key={candidato.orgId} className="indent-dl">
          {candidatos.length > 1 && (
            <>
              <dt>Organização</dt>
              <dd>{nomeDaOrganizacao(candidato)}</dd>
            </>
          )}
          <dt>CNPJ</dt>
          <dd className={candidato.cnpj ? 'indent-dl__mono' : undefined}>{candidato.cnpj ? formatCnpj(candidato.cnpj) : '—'}</dd>
          <dt>Cidade</dt>
          <dd>{candidato.city ?? '—'}</dd>
          <dt>Pipedrive</dt>
          <dd>Org #{candidato.orgId}</dd>
          {dealType && indice === candidatos.length - 1 && (
            <>
              <dt>Tipo de negócio</dt>
              <dd>{dealType}</dd>
            </>
          )}
        </dl>
      ))}
    </section>
  );
}

// ------------------------------------------------------------------------------------------------------------------
// Referencia pendente
// ------------------------------------------------------------------------------------------------------------------

const MENSAGEM_FORMATO = 'Informe a referência no formato NNN/AA (ex.: 274/26).';
const MENSAGEM_ANO = 'O ano da referência deve ser o atual, o anterior ou o próximo.';
// Acima disto a sequencia e incomum (a empresa emite algumas centenas por ano) e sobe a sequencia do ano sem volta: pede confirmacao.
const SEQUENCIA_INCOMUM = 1000;

function anoAtualEmSaoPaulo(agora: Date): number {
  return Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric' }).format(agora));
}

export type ResultadoReferencia = { ok: true; numero: string; sequencia: number } | { ok: false; erro: string };

/**
 * Confere a referencia digitada ANTES de enviar (o backend repete a conferencia): `NNN/AA` com 1 a 4 digitos na sequencia e 2 no ano; o ano
 * (2000 + AA) fica entre o anterior e o proximo ao atual em Sao Paulo, como no titulo do negocio. A sequencia vira 3 digitos (`74/26` -> `074/26`).
 * Pega o erro de digitar o ano no lugar do numero (`2026/26`): a sequencia incomum vira pedido de confirmacao no formulario.
 */
export function validarReferencia(texto: string, agora: Date = new Date()): ResultadoReferencia {
  const achado = /^(\d{1,4})\s*\/\s*(\d{2})$/.exec(texto.trim());
  if (!achado) return { ok: false, erro: MENSAGEM_FORMATO };

  const sequencia = Number(achado[1]);
  if (sequencia < 1) return { ok: false, erro: MENSAGEM_FORMATO };

  const ano = 2000 + Number(achado[2]);
  const atual = anoAtualEmSaoPaulo(agora);
  if (ano < atual - 1 || ano > atual + 1) return { ok: false, erro: MENSAGEM_ANO };

  return { ok: true, numero: `${String(sequencia).padStart(3, '0')}/${achado[2]}`, sequencia };
}

interface ReferenciaPendenteProps {
  solicitacao: IndentRequestDetail;
  canWrite: boolean;
  /** Chamado depois de salvar (a tela mostra o toast e devolve o foco: o formulario sai do DOM). */
  onSalva: (numero: string) => void;
}

/** Alerta "Título do negócio sem número NNN/AA..." + campo "Referência (NNN/AA)" + "Salvar referência" (so quem escreve). Barra a geracao de cotacoes. */
export function ReferenciaPendente({ solicitacao, canWrite, onSalva }: ReferenciaPendenteProps) {
  const qc = useQueryClient();
  const [valor, setValor] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  // Sequencia incomum: o 1o "Salvar referencia" so mostra o aviso; repetir com o MESMO numero confirma.
  const [aviso, setAviso] = useState<string | null>(null);
  const [confirmado, setConfirmado] = useState<string | null>(null);

  const salvar = useMutation({
    mutationFn: (numero: string) => setIndentRequestReference(solicitacao.id, numero),
    onSuccess: (_detalhe, numero) => {
      void qc.invalidateQueries({ queryKey: ['indent', 'requests'] });
      onSalva(numero);
    },
    onError: (err) => {
      setErro(mensagemDoErro(err));
      // Ex.: 409 "A solicitação já tem referência." (outra pessoa digitou antes): o detalhe e relido.
      void qc.invalidateQueries({ queryKey: ['indent', 'requests'] });
    },
  });

  function aoDigitar(texto: string) {
    setValor(texto);
    setErro(null);
    setAviso(null);
    setConfirmado(null);
  }

  function enviar(event: FormEvent) {
    event.preventDefault();
    if (salvar.isPending) return;
    setErro(null);

    const resultado = validarReferencia(valor);
    if (!resultado.ok) {
      setAviso(null);
      setErro(resultado.erro);
      return;
    }
    if (resultado.sequencia >= SEQUENCIA_INCOMUM && confirmado !== resultado.numero) {
      setConfirmado(resultado.numero);
      setAviso(
        `A sequência ${resultado.sequencia.toLocaleString('pt-BR')} é muito maior que o normal (as solicitações do ano ficam abaixo de 1.000)` +
          `${resultado.sequencia >= 1900 && resultado.sequencia <= 2100 ? ' e parece o ano no lugar do número' : ''}. ` +
          `Se ${resultado.numero} estiver certo, clique em “Salvar referência” de novo para confirmar.`,
      );
      return;
    }
    setAviso(null);
    salvar.mutate(resultado.numero);
  }

  return (
    <div className="indent-pilha">
      <div className="alert alert--warning indent-alerta">
        <Icon name="lock" size={18} />
        <span className="indent-alerta__texto">Título do negócio sem número NNN/AA. Digite a referência para seguir.</span>
      </div>
      <p className="indent-cell-sub indent-painel__nota">Enquanto a referência estiver pendente, as cotações desta solicitação não podem ser geradas.</p>
      {canWrite ? (
        <form className="indent-referencia" noValidate onSubmit={enviar}>
          <div className="field">
            <label className="field-label" htmlFor="ref-pendente">
              Referência (NNN/AA)
            </label>
            <input
              id="ref-pendente"
              className="input indent-input-mono"
              inputMode="text"
              autoComplete="off"
              placeholder="274/26"
              value={valor}
              aria-invalid={erro ? true : undefined}
              aria-describedby={erro ? 'ref-pendente-erro' : aviso ? 'ref-pendente-aviso' : undefined}
              onChange={(event) => aoDigitar(event.target.value)}
            />
          </div>
          <button type="submit" className="primary-button" aria-disabled={salvar.isPending ? true : undefined}>
            Salvar referência
          </button>
        </form>
      ) : (
        <p className="indent-cell-sub indent-painel__nota">Só quem edita as solicitações pode digitar a referência.</p>
      )}
      {erro && (
        <p id="ref-pendente-erro" className="field-error" role="alert">
          {erro}
        </p>
      )}
      {aviso && (
        <div id="ref-pendente-aviso" className="alert alert--warning" role="alert">
          {aviso}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------------------------
// Alertas da sincronizacao e detalhes da nota
// ------------------------------------------------------------------------------------------------------------------

/** `dd/MM` no fuso de Sao Paulo (recorte de `formatarDataHora`, que e `dd/mm hh:mm`). */
function diaMes(valor: string): string {
  return formatarDataHora(valor).slice(0, 5);
}

/** Alertas que a sincronizacao deixa na solicitacao: numero do titulo divergente/duplicado, revisao `R<n>` recebida e nota alterada. */
export function AlertasDaSincronizacao({ solicitacao }: { solicitacao: IndentRequestDetail }) {
  return (
    <>
      {solicitacao.referenceAlert && (
        <div className="alert alert--warning indent-alerta">
          <Icon name="alert-triangle" size={18} />
          <span className="indent-alerta__texto">{solicitacao.referenceAlert}</span>
        </div>
      )}
      {solicitacao.currentRevision !== null && solicitacao.revisionAlertAt && (
        <div className="alert alert--info indent-alerta">
          <Icon name="info" size={18} />
          <span className="indent-alerta__texto">
            Revisão R{solicitacao.currentRevision} recebida do Pipedrive em {diaMes(solicitacao.revisionAlertAt)}.
          </span>
        </div>
      )}
      {solicitacao.noteChangedAt && (
        <div className="alert alert--warning indent-alerta">
          <Icon name="alert-triangle" size={18} />
          <span className="indent-alerta__texto">A nota do negócio mudou no Pipedrive depois da confirmação dos itens.</span>
        </div>
      )}
    </>
  );
}

/** "Fornecedor citado na nota: X" e "Incoterm CFR · destino Santos": so informativos (nada vem pre-marcado na escolha de fornecedores). */
export function DetalhesDaNota({ solicitacao }: { solicitacao: IndentRequestDetail }) {
  const logistica = [
    solicitacao.noteIncoterm ? `Incoterm ${solicitacao.noteIncoterm}` : null,
    solicitacao.noteDestination ? `destino ${solicitacao.noteDestination}` : null,
  ].filter((parte): parte is string => parte !== null);

  if (!solicitacao.noteSupplierHint && logistica.length === 0) return null;

  return (
    <div className="indent-cell-main">
      {solicitacao.noteSupplierHint && (
        <span className="indent-cell-sub">
          Fornecedor citado na nota: <b>{solicitacao.noteSupplierHint}</b>
        </span>
      )}
      {logistica.length > 0 && <span className="indent-cell-sub">{logistica.join(' · ')}</span>}
    </div>
  );
}
