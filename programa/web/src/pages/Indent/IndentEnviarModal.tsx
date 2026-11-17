import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent, type MutableRefObject } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/api/client';
import { Icon } from '@/components/icons';
import { Modal } from '@/components/Modal';
import {
  INDENT_MAX_RECIPIENTS,
  INDENT_MAX_SUPPLIER_EMAILS,
  INDENT_SEND_MAX_ATTACHMENTS,
  INDENT_SEND_MAX_BYTES,
  getIndentSendContext,
  sendIndentQuote,
  type IndentSendContext,
  type IndentSendInput,
  type IndentSendResponse,
} from '@/services/indentEnvio';
import type { IndentQuoteDetail } from '@/services/indentQuotes';
import { readFileAsBase64 } from '@/services/supplierDocuments';
import { mensagemDoErro } from './indentFila';
import { EMAIL_RE, formatarTamanho, mensagemSentinela, resumoEnvio } from './indentPortal';

// IQ Indent: janela "Enviar cotacao" (mock v13 openSend), aberta pela gaveta da cotacao em RASCUNHO. Mostra para quem vai, o remetente real, o
// que o fornecedor vai ver e valida no cliente com as MESMAS mensagens do backend (o backend revalida tudo: sigilo, sentinela, anexos).
// Divergencias do mock (declaradas no plano): porto de destino obrigatorio, anexos em PDF, "Responder para", aviso da revisao R2 e resultado por destinatario.

interface Props {
  quote: IndentQuoteDetail;
  onClose: () => void;
  /** 200: ao menos um e-mail saiu. `salvouNoCadastro` = o endereco digitado foi gravado no cadastro do fornecedor. */
  onEnviado: (resposta: IndentSendResponse, salvouNoCadastro: boolean) => void;
}

type Campo = 'para' | 'cliente' | 'porto' | 'anexos' | 'confirmacao' | 'mensagem';
type Erros = Partial<Record<Campo, string>>;

interface Aviso {
  tom: 'warning' | 'error';
  texto: string;
  falhas: Array<{ email: string; motivo: string }>;
}

// Primeiro segmento do `path` do 400 do backend -> campo da janela.
const CAMPO_DO_CAMINHO: Record<string, Campo> = {
  recipients: 'para',
  saveToSupplier: 'para',
  showClientName: 'cliente',
  destinationPort: 'porto',
  attachments: 'anexos',
  attachmentsConfirmed: 'confirmacao',
  message: 'mensagem',
};

const ehPdf = (arquivo: File) => /\.pdf$/i.test(arquivo.name) && (arquivo.type === '' || arquivo.type === 'application/pdf');

export default function IndentEnviarModal({ quote, onClose, onEnviado }: Props) {
  // Ocupado = envio em andamento: guarda do duplo clique e trava de fechar (o e-mail sairia sem a tela saber).
  const ocupadoRef = useRef(false);
  const contexto = useQuery({
    queryKey: ['indent', 'quotes', quote.id, 'send-context'],
    queryFn: () => getIndentSendContext(quote.id),
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });
  const ctx = contexto.data;
  const qc = useQueryClient();
  // 409 do send-context (aceite ou status mudou): a gaveta por tras precisa saber, senao continua oferecendo "Enviar". O predicate exclui o proprio
  // send-context (invalidar sem ele refaria a consulta que acabou de falhar).
  const erroContexto = !ctx ? contexto.error : null;
  useEffect(() => {
    if (erroContexto instanceof ApiError && erroContexto.status === 409) recarregarCotacoes(qc);
  }, [erroContexto, qc]);
  const fechar = () => {
    if (!ocupadoRef.current) onClose();
  };

  let corpo;
  if (!ctx && contexto.isError) {
    corpo = (
      <div className="indent-form">
        <div role="alert" className="alert alert--warning">
          {mensagemDoErro(contexto.error)}
        </div>
        <div className="modal-actions">
          <button type="button" className="ghost-button" onClick={onClose}>
            Fechar
          </button>
        </div>
      </div>
    );
  } else if (!ctx) {
    corpo = (
      <div className="indent-form">
        <div className="indent-vazio" role="status">
          Carregando dados do envio…
        </div>
      </div>
    );
  } else {
    corpo = <FormularioEnvio quote={quote} ctx={ctx} ocupadoRef={ocupadoRef} onClose={fechar} onEnviado={onEnviado} />;
  }

  return (
    <Modal isOpen restoreFocus className="indent-envio" eyebrow={`Enviar cotação ${ctx?.processRef ?? quote.ref}`} title={quote.supplier.name} onClose={fechar}>
      {corpo}
    </Modal>
  );
}

