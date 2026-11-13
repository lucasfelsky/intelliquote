import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/api/client';
import { Icon } from '@/components/icons';
import { Modal } from '@/components/Modal';
import { ForecastToast, useToastForecast } from '@/pages/Forecast/ForecastToast';
import {
  acceptIndentQuote,
  addIndentQuoteFreeItem,
  getIndentQuote,
  markIndentQuoteSent,
  recordIndentQuoteResponse,
  refuseIndentQuote,
  requestIndentQuoteRevision,
  type IndentQuoteDetail,
} from '@/services/indentQuotes';
import {
  QUOTE_STATUS,
  acceptedNotice,
  endSentence,
  estimateTotal,
  firstWords,
  formatDateKey,
  formatMoney,
  incotermLine,
  observationText,
  parsePriceInput,
  todayKeyBr,
} from './indentCotacao';
import IndentCotacaoItens, { type FreeItemState, type PriceValues } from './IndentCotacaoItens';
import { formatarDataHora, mensagemDoErro, parseQuantidadePtBr } from './indentFila';

// IQ Indent: gaveta da cotacao (mock openCot), um <Modal> posicionado a direita pela regiao F14 (classe indent-gaveta). A maquina de estados e as acoes
// permitidas sao do BACKEND (`allowedActions`): a tela so desenha o que vier la. Sem a secao "Portal do fornecedor" e sem a janela de envio (PR 4).

interface GavetaProps {
  /** `null` = id invalido na URL ("Cotacao nao encontrada."). */
  quoteId: number | null;
  /** Fechar; a mensagem (quando ha) vira o aviso mostrado por quem hospeda a gaveta. */
  onClose: (mensagem?: string) => void;
}

type Acao = {
  executar: () => Promise<IndentQuoteDetail>;
  mensagem: (dados: IndentQuoteDetail) => string;
  /** Aceite, recusa e revisao fecham a gaveta; marcar como enviada, registrar resposta e item livre a mantem aberta. */
  fecha: boolean;
};

interface RespostaForm {
  respondedOn: string;
  currency: string;
  validUntil: string;
  leadDays: string;
  paymentTerms: string;
  destination: string;
  manufacturer: string;
  notes: string;
}

const MOEDAS = ['USD', 'EUR'];

export default function IndentCotacaoGaveta({ quoteId, onClose }: GavetaProps) {
  const { toast, mostrar, fechar } = useToastForecast();

  const detalhe = useQuery({
    queryKey: ['indent', 'quotes', quoteId],
    queryFn: () => getIndentQuote(quoteId as number),
    enabled: quoteId !== null,
    retry: false,
  });

  const quote = detalhe.data;
  const naoEncontrada = quoteId === null || (detalhe.isError && detalhe.error instanceof ApiError && detalhe.error.status === 404);
  const fecharSimples = () => onClose();

  let corpo;
  if (naoEncontrada) {
    corpo = (
      <div className="indent-form indent-gaveta__form">
        <div className="indent-vazio">Cotação não encontrada.</div>
        <div className="modal-actions">
          <button type="button" className="ghost-button" onClick={fecharSimples}>
            Fechar
          </button>
        </div>
      </div>
    );
  } else if (detalhe.isError) {
    corpo = (
      <div className="indent-form indent-gaveta__form">
        <div role="alert" className="alert alert--warning">
          Não foi possível carregar a cotação: {mensagemDoErro(detalhe.error)}
        </div>
        <div className="modal-actions">
          <button type="button" className="ghost-button" onClick={fecharSimples}>
            Fechar
          </button>
        </div>
      </div>
    );
  } else if (!quote) {
    corpo = (
      <div className="indent-form indent-gaveta__form">
        <div className="indent-vazio" role="status">
          Carregando cotação…
        </div>
      </div>
    );
  } else {
    corpo = <GavetaFormulario key={`${quote.id}:${quote.status}:${quote.items.length}`} quote={quote} onClose={onClose} mostrar={mostrar} />;
  }

  const status = quote ? QUOTE_STATUS[quote.status] : null;

  return (
    <Modal
      isOpen
      restoreFocus
      onClose={fecharSimples}
      className="indent-gaveta"
      title={quote?.ref ?? 'Cotação'}
      subtitle={quote ? `${quote.supplier.name} · ${quote.client?.name ?? 'Cliente pendente'}` : undefined}
      headerAside={status ? <span className={status.classe}>{status.rotulo}</span> : undefined}
    >
      {corpo}
      {toast && <ForecastToast key={toast.id} dados={toast} onFechar={fechar} />}
    </Modal>
  );
}

