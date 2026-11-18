import { useId, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Modal } from '@/components/Modal';
import { Icon } from '@/components/icons';
import { useConfirm } from '@/components/useConfirm';
import type { ForecastItemRelatorio } from '@/services/forecast';
import {
  forecastPrecoErrorMessage,
  lerPrecoPorKg,
  PRECO_MOEDAS,
  putForecastPrecoFechado,
  type PrecoFechadoDoItem,
  type PrecoMoeda,
} from '@/services/forecastPrecoFechado';
import { INCOTERMS, type Incoterm } from '@/services/quoteResponses';
import { dataBr } from './forecastPainel';

// Cadastro do PRECO FECHADO de um item (valor por kg, moeda, incoterm e validade). Abre da linha do Relatorio de compras para quem
// pode editar (admin/comprador). O selo vem da planilha (X da coluna AV); aqui so se define o preco de quem ja tem o selo. O estado
// nasce a cada abertura.

interface Props {
  item: ForecastItemRelatorio;
  /** Preco atual do cadastro (ausente = ainda nao carregou ou nunca cadastrado). */
  atual: PrecoFechadoDoItem | undefined;
  /** Hoje (AAAA-MM-DD, Sao Paulo) para avisar uma validade que ja passou. */
  hoje: string;
  onFechar: () => void;
  onSalvo: (preco: PrecoFechadoDoItem, removido: boolean) => void;
}

const valorInicial = (atual: PrecoFechadoDoItem | undefined): string =>
  atual?.valorPorKg == null ? '' : String(atual.valorPorKg).replace('.', ',');

export default function ForecastPrecoFechadoModal({ item, atual, hoje, onFechar, onSalvo }: Props) {
  const productId = item.productId as number;
  const ids = useId();
  const confirm = useConfirm();
  const [valor, setValor] = useState(valorInicial(atual));
  const [moeda, setMoeda] = useState<PrecoMoeda>(((PRECO_MOEDAS as readonly string[]).includes(atual?.moeda ?? '') ? atual?.moeda : 'USD') as PrecoMoeda);
  const [incoterm, setIncoterm] = useState<Incoterm>(((INCOTERMS as string[]).includes(atual?.incoterm ?? '') ? atual?.incoterm : 'CFR') as Incoterm);
  const [validoAte, setValidoAte] = useState(atual?.validoAte ?? '');
  const [erro, setErro] = useState<string | null>(null);
  const [tentou, setTentou] = useState(false);

  const lido = lerPrecoPorKg(valor);
  const erroValor = tentou && !lido.ok ? lido.erro : null;
  const erroValidade = tentou && validoAte === '' ? 'Informe até quando o preço vale.' : null;
  const vencida = validoAte !== '' && validoAte < hoje;
  const temPreco = atual?.valorPorKg != null;

  const salvar = useMutation({
    mutationFn: () => {
      if (!lido.ok || validoAte === '') throw new Error('Preço incompleto.');
      return putForecastPrecoFechado(productId, { valorPorKg: lido.valor, moeda, incoterm, validoAte });
    },
    onSuccess: (preco) => onSalvo(preco, false),
    onError: (e) => setErro(forecastPrecoErrorMessage(e)),
  });

  const remover = useMutation({
    mutationFn: () => putForecastPrecoFechado(productId, { limpar: true }),
    onSuccess: (preco) => onSalvo(preco, true),
    onError: (e) => setErro(forecastPrecoErrorMessage(e)),
  });

  const ocupado = salvar.isPending || remover.isPending;

  async function aoRemover() {
    const ok = await confirm({
      title: 'Remover o preço fechado?',
      message: `O item ${item.item} fica sem preço cadastrado e não poderá receber PO direta até um novo cadastro.`,
      confirmText: 'Remover preço',
    });
    if (ok) {
      setErro(null);
      remover.mutate();
    }
  }

  return (
    <Modal isOpen onClose={onFechar} title="Preço fechado" subtitle={item.item}>
      <form
        className="cmp-po"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setTentou(true);
          setErro(null);
          if (lido.ok && validoAte !== '' && !ocupado) salvar.mutate();
        }}
      >
        <div className="cmp-campo">
          <label className="field-label" htmlFor={`${ids}-valor`}>
            Preço por kg
          </label>
          <input
            id={`${ids}-valor`}
            className="input cmp-mono"
            inputMode="decimal"
            value={valor}
            aria-invalid={erroValor !== null}
            aria-describedby={erroValor ? `${ids}-valor-erro` : undefined}
            onChange={(e) => setValor(e.target.value)}
          />
          {erroValor && (
            <p id={`${ids}-valor-erro`} className="cmp-po__contador cmp-po__contador--excedido">
              {erroValor}
            </p>
          )}
        </div>

        <div className="cmp-campo">
          <label className="field-label" htmlFor={`${ids}-moeda`}>
            Moeda
          </label>
          <select id={`${ids}-moeda`} className="input" value={moeda} onChange={(e) => setMoeda(e.target.value as PrecoMoeda)}>
            {PRECO_MOEDAS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>

        <div className="cmp-campo">
          <label className="field-label" htmlFor={`${ids}-incoterm`}>
            Incoterm
          </label>
          <select id={`${ids}-incoterm`} className="input" value={incoterm} onChange={(e) => setIncoterm(e.target.value as Incoterm)}>
            {INCOTERMS.map((i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </select>
        </div>

        <div className="cmp-campo">
          <label className="field-label" htmlFor={`${ids}-validade`}>
            Válido até
          </label>
          <input
            id={`${ids}-validade`}
            className="input"
            type="date"
            value={validoAte}
            aria-invalid={erroValidade !== null}
            aria-describedby={`${ids}-validade-dica`}
            onChange={(e) => setValidoAte(e.target.value)}
          />
          <p id={`${ids}-validade-dica`} className={erroValidade ? 'cmp-po__contador cmp-po__contador--excedido' : 'cmp-po__dica'}>
            {erroValidade ??
              (vencida
                ? `Esta data (${dataBr(validoAte)}) já passou: o item ficará como vencido e não receberá PO.`
                : 'Depois dessa data o item pede a atualização do preço antes de enviar a PO.')}
          </p>
        </div>

        <p className="cmp-po-aviso cmp-po-aviso--atencao">
          <Icon name="alert-triangle" size={16} strokeWidth={1.9} />
          <span>O valor aparece só para admin e comprador. A reimportação da planilha não altera este cadastro.</span>
        </p>

        {erro && (
          <p role="alert" className="cmp-po-aviso cmp-po-aviso--erro cmp-po__erro">
            <Icon name="alert-circle" size={16} strokeWidth={1.9} />
            <span>{erro}</span>
          </p>
        )}

        <div className="modal-actions">
          {temPreco && (
            <button type="button" className="ghost-button danger-button" disabled={ocupado} onClick={() => void aoRemover()}>
              Remover preço
            </button>
          )}
          <button type="button" className="ghost-button" onClick={onFechar}>
            Cancelar
          </button>
          <button type="submit" className="primary-button" disabled={ocupado} aria-busy={salvar.isPending}>
            {salvar.isPending ? 'Salvando…' : 'Salvar preço'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
