import { useEffect, useId, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/api/client';
import { Icon } from '@/components/icons';
import {
  downloadIndentPortalAttachment,
  getIndentPortalState,
  resendIndentQuoteLink,
  type IndentPortalAttachmentRef,
  type IndentPortalMail,
  type IndentPortalState,
} from '@/services/indentEnvio';
import type { IndentQuoteDetail } from '@/services/indentQuotes';
import { formatarDataHora, mensagemDoErro } from './indentFila';
import { formatarDataBr, formatarTamanho, linkVencido, resumoEnvio } from './indentPortal';

// IQ Indent: secao "Portal do fornecedor" da gaveta da cotacao (mock v13 portalSec): estado do link, acesso, validade, resposta, anexos do fornecedor,
// falhas de envio e "Reenviar link". Vive DENTRO do <form> da gaveta: todo botao e type="button". O estado e o `canResend` sao do BACKEND.
// Divergencias do mock (declaradas no plano): "Link vencido", "Enviada sem e-mail", falhas, anexos do fornecedor e confirmacao INLINE do reenvio
// (sem dialog aninhado e sem provider: os testes que montam a gaveta nao tem ConfirmProvider).

interface Props {
  quote: IndentQuoteDetail;
  mostrar: (tipo: 'salvo' | 'removido', titulo: string, texto: string) => void;
}

interface Aviso {
  texto: string;
  falhas: Array<{ email: string; motivo: string }>;
}

const MAX_FALHAS = 5;

function motivoDaFalha(mail: IndentPortalMail): string {
  return mail.status === 'suppressed' ? 'endereço interno bloqueado (não enviado)' : (mail.errorMessage ?? 'falha no envio');
}

export default function IndentPortalSecao({ quote, mostrar }: Props) {
  const qc = useQueryClient();
  const tituloId = useId();
  const reenviarRef = useRef<HTMLButtonElement>(null);
  const confirmarRef = useRef<HTMLButtonElement>(null);
  const ocupadoRef = useRef(false);
  const voltarFocoRef = useRef(false);
  const [confirmando, setConfirmando] = useState(false);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [erroDownload, setErroDownload] = useState<string | null>(null);
  const [baixando, setBaixando] = useState<number | null>(null);

  const portal = useQuery({
    queryKey: ['indent', 'quotes', quote.id, 'portal'],
    queryFn: () => getIndentPortalState(quote.id),
    retry: false,
  });

  // Ao abrir a confirmacao o foco vai para "Reenviar"; ao cancelar, concluir ou falhar volta para "Reenviar link" (o botao que abriu).
  useEffect(() => {
    if (confirmando) {
      confirmarRef.current?.focus();
    } else if (voltarFocoRef.current) {
      voltarFocoRef.current = false;
      reenviarRef.current?.focus();
    }
  }, [confirmando]);

  const reenvio = useMutation({
    mutationFn: () => resendIndentQuoteLink(quote.id),
    onSuccess: (resposta) => {
      const { entregues, falhas } = resumoEnvio(resposta.results);
      void qc.invalidateQueries({ queryKey: ['indent', 'quotes'] });
      void qc.invalidateQueries({ queryKey: ['indent', 'requests'] });
      voltarFocoRef.current = true;
      setConfirmando(false);
      mostrar('salvo', `Link reenviado para ${entregues.join(', ')}`, falhas.length > 0 ? `Não entregue para: ${falhas.map((falha) => falha.email).join(', ')}.` : '');
    },
    onError: (erro) => {
      // 409 (aceite/status), 422 (sigilo), 502 (nenhum e-mail saiu) e rede: a mensagem do backend fica DENTRO da secao e as consultas sao refeitas.
      const corpo = erro instanceof ApiError ? (erro.body as { results?: unknown } | null) : null;
      const resultados = Array.isArray(corpo?.results) ? (corpo.results as Parameters<typeof resumoEnvio>[0]) : [];
      setAviso({ texto: mensagemDoErro(erro), falhas: resumoEnvio(resultados).falhas });
      void qc.invalidateQueries({ queryKey: ['indent', 'quotes'] });
      void qc.invalidateQueries({ queryKey: ['indent', 'requests'] });
      voltarFocoRef.current = true;
      setConfirmando(false);
    },
    onSettled: () => {
      ocupadoRef.current = false;
    },
  });

  if (portal.isError && portal.error instanceof ApiError && portal.error.status === 403) return null;

  const estado: IndentPortalState | null = portal.data ?? null;

  function abrirConfirmacao() {
    setAviso(null);
    setConfirmando(true);
  }

  function cancelarConfirmacao() {
    if (ocupadoRef.current) return;
    voltarFocoRef.current = true;
    setConfirmando(false);
  }

  function confirmarReenvio() {
    // aria-disabled (e nao disabled): o foco fica no botao. A guarda e um ref porque o isPending so chega no render seguinte (duplo clique).
    if (ocupadoRef.current) return;
    ocupadoRef.current = true;
    setAviso(null);
    reenvio.mutate();
  }

  async function baixar(arquivo: IndentPortalAttachmentRef) {
    if (baixando !== null) return;
    setErroDownload(null);
    setBaixando(arquivo.id);
    try {
      await downloadIndentPortalAttachment(quote.id, arquivo);
    } catch (erro) {
      setErroDownload(`Não foi possível baixar o anexo: ${mensagemDoErro(erro)}`);
    } finally {
      setBaixando(null);
    }
  }

  let tag = null;
  let corpo;

  if (!estado) {
    corpo = <span className="indent-cell-sub">{portal.isLoading ? 'Carregando o estado do portal…' : 'Estado do portal indisponível.'}</span>;
  } else {
    const vencido = linkVencido(estado, new Date());
    const falhasRecentes = estado.mails.filter((mail) => mail.status === 'failed' || mail.status === 'suppressed').slice(0, MAX_FALHAS);
    const semLink = estado.lastSentAt === null && estado.recipients.length === 0 && estado.expiresAt === null && estado.lastAccessAt === null;
    const bloqueioPorAceite =
      estado.state === 'AGUARDANDO' && !estado.canResend && quote.acceptedQuote !== null && quote.status === 'ENVIADA';

    if (estado.state === 'NAO_ENVIADO') tag = <span className="indent-tag">Não enviado</span>;
    else if (estado.state === 'MARCADA_SEM_EMAIL') tag = <span className="indent-tag">Enviada sem e-mail</span>;
    else if (estado.state === 'RESPONDIDO') tag = <span className="indent-tag indent-tag--ok">Resposta recebida</span>;
    else tag = vencido ? <span className="indent-tag indent-tag--lock">Link vencido</span> : <span className="indent-tag indent-tag--manual">Aguardando resposta</span>;

    corpo = (
      <>
        {estado.state === 'NAO_ENVIADO' && <span className="indent-cell-sub">O link do portal é gerado no envio.</span>}
        {estado.state === 'MARCADA_SEM_EMAIL' && <span className="indent-cell-sub">Marcada como enviada sem e-mail: não há link do portal.</span>}

        {(estado.state === 'AGUARDANDO' || estado.state === 'RESPONDIDO') && (
          <dl className="indent-dl">
            {!(estado.state === 'RESPONDIDO' && semLink) && (
              <>
                <dt>Link enviado</dt>
                <dd>{estado.recipients.length > 0 ? `${formatarDataHora(estado.lastSentAt)} para ${estado.recipients.join(', ')}` : formatarDataHora(estado.lastSentAt)}</dd>
                <dt>Acesso</dt>
                <dd>{estado.lastAccessAt ? `Acessado em ${formatarDataHora(estado.lastAccessAt)}` : 'Ainda não acessado'}</dd>
                <dt>Validade</dt>
                <dd>{`${formatarDataBr(estado.expiresAt)}${vencido ? ' (vencido)' : ''}`}</dd>
              </>
            )}
            {estado.response && (
              <>
                <dt>Resposta</dt>
                <dd>
                  {estado.response.via === 'portal'
                    ? `${estado.response.version !== null ? `Versão ${estado.response.version} recebida` : 'Recebida'} em ${formatarDataHora(estado.response.submittedAt)}`
                    : `Registrada manualmente em ${formatarDataHora(estado.response.submittedAt)}`}
                </dd>
              </>
            )}
            {estado.attachments.length > 0 && (
              <>
                <dt>Anexos do fornecedor</dt>
                <dd>
                  <ul className="indent-portal__lista">
                    {estado.attachments.map((arquivo) => (
                      <li key={arquivo.id}>
                        <button
                          type="button"
                          className="indent-linkbtn"
                          aria-disabled={baixando !== null ? true : undefined}
                          onClick={() => void baixar(arquivo)}
                        >
                          <Icon name="download" size={14} />
                          {` ${arquivo.fileName} (${formatarTamanho(arquivo.fileSize)})`}
                        </button>
                      </li>
                    ))}
                  </ul>
                </dd>
              </>
            )}
          </dl>
        )}

        {erroDownload && (
          <p className="field-error" role="alert">
            {erroDownload}
          </p>
        )}

        {falhasRecentes.length > 0 && (
          <>
            <span className="indent-cell-sub">Falhas de envio</span>
            <ul className="indent-portal__lista" aria-label="Falhas de envio">
              {falhasRecentes.map((mail) => (
                <li key={mail.id}>{`${formatarDataHora(mail.createdAt)} · ${mail.toEmail} · ${motivoDaFalha(mail)}`}</li>
              ))}
            </ul>
          </>
        )}

        {aviso && (
          <div role="alert" className="alert alert--warning">
            {aviso.texto}
            {aviso.falhas.length > 0 && (
              <ul className="indent-portal__lista">
                {aviso.falhas.map((falha) => (
                  <li key={falha.email}>
                    {falha.email}: {falha.motivo}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {estado.canResend && !confirmando && (
          <div>
            <button ref={reenviarRef} type="button" className="ghost-button" onClick={abrirConfirmacao}>
              <Icon name="send" size={15} />
              Reenviar link
            </button>
          </div>
        )}

        {estado.canResend && confirmando && (
          <div className="indent-portal__confirma" role="group" aria-label="Confirmar reenvio">
            <span>
              Reenviar o link para {estado.recipients.length > 0 ? estado.recipients.join(', ') : 'os destinatários anteriores'}? Os links anteriores deixam de valer para quem
              receber o novo.
            </span>
            <div className="indent-portal__acoes">
              <button type="button" className="ghost-button" aria-disabled={reenvio.isPending ? true : undefined} onClick={cancelarConfirmacao}>
                Cancelar
              </button>
              <button
                ref={confirmarRef}
                type="button"
                className="primary-button"
                aria-busy={reenvio.isPending}
                aria-disabled={reenvio.isPending ? true : undefined}
                onClick={confirmarReenvio}
              >
                Reenviar
              </button>
            </div>
          </div>
        )}

        {bloqueioPorAceite && (
          <span className="indent-cell-sub">Reenvio bloqueado: a solicitação já tem uma cotação aceita. O link já enviado continua valendo.</span>
        )}
      </>
    );
  }

  return (
    <section className="indent-portal" aria-labelledby={tituloId} tabIndex={-1}>
      <div className="indent-painel__cabeca">
        <h2 id={tituloId}>Portal do fornecedor</h2>
        {tag}
      </div>
      {corpo}
    </section>
  );
}
