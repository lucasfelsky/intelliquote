import { useEffect, useId, useRef, type KeyboardEvent } from 'react';
import { Icon } from '@/components/icons';
import type { IndentQuoteDetail } from '@/services/indentQuotes';
import { cfrHeader, formatPricePerKg, formatQuantityKg } from './indentCotacao';

// IQ Indent: tabela "Itens e preços (por kg)" da gaveta da cotacao (mock openCot). Em ENVIADA (registro da resposta) ha inputs de embalagem, FOB e CFR;
// nos demais estados so leitura. "Adicionar item livre" (so no RASCUNHO) abre uma linha com descricao + quantidade.

export interface PriceValues {
  packaging: string;
  fob: string;
  cfr: string;
}

export interface FreeItemState {
  aberto: boolean;
  descricao: string;
  quantidade: string;
  /** Erro de validacao com o campo a que pertence (aria-invalid e aria-describedby so nele). */
  erro: { campo: 'descricao' | 'quantidade'; mensagem: string } | null;
}

interface Props {
  quote: IndentQuoteDetail;
  /** ENVIADA com a acao "registrar resposta" permitida: precos e embalagem viram inputs. */
  editable: boolean;
  /** RASCUNHO com a acao "incluir item" permitida. */
  canAddFree: boolean;
  values: Record<number, PriceValues>;
  onValue: (itemId: number, campo: keyof PriceValues, valor: string) => void;
  /** Erros inline por chave (`items.<i>.fobPricePerKg|cfrPricePerKg|packaging`). */
  errors: Record<string, string>;
  /** Total a exibir: o do backend, ou o estimado na tela enquanto se digita. */
  totalTexto: string;
  free: FreeItemState;
  onFreeChange: (campo: 'descricao' | 'quantidade', valor: string) => void;
  onFreeOpen: () => void;
  onFreeCancel: () => void;
  onFreeSubmit: () => void;
  pendente: boolean;
}