/** Refaz a cotacao e as solicitacoes, SEM o send-context. */
function recarregarCotacoes(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ['indent', 'quotes'], predicate: (consulta) => !consulta.queryKey.includes('send-context') });
  void qc.invalidateQueries({ queryKey: ['indent', 'requests'] });
}

function FormularioEnvio({
  quote,
  ctx,
  ocupadoRef,
  onClose,
  onEnviado,
}: {
  quote: IndentQuoteDetail;
  ctx: IndentSendContext;
  ocupadoRef: MutableRefObject<boolean>;
  onClose: () => void;
  onEnviado: (resposta: IndentSendResponse, salvouNoCadastro: boolean) => void;
}) {
  const qc = useQueryClient();
  const base = useId();
  const id = (parte: string) => `${base}-${parte}`;
  const formRef = useRef<HTMLFormElement>(null);
  const arquivoRef = useRef<HTMLInputElement>(null);

  const cadastrados = ctx.supplier.contactEmails;
  const parceiro = ctx.supplier.hasPartnership;
  const cadastroCheio = cadastrados.length >= INDENT_MAX_SUPPLIER_EMAILS;
  const revisao = ctx.kind === 'REVISION';

  const [marcados, setMarcados] = useState<Set<string>>(() => new Set(cadastrados.slice(0, INDENT_MAX_RECIPIENTS)));
  const [extra, setExtra] = useState('');
  const [salvarNoCadastro, setSalvarNoCadastro] = useState(false);
  const [mostrarCliente, setMostrarCliente] = useState(parceiro);
  const [porto, setPorto] = useState(ctx.destinationPort ?? '');
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [confirmou, setConfirmou] = useState(false);
  const [mensagem, setMensagem] = useState('');
  const [erros, setErros] = useState<Erros>({});
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [bloqueado, setBloqueado] = useState(false);
  const [focoErro, setFocoErro] = useState(0);
  const avisoRef = useRef<HTMLDivElement>(null);

  // Foco inicial: o formulario so existe depois do contexto (o Modal ja procurou o data-autofocus no "Carregando").
  useEffect(() => {
    formRef.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
  }, []);

  // Depois de um erro de campo, o foco vai para o 1o campo marcado (aria-invalid).
  useEffect(() => {
    if (focoErro === 0) return;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [focoErro]);

  // O alerta nasce no topo do formulario e o corpo da janela rola: leva o alerta para a vista e o foco para ele (o leitor de tela le o role=alert).
  useEffect(() => {
    if (!aviso) return;
    const alerta = avisoRef.current;
    alerta?.focus({ preventScroll: true });
    alerta?.scrollIntoView?.({ block: 'nearest' });
  }, [aviso]);

  const extraNormalizado = extra.trim().toLowerCase();
  const portoLimpo = porto.trim();

  const envio = useMutation({
    mutationFn: async (dados: { base: Omit<IndentSendInput, 'attachments' | 'attachmentsConfirmed'>; arquivos: File[] }) => {
      const anexos = await Promise.all(dados.arquivos.map(async (arquivo) => ({ fileName: arquivo.name, contentBase64: await readFileAsBase64(arquivo) })));
      const entrada: IndentSendInput = {
        ...dados.base,
        ...(anexos.length > 0 ? { attachments: anexos } : {}),
        // Confirmacao exigida (e ja validada na tela) so sem parceria e com anexo.
        ...(!parceiro && anexos.length > 0 ? { attachmentsConfirmed: true } : {}),
      };
      return sendIndentQuote(quote.id, entrada);
    },
    onSuccess: (resposta, dados) => onEnviado(resposta, dados.base.saveToSupplier),
    onError: (erro) => tratarErro(erro),
    onSettled: () => {
      ocupadoRef.current = false;
    },
  });
  const pendente = envio.isPending;

  function tratarErro(erro: unknown) {
    if (!(erro instanceof ApiError)) {
      setAviso({ tom: 'error', texto: mensagemDoErro(erro), falhas: [] });
      return;
    }
    const corpo = erro.body as { message?: unknown; path?: unknown; results?: unknown } | null;
    const texto = corpo && typeof corpo.message === 'string' ? corpo.message : erro.message;
    const caminho = corpo && typeof corpo.path === 'string' ? corpo.path : '';

    if (erro.status === 400 && caminho) {
      const campo = CAMPO_DO_CAMINHO[caminho.split('.')[0] ?? ''];
      if (campo) {
        setErros({ [campo]: texto });
        setFocoErro((n) => n + 1);
        return;
      }
    }
    if (erro.status === 413) {
      setErros({ anexos: texto });
      setFocoErro((n) => n + 1);
      return;
    }
    if (erro.status === 422) {
      setAviso({ tom: 'error', texto: mensagemSentinela(texto), falhas: [] });
      return;
    }
    if (erro.status === 409) {
      // Aceite ou mudanca de status na corrida: a consulta e refeita e a janela so deixa cancelar.
      setAviso({ tom: 'warning', texto, falhas: [] });
      setBloqueado(true);
      recarregarCotacoes(qc);
      return;
    }
    if (erro.status === 502) {
      // Nenhum e-mail saiu e a cotacao voltou a rascunho: a janela continua aberta com o motivo de cada destinatario.
      const resultados = Array.isArray(corpo?.results) ? (corpo.results as Parameters<typeof resumoEnvio>[0]) : [];
      setAviso({ tom: 'error', texto, falhas: resumoEnvio(resultados).falhas });
      recarregarCotacoes(qc);
      return;
    }
    setAviso({ tom: 'error', texto, falhas: [] });
  }

  function validar(): { base: Omit<IndentSendInput, 'attachments' | 'attachmentsConfirmed'>; arquivos: File[] } | null {
    const novos: Erros = {};

    const destinatarios = cadastrados.filter((email) => marcados.has(email));
    if (extraNormalizado !== '') {
      if (!EMAIL_RE.test(extraNormalizado) || /[,;]/.test(extraNormalizado)) novos.para = 'E-mail inválido.';
      else if (!destinatarios.includes(extraNormalizado)) destinatarios.push(extraNormalizado);
    }
    if (!novos.para) {
      if (destinatarios.length === 0) novos.para = 'Escolha ou digite ao menos um e-mail.';
      else if (destinatarios.length > INDENT_MAX_RECIPIENTS) novos.para = `Escolha no máximo ${INDENT_MAX_RECIPIENTS} destinatários.`;
    }

    if (portoLimpo === '') novos.porto = 'Informe o porto de destino.';

    if (arquivos.some((arquivo) => !ehPdf(arquivo))) novos.anexos = 'Envie só arquivos PDF.';
    else if (arquivos.length > INDENT_SEND_MAX_ATTACHMENTS) novos.anexos = `Envie no máximo ${INDENT_SEND_MAX_ATTACHMENTS} anexos.`;
    else if (arquivos.reduce((soma, arquivo) => soma + arquivo.size, 0) > INDENT_SEND_MAX_BYTES) novos.anexos = 'Os anexos passam de 10 MB.';

    if (!parceiro && arquivos.length > 0 && !confirmou) novos.confirmacao = 'Confirme que conferiu que o arquivo não cita o cliente.';

    setErros(novos);
    if (Object.keys(novos).length > 0) {
      setFocoErro((n) => n + 1);
      return null;
    }

    return {
      arquivos,
      base: {
        recipients: destinatarios,
        saveToSupplier: salvarNoCadastro && extraNormalizado !== '' && !cadastrados.includes(extraNormalizado),
        message: mensagem.trim() === '' ? null : mensagem.trim(),
        showClientName: parceiro && mostrarCliente,
        destinationPort: portoLimpo,
      },
    };
  }

  function aoEnviar(event: FormEvent) {
    event.preventDefault();
    // aria-disabled (e nao disabled): o foco fica no botao. A guarda e um ref porque o isPending so chega no render seguinte (duplo clique).
    if (ocupadoRef.current || bloqueado) return;
    setAviso(null);
    const dados = validar();
    if (!dados) return;
    ocupadoRef.current = true;
    envio.mutate(dados);
  }

  function aoEscolherArquivos(event: ChangeEvent<HTMLInputElement>) {
    const escolhidos = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (escolhidos.length === 0) return;
    const novos = escolhidos.filter((novo) => !arquivos.some((existente) => existente.name === novo.name && existente.size === novo.size));
    if (novos.length === 0) return;
    setErros((atual) => ({ ...atual, anexos: undefined, confirmacao: undefined }));
    // A conferencia vale para a lista que a Compras VIU: anexo novo exige conferir de novo (sigilo; o backend so recebe o booleano).
    setConfirmou(false);
    setArquivos([...arquivos, ...novos]);
  }

  function removerArquivo(indice: number) {
    setArquivos((atual) => atual.filter((_, posicao) => posicao !== indice));
    setErros((atual) => ({ ...atual, anexos: undefined, confirmacao: undefined }));
    setConfirmou(false);
    // O botao "Remover" some: o foco volta para o campo de anexos (nao se perde no body).
    arquivoRef.current?.focus();
  }

  function alternarEmail(email: string, marcado: boolean) {
    setMarcados((atual) => {
      if (marcado && atual.size >= INDENT_MAX_RECIPIENTS) return atual; // o envio aceita no maximo 5 destinatarios
      const proximo = new Set(atual);
      if (marcado) proximo.add(email);
      else proximo.delete(email);
      return proximo;
    });
  }

  // Enter num campo de texto NAO envia (mock: nao ha formulario): o envio e sempre um clique em "Enviar".
  const semEnterQueEnvia = (event: KeyboardEvent) => {
    if (event.key === 'Enter') event.preventDefault();
  };

  const ligacao = (campo: Campo, extraIds = '') => ({
    'aria-invalid': erros[campo] ? (true as const) : undefined,
    'aria-describedby': [extraIds, erros[campo] ? id(`${campo}-erro`) : ''].filter(Boolean).join(' ') || undefined,
  });
  const erroDe = (campo: Campo) =>
    erros[campo] ? (
      <p id={id(`${campo}-erro`)} className="field-error" role="alert">
        {erros[campo]}
      </p>
    ) : null;
  const semEmail = cadastrados.length === 0;
  const clienteVisivel = parceiro && mostrarCliente;
  // Sem parceria e com anexo, o envio so sai com a conferencia marcada (o clique ainda valida e mostra o motivo).
  const semConferencia = !parceiro && arquivos.length > 0 && !confirmou;

  return (
    <form ref={formRef} className="indent-form" noValidate aria-busy={pendente} onSubmit={aoEnviar}>
      {aviso && (
        <div ref={avisoRef} tabIndex={-1} role="alert" className={`alert alert--${aviso.tom}`}>
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

      {parceiro ? (
        <div className="alert alert--success indent-alerta">
          <Icon name="check" size={18} strokeWidth={2.4} />
          <span>
            <b>Parceria firmada.</b> O nome do cliente pode ser exibido ao fornecedor.
          </span>
        </div>
      ) : (
        <div className="alert alert--warning indent-alerta">
          <Icon name="lock" size={18} />
          <span>
            <b>Sem parceria firmada.</b> A SQ Química aparece, mas nada no e-mail, no portal, nos anexos e na mensagem pode dizer que ela é a compradora ou identificar o
            cliente final.
          </span>
        </div>
      )}

      {revisao && (
        <div className="alert alert--info">Revisão: o fornecedor verá a oferta anterior preenchida no portal. Os links da versão anterior deixam de valer.</div>
      )}

      <div className="field" role="group" aria-labelledby={id('para')}>
        <span className="field-label" id={id('para')}>
          Para
        </span>
        {cadastrados.length > INDENT_MAX_RECIPIENTS && (
          <span className="field-hint">
            O cadastro tem {cadastrados.length} e-mails: marque até {INDENT_MAX_RECIPIENTS} destinatários.
          </span>
        )}
        {semEmail ? (
          <div className="alert alert--warning">Este fornecedor não tem e-mail cadastrado. Digite um abaixo; você pode salvá-lo no cadastro.</div>
        ) : (
          cadastrados.map((email, indice) => (
            <div className="indent-check" key={email}>
              <label>
                <input
                  type="checkbox"
                  checked={marcados.has(email)}
                  disabled={!marcados.has(email) && marcados.size >= INDENT_MAX_RECIPIENTS}
                  onChange={(event) => alternarEmail(email, event.target.checked)}
                  {...(indice === 0 ? { 'data-autofocus': true } : {})}
                />
                <span>{email}</span>
              </label>
            </div>
          ))
        )}
        <input
          className="input"
          type="text"
          autoComplete="off"
          aria-label={semEmail ? 'E-mail do fornecedor' : 'Adicionar outro e-mail'}
          placeholder={semEmail ? 'E-mail do fornecedor' : 'Adicionar outro e-mail (opcional)'}
          value={extra}
          onChange={(event) => {
            setExtra(event.target.value);
            setErros((atual) => ({ ...atual, para: undefined }));
          }}
          onKeyDown={semEnterQueEnvia}
          {...(semEmail ? { 'data-autofocus': true } : {})}
          {...ligacao('para')}
        />
        <div className="indent-check">
          <label>
            <input type="checkbox" checked={salvarNoCadastro} disabled={cadastroCheio} onChange={(event) => setSalvarNoCadastro(event.target.checked)} />
            <span>Salvar no cadastro do fornecedor</span>
            {cadastroCheio && <span className="indent-cell-sub">O cadastro já tem {INDENT_MAX_SUPPLIER_EMAILS} e-mails.</span>}
          </label>
        </div>
        {erroDe('para')}
      </div>

      <dl className="indent-dl">
        <dt>Remetente</dt>
        <dd>{ctx.fromDisplay || '—'}</dd>
        <dt>Responder para</dt>
        <dd>{ctx.replyTo}</dd>
        <dt>Assunto</dt>
        <dd className="indent-dl__mono">{ctx.subject}</dd>
      </dl>

      <div className="indent-envio__cliente">
        <div className="indent-check">
          <label>
            <input
              type="checkbox"
              checked={parceiro && mostrarCliente}
              disabled={!parceiro}
              onChange={(event) => {
                setMostrarCliente(event.target.checked);
                setErros((atual) => ({ ...atual, cliente: undefined }));
              }}
              {...ligacao('cliente')}
            />
            <span>Mostrar o nome do cliente ao fornecedor</span>
            {!parceiro && (
              <span className="indent-tag indent-tag--lock">
                <Icon name="lock" size={11} strokeWidth={2.2} />
                Bloqueado
              </span>
            )}
          </label>
        </div>
        {erroDe('cliente')}
      </div>

      <div className="field">
        <label className="field-label" htmlFor={id('porto')}>
          Porto de destino (CFR)
        </label>
        <input
          id={id('porto')}
          className="input"
          maxLength={80}
          value={porto}
          onChange={(event) => {
            setPorto(event.target.value);
            setErros((atual) => ({ ...atual, porto: undefined }));
          }}
          onKeyDown={semEnterQueEnvia}
          {...ligacao('porto', id('porto-dica'))}
        />
        <span className="field-hint" id={id('porto-dica')}>
          Aparece no e-mail e no portal. Não use nada que identifique o cliente.
        </span>
        {erroDe('porto')}
      </div>

      <div className="field">
        <label className="field-label" htmlFor={id('anexos')}>
          Anexos (opcional)
        </label>
        <input
          id={id('anexos')}
          ref={arquivoRef}
          className="file-input"
          type="file"
          multiple
          accept=".pdf,application/pdf"
          onChange={aoEscolherArquivos}
          {...ligacao('anexos', id('anexos-dica'))}
        />
        <span className="field-hint" id={id('anexos-dica')}>
          Até {INDENT_SEND_MAX_ATTACHMENTS} PDFs, 10 MB no total. Os anexos não ficam guardados no IQ.
        </span>
        {arquivos.length > 0 && (
          <ul className="indent-envio__anexos">
            {arquivos.map((arquivo, indice) => (
              <li key={`${arquivo.name}:${arquivo.size}`}>
                <span>
                  {arquivo.name} · {formatarTamanho(arquivo.size)}
                </span>
                <button type="button" className="ghost-button ghost-button--sm" aria-label={`Remover anexo ${arquivo.name}`} onClick={() => removerArquivo(indice)}>
                  Remover
                </button>
              </li>
            ))}
          </ul>
        )}
        {erroDe('anexos')}
        {!parceiro && arquivos.length > 0 && (
          <>
            <div className="indent-check">
              <label>
                <input
                  type="checkbox"
                  checked={confirmou}
                  onChange={(event) => {
                    setConfirmou(event.target.checked);
                    setErros((atual) => ({ ...atual, confirmacao: undefined }));
                  }}
                  {...ligacao('confirmacao')}
                />
                <span>Conferi que os anexos não citam o cliente.</span>
              </label>
            </div>
            {erroDe('confirmacao')}
          </>
        )}
      </div>

      <div className="field">
        <label className="field-label" htmlFor={id('mensagem')}>
          Mensagem ao fornecedor (opcional)
        </label>
        <textarea
          id={id('mensagem')}
          className="input"
          rows={3}
          maxLength={2000}
          placeholder="Ex.: Podem melhorar o preço do STPP?"
          value={mensagem}
          onChange={(event) => {
            setMensagem(event.target.value);
            setErros((atual) => ({ ...atual, mensagem: undefined }));
          }}
          {...ligacao('mensagem')}
        />
        {erroDe('mensagem')}
      </div>

      <div className="indent-envio__visivel">
        <strong>O que o fornecedor vai ver</strong>
        <ul>
          <li>
            Nome do cliente: <b>{clienteVisivel ? `visível${ctx.clientName ? ` (${ctx.clientName})` : ''}` : 'oculto'}</b>
          </li>
          <li>
            Nome da SQ Química: <b>visível, como emissora do pedido{parceiro ? '' : ' (sem dizer que é a compradora)'}</b>
          </li>
          <li>
            Porto de destino: <b>{portoLimpo || '—'}</b>
          </li>
          <li>Anexos: confira se os nomes dos arquivos não citam o cliente</li>
          {revisao && (
            <li>
              Oferta anterior: <b>preenchida no portal</b>
            </li>
          )}
        </ul>
      </div>

      <div className="modal-actions">
        <button type="button" className="ghost-button" aria-disabled={pendente ? true : undefined} onClick={onClose}>
          Cancelar
        </button>
        <button type="submit" className="primary-button" aria-busy={pendente} aria-disabled={pendente || bloqueado || semConferencia ? true : undefined}>
          <Icon name="send" size={16} />
          Enviar
        </button>
      </div>
    </form>
  );
}