function GavetaFormulario({
  quote,
  onClose,
  mostrar,
}: {
  quote: IndentQuoteDetail;
  onClose: (mensagem?: string) => void;
  mostrar: (tipo: 'salvo' | 'removido', titulo: string, texto: string) => void;
}) {
  const qc = useQueryClient();
  const base = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const hoje = todayKeyBr();
  const acoes = new Set(quote.allowedActions);
  const emResposta = acoes.has('response');

  const [sentOn, setSentOn] = useState(hoje);
  const [resposta, setResposta] = useState<RespostaForm>({
    respondedOn: hoje,
    currency: quote.currency,
    validUntil: '',
    leadDays: '',
    paymentTerms: '',
    destination: quote.destination ?? '',
    manufacturer: '',
    notes: '',
  });
  const [valores, setValores] = useState<Record<number, PriceValues>>(() =>
    Object.fromEntries(quote.items.map((item) => [item.id, { packaging: item.packaging ?? '', fob: '', cfr: '' }])),
  );
  const [erros, setErros] = useState<Record<string, string>>({});
  const [erroTopo, setErroTopo] = useState<string | null>(null);
  const [focoErro, setFocoErro] = useState(0);
  const [livre, setLivre] = useState<FreeItemState>({ aberto: false, descricao: '', quantidade: '', erro: null });

  // Foco inicial: o formulario so existe depois da consulta (o Modal ja procurou o data-autofocus no "Carregando") e remonta a cada acao
  // bem-sucedida (marcar como enviada, incluir item). Vai para o campo marcado com data-autofocus; sem ele, so se o foco se perdeu
  // (o botao focado sumiu na remontagem) cai no 1o controle do formulario. Nunca autoFocus do React.
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    const alvo = form.querySelector<HTMLElement>('[data-autofocus]');
    if (alvo) {
      alvo.focus();
      return;
    }
    const ativo = document.activeElement;
    if (!ativo || ativo === document.body || !form.closest('dialog')?.contains(ativo)) {
      form.querySelector<HTMLElement>('input, select, button')?.focus();
    }
  }, []);

  // Depois de um erro de validacao, o foco vai para o 1o campo marcado (aria-invalid).
  useEffect(() => {
    if (focoErro === 0) return;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [focoErro]);

  const mutacao = useMutation({
    mutationFn: (acao: Acao) => acao.executar(),
    onSuccess: (dados, acao) => {
      void qc.invalidateQueries({ queryKey: ['indent', 'quotes'] });
      void qc.invalidateQueries({ queryKey: ['indent', 'requests'] });
      const mensagem = acao.mensagem(dados);
      if (acao.fecha) {
        onClose(mensagem);
        return;
      }
      qc.setQueryData(['indent', 'quotes', quote.id], dados);
      mostrar('salvo', mensagem, '');
    },
    onError: (erro) => {
      if (erro instanceof ApiError) {
        const corpo = erro.body as { message?: unknown; path?: unknown } | null;
        const mensagem = corpo && typeof corpo.message === 'string' ? corpo.message : erro.message;
        const caminho = corpo && typeof corpo.path === 'string' ? corpo.path : '';

        if (erro.status === 400 && caminho) {
          if (caminho === 'description' || caminho === 'quantityKg') {
            setLivre((atual) => ({ ...atual, erro: { campo: caminho === 'description' ? 'descricao' : 'quantidade', mensagem } }));
          } else {
            setErros((atual) => ({ ...atual, [caminho]: mensagem }));
          }
          setFocoErro((n) => n + 1);
          return;
        }
        // 409 (inclusive o aceite unico perdido na corrida): a consulta e refeita e a gaveta passa a mostrar o aviso e a esconder o botao.
        if (erro.status === 409) void qc.invalidateQueries({ queryKey: ['indent', 'quotes'] });
        setErroTopo(mensagem);
        return;
      }
      setErroTopo(mensagemDoErro(erro));
    },
  });

  const pendente = mutacao.isPending;
  const fornecedor = quote.supplier.name;

  function disparar(acao: Acao) {
    setErroTopo(null);
    setErros({});
    mutacao.mutate(acao);
  }

  function marcarEnviada() {
    disparar({
      executar: () => markIndentQuoteSent(quote.id, sentOn),
      mensagem: () => `Cotação ${quote.ref} marcada como enviada para ${fornecedor}`,
      fecha: false,
    });
  }

  function responder() {
    const novos: Record<string, string> = {};
    const exige = (condicao: boolean, chave: string, mensagem: string) => {
      if (condicao) novos[chave] = mensagem;
    };

    exige(!resposta.respondedOn, 'respondedOn', 'Informe a data da resposta.');
    exige(!resposta.validUntil, 'validUntil', 'Informe a validade da cotação.');
    const prazo = Number(resposta.leadDays);
    exige(!Number.isInteger(prazo) || prazo < 1 || prazo > 365, 'productionLeadTimeDays', 'O prazo de produção deve ser de 1 a 365 dias.');
    exige(resposta.paymentTerms.trim() === '', 'paymentTerms', 'Informe a condição de pagamento.');

    const itens = quote.items.map((item, index) => {
      const valor = valores[item.id] ?? { packaging: '', fob: '', cfr: '' };
      const fob = parsePriceInput(valor.fob);
      const cfr = parsePriceInput(valor.cfr);
      exige(valor.packaging.trim() === '', `items.${index}.packaging`, 'Informe a embalagem de todos os itens.');
      exige(valor.fob.trim() === '', `items.${index}.fobPricePerKg`, 'Informe FOB e CFR de todos os itens.');
      exige(valor.fob.trim() !== '' && fob === null, `items.${index}.fobPricePerKg`, 'Preço inválido: use até 4 casas decimais.');
      exige(valor.cfr.trim() === '', `items.${index}.cfrPricePerKg`, 'Informe FOB e CFR de todos os itens.');
      exige(valor.cfr.trim() !== '' && cfr === null, `items.${index}.cfrPricePerKg`, 'Preço inválido: use até 4 casas decimais.');
      exige(fob !== null && cfr !== null && Number(cfr) < Number(fob), `items.${index}.cfrPricePerKg`, 'CFR não pode ser menor que FOB.');
      return { quoteItemId: item.id, packaging: valor.packaging.trim(), fobPricePerKg: fob ?? '', cfrPricePerKg: cfr ?? '' };
    });

    if (Object.keys(novos).length > 0) {
      setErroTopo(null);
      setErros(novos);
      setFocoErro((n) => n + 1);
      return;
    }

    disparar({
      executar: () =>
        recordIndentQuoteResponse(quote.id, {
          respondedOn: resposta.respondedOn,
          currency: resposta.currency,
          validUntil: resposta.validUntil,
          productionLeadTimeDays: prazo,
          paymentTerms: resposta.paymentTerms.trim(),
          manufacturer: resposta.manufacturer.trim() || undefined,
          notes: resposta.notes.trim() || undefined,
          destination: resposta.destination.trim() || undefined,
          items: itens,
        }),
      mensagem: () => `Resposta de ${fornecedor} registrada em ${quote.ref}`,
      fecha: false,
    });
  }

  function incluirItemLivre() {
    const descricao = livre.descricao.trim();
    const quantidade = parseQuantidadePtBr(livre.quantidade);

    if (descricao === '') {
      setLivre({ ...livre, erro: { campo: 'descricao', mensagem: 'Informe o produto.' } });
      return;
    }
    if (quantidade === null || quantidade <= 0) {
      setLivre({ ...livre, erro: { campo: 'quantidade', mensagem: 'Informe a quantidade em kg.' } });
      return;
    }

    setLivre({ ...livre, erro: null });
    disparar({
      executar: () => addIndentQuoteFreeItem(quote.id, { description: descricao, quantityKg: quantidade }),
      mensagem: () => `Item livre incluído em ${quote.ref}`,
      fecha: false,
    });
  }

  function aceitar() {
    disparar({
      executar: () => acceptIndentQuote(quote.id),
      mensagem: () => `Processo ${quote.ref} aberto com ${endSentence(fornecedor)} Outras cotações da mesma solicitação seguem em análise`,
      fecha: true,
    });
  }

  function recusar() {
    disparar({
      executar: () => refuseIndentQuote(quote.id),
      mensagem: () => `Cotação ${quote.ref} de ${fornecedor} marcada como recusada`,
      fecha: true,
    });
  }

  function pedirRevisao() {
    disparar({
      executar: () => requestIndentQuoteRevision(quote.id),
      mensagem: (dados) => `Revisão ${dados.ref} criada em rascunho; a versão anterior ficou como Revisada`,
      fecha: true,
    });
  }

  // Enter no formulario = a acao principal do estado (marcar como enviada / registrar resposta); nos demais estados nao ha o que enviar.
  function aoEnviar(event: FormEvent) {
    event.preventDefault();
    if (pendente) return;
    if (acoes.has('response')) responder();
    else if (acoes.has('mark-sent')) marcarEnviada();
  }

  function mudarResposta(campo: keyof RespostaForm, valor: string) {
    setResposta((atual) => ({ ...atual, [campo]: valor }));
  }

  const aviso = acceptedNotice(quote);
  const excecao = quote.exception;
  const regra = quote.client?.supplierRuleMode;
  const nomeCliente = quote.client ? firstWords(quote.client.name) : '';
  const observacao = observationText(quote.manufacturer, quote.notes);
  const totalEstimado = emResposta
    ? estimateTotal(quote.items.map((item) => ({ quantityKg: item.quantityKg, cfr: valores[item.id]?.cfr ?? '' })))
    : quote.total;
  const campoErro = (chave: string) =>
    erros[chave] ? (
      <p id={`${base}-${chave}-erro`} className="field-error" role="alert">
        {erros[chave]}
      </p>
    ) : null;
  const ligacao = (chave: string) => ({
    'aria-invalid': erros[chave] ? (true as const) : undefined,
    'aria-describedby': erros[chave] ? `${base}-${chave}-erro` : undefined,
  });

  return (
    <form ref={formRef} className="indent-form indent-gaveta__form" noValidate aria-busy={pendente} onSubmit={aoEnviar}>
      {erroTopo && (
        <div role="alert" className="alert alert--warning">
          {erroTopo}
        </div>
      )}

      {excecao && (
        <div className="indent-excbanner" role="alert">
          <Icon name="lock" size={22} strokeWidth={2.2} />
          <div>
            <strong>Exceção à restrição do cliente</strong>
            <span>
              {regra === 'APROVADOS'
                ? `${nomeCliente} só aceita fornecedores aprovados.`
                : regra === 'BLOQUEIO'
                  ? `${nomeCliente} bloqueou este fornecedor.`
                  : 'Cotação aberta fora da regra do cliente.'}{' '}
              <b>Motivo:</b> {excecao.reason} · liberada por {excecao.byName ?? '—'} em {formatarDataHora(excecao.at)}
            </span>
          </div>
        </div>
      )}

      {!quote.supplier.hasPartnership && (
        <div className="alert alert--info indent-alerta">
          <Icon name="lock" size={18} />
          <span>
            Fornecedor <b>sem parceria firmada</b>: o e-mail e o portal não dizem que a SQ é a compradora e não mostram o cliente.
          </span>
        </div>
      )}

      {aviso && (
        <div className="alert alert--info indent-alerta">
          <Icon name="info" size={18} />
          <span>{aviso}</span>
        </div>
      )}

      <div className="indent-processo">
        <div className="indent-cell-main">
          <span className="eyebrow">Referência de processo indent</span>
          <span className="indent-ref">{quote.ref}</span>
        </div>
        <span className="indent-processo__estado">{quote.status === 'ACEITA' ? 'Processo aberto' : 'Mesmo número da solicitação'}</span>
      </div>

      <dl className="indent-dl">
        <dt>Solicitação</dt>
        <dd>
          <span className="indent-ref">{quote.processNumber}</span>
        </dd>
        <dt>Fornecedor</dt>
        <dd>{quote.supplier.country ? `${fornecedor} · ${quote.supplier.country}` : fornecedor}</dd>
        <dt>Incoterm</dt>
        <dd>{incotermLine(quote.destination)}</dd>
        <dt>Moeda</dt>
        <dd>{quote.currency}</dd>
        <dt>Validade</dt>
        <dd>{quote.validUntil ? formatDateKey(quote.validUntil, 'longa') : 'a definir'}</dd>
        <dt>Prazo de produção</dt>
        <dd>{quote.productionLeadTimeDays !== null ? `${quote.productionLeadTimeDays} dias` : 'a definir'}</dd>
        <dt>Pagamento</dt>
        <dd>{quote.paymentTerms ?? 'a definir'}</dd>
        {observacao && (
          <>
            <dt>Observação</dt>
            <dd>{observacao}</dd>
          </>
        )}
        {quote.base && (
          <>
            <dt>Revisão de</dt>
            <dd>
              <span className="indent-ref">{quote.base.ref}</span>
            </dd>
          </>
        )}
      </dl>

      {emResposta && (
        <fieldset className="indent-condicoes">
          <legend>Resposta do fornecedor</legend>
          <div className="indent-campos">
            <div className="field">
              <label className="field-label" htmlFor={`${base}-respondedOn`}>
                Data da resposta
              </label>
              <input
                id={`${base}-respondedOn`}
                type="date"
                className="input"
                data-autofocus
                max={hoje}
                value={resposta.respondedOn}
                onChange={(event) => mudarResposta('respondedOn', event.target.value)}
                {...ligacao('respondedOn')}
              />
              {campoErro('respondedOn')}
            </div>
            <div className="field">
              <label className="field-label" htmlFor={`${base}-currency`}>
                Moeda
              </label>
              <select
                id={`${base}-currency`}
                className="input"
                value={resposta.currency}
                onChange={(event) => mudarResposta('currency', event.target.value)}
                {...ligacao('currency')}
              >
                {MOEDAS.map((moeda) => (
                  <option key={moeda} value={moeda}>
                    {moeda}
                  </option>
                ))}
              </select>
              {campoErro('currency')}
            </div>
            <div className="field">
              <label className="field-label" htmlFor={`${base}-validUntil`}>
                Validade
              </label>
              <input
                id={`${base}-validUntil`}
                type="date"
                className="input"
                min={resposta.respondedOn || undefined}
                value={resposta.validUntil}
                onChange={(event) => mudarResposta('validUntil', event.target.value)}
                {...ligacao('validUntil')}
              />
              <span className="field-hint">Validade igual ou posterior à data da resposta.</span>
              {campoErro('validUntil')}
            </div>
            <div className="field">
              <label className="field-label" htmlFor={`${base}-productionLeadTimeDays`}>
                Prazo de produção (dias)
              </label>
              <input
                id={`${base}-productionLeadTimeDays`}
                className="input"
                inputMode="numeric"
                value={resposta.leadDays}
                onChange={(event) => mudarResposta('leadDays', event.target.value)}
                {...ligacao('productionLeadTimeDays')}
              />
              {campoErro('productionLeadTimeDays')}
            </div>
            <div className="field">
              <label className="field-label" htmlFor={`${base}-paymentTerms`}>
                Pagamento
              </label>
              <input
                id={`${base}-paymentTerms`}
                className="input"
                placeholder="Ex.: T/T 60 dias após B/L"
                maxLength={200}
                value={resposta.paymentTerms}
                onChange={(event) => mudarResposta('paymentTerms', event.target.value)}
                {...ligacao('paymentTerms')}
              />
              {campoErro('paymentTerms')}
            </div>
            <div className="field">
              <label className="field-label" htmlFor={`${base}-destination`}>
                Porto de destino (CFR)
              </label>
              <input
                id={`${base}-destination`}
                className="input"
                maxLength={80}
                value={resposta.destination}
                onChange={(event) => mudarResposta('destination', event.target.value)}
                {...ligacao('destination')}
              />
              {campoErro('destination')}
            </div>
            <div className="field">
              <label className="field-label" htmlFor={`${base}-manufacturer`}>
                Fabricante
              </label>
              <input
                id={`${base}-manufacturer`}
                className="input"
                maxLength={200}
                value={resposta.manufacturer}
                onChange={(event) => mudarResposta('manufacturer', event.target.value)}
                {...ligacao('manufacturer')}
              />
              {campoErro('manufacturer')}
            </div>
            <div className="field">
              <label className="field-label" htmlFor={`${base}-notes`}>
                Observação
              </label>
              <input
                id={`${base}-notes`}
                className="input"
                maxLength={2000}
                value={resposta.notes}
                onChange={(event) => mudarResposta('notes', event.target.value)}
                {...ligacao('notes')}
              />
              {campoErro('notes')}
            </div>
          </div>
        </fieldset>
      )}

      <IndentCotacaoItens
        quote={quote}
        editable={emResposta}
        canAddFree={acoes.has('items')}
        values={valores}
        onValue={(itemId, campo, valor) =>
          setValores((atual) => ({ ...atual, [itemId]: { ...(atual[itemId] ?? { packaging: '', fob: '', cfr: '' }), [campo]: valor } }))
        }
        errors={erros}
        totalTexto={totalEstimado === null ? '—' : formatMoney(totalEstimado, quote.currency)}
        free={livre}
        onFreeChange={(campo, valor) => setLivre((atual) => ({ ...atual, [campo]: valor }))}
        onFreeOpen={() => setLivre({ aberto: true, descricao: '', quantidade: '', erro: null })}
        onFreeCancel={() => setLivre({ aberto: false, descricao: '', quantidade: '', erro: null })}
        onFreeSubmit={incluirItemLivre}
        pendente={pendente}
      />

      <div className="modal-actions">
        {acoes.has('mark-sent') && (
          <div className="indent-enviada">
            <label className="field-label" htmlFor={`${base}-sentOn`}>
              Enviada em
            </label>
            <input
              id={`${base}-sentOn`}
              type="date"
              className="input indent-data"
              max={hoje}
              value={sentOn}
              onChange={(event) => setSentOn(event.target.value)}
              {...ligacao('sentOn')}
            />
            {campoErro('sentOn')}
          </div>
        )}
        {acoes.has('mark-sent') && (
          <button type="submit" className="primary-button" aria-busy={pendente} disabled={pendente}>
            <Icon name="templates" size={16} />
            Marcar como enviada
          </button>
        )}
        {emResposta && (
          <button type="submit" className="primary-button" aria-busy={pendente} disabled={pendente}>
            <Icon name="check" size={16} strokeWidth={2.4} />
            Registrar resposta
          </button>
        )}
        {acoes.has('refuse') && (
          <button type="button" className="ghost-button" aria-busy={pendente} disabled={pendente} onClick={recusar}>
            Recusar
          </button>
        )}
        {acoes.has('revision') && (
          <button type="button" className="ghost-button" aria-busy={pendente} disabled={pendente} onClick={pedirRevisao}>
            <Icon name="refresh" size={16} />
            Pedir revisão
          </button>
        )}
        {acoes.has('accept') && (
          <button type="button" className="primary-button" aria-busy={pendente} disabled={pendente} onClick={aceitar}>
            <Icon name="check" size={16} strokeWidth={2.4} />
            Aceitar e abrir processo
          </button>
        )}
        {quote.allowedActions.length === 0 && (
          <button type="button" className="ghost-button" onClick={() => onClose()}>
            Fechar
          </button>
        )}
      </div>
    </form>
  );
}