export default function IndentCotacaoItens({
  quote,
  editable,
  canAddFree,
  values,
  onValue,
  errors,
  totalTexto,
  free,
  onFreeChange,
  onFreeOpen,
  onFreeCancel,
  onFreeSubmit,
  pendente,
}: Props) {
  const base = useId();
  const descricaoRef = useRef<HTMLInputElement>(null);

  // Ao abrir a linha do item livre, o foco vai para a descricao (como o mock).
  useEffect(() => {
    if (free.aberto) descricaoRef.current?.focus();
  }, [free.aberto]);

  function aoTeclarNoItemLivre(event: KeyboardEvent<HTMLInputElement>) {
    // Enter nao pode enviar o formulario inteiro (registrar resposta): inclui o item.
    if (event.key === 'Enter') {
      event.preventDefault();
      onFreeSubmit();
    }
  }

  return (
    <section className="indent-itens-precos">
      <div className="indent-painel__cabeca">
        <h2>Itens e preços (por kg)</h2>
        {canAddFree && !free.aberto && (
          <button type="button" className="ghost-button ghost-button--sm" onClick={onFreeOpen}>
            <Icon name="plus" size={15} strokeWidth={2.4} />
            Adicionar item livre
          </button>
        )}
      </div>

      <div className="indent-tabela-caixa">
        <div className="table-wrapper">
          <table className="table indent-tabela">
            <thead>
              <tr>
                <th>Item</th>
                <th>Embalagem</th>
                <th className="indent-num">Qtd.</th>
                <th className="indent-num">FOB</th>
                <th className="indent-num">{cfrHeader(quote.destination)}</th>
              </tr>
            </thead>
            <tbody>
              {quote.items.map((item, index) => {
                const valor = values[item.id] ?? { packaging: '', fob: '', cfr: '' };
                const idBase = `${base}-${index}`;
                const erroFob = errors[`items.${index}.fobPricePerKg`];
                const erroCfr = errors[`items.${index}.cfrPricePerKg`];
                const erroEmb = errors[`items.${index}.packaging`];
                return (
                  <tr key={item.id}>
                    <td>
                      <div className="indent-cell-main">
                        <span>{item.name}</span>
                        {item.isFree ? (
                          <span className="indent-tag indent-tag--manual">Item livre</span>
                        ) : (
                          <span className="indent-cell-sub">{item.cas ? `CAS ${item.cas}` : 'sem CAS'}</span>
                        )}
                      </div>
                    </td>
                    <td>
                      {editable ? (
                        <>
                          <label className="sr-only" htmlFor={`${idBase}-emb`}>
                            Embalagem
                          </label>
                          <input
                            id={`${idBase}-emb`}
                            className="input indent-desc"
                            placeholder="Ex.: tambor 200 kg"
                            value={valor.packaging}
                            aria-invalid={erroEmb ? true : undefined}
                            aria-describedby={erroEmb ? `${idBase}-emb-erro` : undefined}
                            onChange={(event) => onValue(item.id, 'packaging', event.target.value)}
                          />
                          {erroEmb && (
                            <p id={`${idBase}-emb-erro`} className="field-error" role="alert">
                              {erroEmb}
                            </p>
                          )}
                        </>
                      ) : (
                        (item.packaging ?? '—')
                      )}
                    </td>
                    <td className="indent-num">{formatQuantityKg(item.quantityKg)} kg</td>
                    <td className="indent-num">
                      {editable ? (
                        <>
                          <label className="sr-only" htmlFor={`${idBase}-fob`}>
                            Preço FOB por kg
                          </label>
                          <input
                            id={`${idBase}-fob`}
                            className="input indent-preco"
                            inputMode="decimal"
                            placeholder="0,000"
                            value={valor.fob}
                            aria-invalid={erroFob ? true : undefined}
                            aria-describedby={erroFob ? `${idBase}-fob-erro` : undefined}
                            onChange={(event) => onValue(item.id, 'fob', event.target.value)}
                          />
                          {erroFob && (
                            <p id={`${idBase}-fob-erro`} className="field-error" role="alert">
                              {erroFob}
                            </p>
                          )}
                        </>
                      ) : (
                        <span className="indent-mono">{formatPricePerKg(item.fobPricePerKg)}</span>
                      )}
                    </td>
                    <td className="indent-num">
                      {editable ? (
                        <>
                          <label className="sr-only" htmlFor={`${idBase}-cfr`}>
                            Preço CFR por kg
                          </label>
                          <input
                            id={`${idBase}-cfr`}
                            className="input indent-preco"
                            inputMode="decimal"
                            placeholder="0,000"
                            value={valor.cfr}
                            aria-invalid={erroCfr ? true : undefined}
                            aria-describedby={erroCfr ? `${idBase}-cfr-erro` : undefined}
                            onChange={(event) => onValue(item.id, 'cfr', event.target.value)}
                          />
                          {erroCfr && (
                            <p id={`${idBase}-cfr-erro`} className="field-error" role="alert">
                              {erroCfr}
                            </p>
                          )}
                        </>
                      ) : (
                        <span className="indent-mono">{formatPricePerKg(item.cfrPricePerKg)}</span>
                      )}
                    </td>
                  </tr>
                );
              })}

              {free.aberto && (
                <tr className="indent-item-novo">
                  <td>
                    <label className="sr-only" htmlFor={`${base}-livre-desc`}>
                      Descrição do item
                    </label>
                    <input
                      id={`${base}-livre-desc`}
                      ref={descricaoRef}
                      className="input indent-desc"
                      placeholder="Digite o item"
                      value={free.descricao}
                      aria-invalid={free.erro?.campo === 'descricao' ? true : undefined}
                      aria-describedby={free.erro?.campo === 'descricao' ? `${base}-livre-erro` : undefined}
                      onChange={(event) => onFreeChange('descricao', event.target.value)}
                      onKeyDown={aoTeclarNoItemLivre}
                    />
                  </td>
                  <td />
                  <td className="indent-num">
                    <label className="sr-only" htmlFor={`${base}-livre-qtd`}>
                      Quantidade (kg)
                    </label>
                    <input
                      id={`${base}-livre-qtd`}
                      className="input indent-preco"
                      inputMode="decimal"
                      placeholder="Qtd. (kg)"
                      value={free.quantidade}
                      aria-invalid={free.erro?.campo === 'quantidade' ? true : undefined}
                      aria-describedby={free.erro?.campo === 'quantidade' ? `${base}-livre-erro` : undefined}
                      onChange={(event) => onFreeChange('quantidade', event.target.value)}
                      onKeyDown={aoTeclarNoItemLivre}
                    />
                  </td>
                  <td colSpan={2} className="indent-acao">
                    <button type="button" className="ghost-button ghost-button--sm" aria-busy={pendente} disabled={pendente} onClick={onFreeSubmit}>
                      Incluir item
                    </button>{' '}
                    <button type="button" className="ghost-button ghost-button--sm" disabled={pendente} onClick={onFreeCancel}>
                      Cancelar
                    </button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {free.aberto && free.erro && (
        <p id={`${base}-livre-erro`} className="field-error" role="alert">
          {free.erro.mensagem}
        </p>
      )}

      <div className="indent-total">
        <span>Total estimado (CFR)</span>
        <span className="indent-mono" data-testid="cot-total">
          {totalTexto}
        </span>
      </div>
    </section>
  );
}
