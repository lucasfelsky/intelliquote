import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/api/client';
import { Icon } from '@/components/icons';
import { Modal } from '@/components/Modal';
import { normalizeItemNameKey } from '@/pages/Solicitacoes/itemNovo';
import { listIndentProductOptions } from '@/services/indent';
import { updateIndentNoteItems, type IndentNoteItemInput, type IndentRequestDetail } from '@/services/indentRequests';
import { formatarKg, mensagemDoErro, parseQuantidadePtBr } from './indentFila';

// IQ Indent: "Revisar itens da nota" (mock: o sistema propoe, o usuario confirma). Os itens lidos da nota do Pipedrive nascem NAO confirmados:
// so depois desta confirmacao a solicitacao pode gerar cotacoes. Serve tambem para "Digitar itens" (nota que nao deu para ler). O texto da nota e
// sempre TEXTO React (nunca HTML). A lista enviada cobre TODOS os itens atuais por id (`remove: true` exclui); item sem id e novo.

const LIMITE_ITENS = 50;
const LIMITE_KG = 1_000_000_000;
const ERRO_MUDARAM = /mudaram/i;

interface LinhaItem {
  chave: number;
  /** Id do item atual; ausente = item novo digitado aqui. */
  id?: number;
  produto: string;
  quantidade: string;
  /** Linha original da nota (so itens lidos da nota). */
  linhaOriginal: string | null;
  removida: boolean;
}

interface ErroLinha {
  produto?: string;
  quantidade?: string;
}

/** Edicoes do usuario por id do item (produto e quantidade digitados), preservadas quando o modal reabre com a lista recarregada. */
export type EdicoesDoModal = Record<number, { produto: string; quantidade: string }>;

interface Props {
  solicitacao: IndentRequestDetail;
  /** Aviso mostrado ao abrir (ex.: depois de recarregar porque os itens mudaram). */
  avisoInicial?: string | null;
  /** Edicoes da abertura anterior: valem para os itens que continuam existindo (por id). */
  edicoesIniciais?: EdicoesDoModal;
  onClose: () => void;
  /** Chamado depois de confirmar (a tela mostra o toast "Itens confirmados" e devolve o foco). */
  onConfirmed: () => void;
  /** Os itens mudaram no servidor enquanto o modal estava aberto: a tela recarrega e reabre com a lista nova. */
  onStale: (mensagem: string, edicoes: EdicoesDoModal) => void;
}

function linhasIniciais(solicitacao: IndentRequestDetail, edicoes: EdicoesDoModal = {}): LinhaItem[] {
  if (solicitacao.items.length === 0) return [{ chave: 1, produto: '', quantidade: '', linhaOriginal: null, removida: false }];
  return solicitacao.items.map((item, indice) => ({
    chave: indice + 1,
    id: item.id,
    produto: edicoes[item.id]?.produto ?? item.name,
    // Quantidade nao lida da nota vem 0: o campo abre vazio (a tela mostra "— kg").
    quantidade: edicoes[item.id]?.quantidade ?? (item.quantityKg > 0 ? formatarKg(item.quantityKg) : ''),
    linhaOriginal: item.noteLine,
    removida: false,
  }));
}

function quantidadeValida(quantidade: number | null): quantidade is number {
  // Mesma regra do backend: > 0, ate 1e9 e ate 3 casas decimais.
  return quantidade !== null && quantidade > 0 && quantidade <= LIMITE_KG && Math.abs(quantidade * 1000 - Math.round(quantidade * 1000)) < 1e-6;
}

export default function IndentNotaItensModal({ solicitacao, avisoInicial = null, edicoesIniciais, onClose, onConfirmed, onStale }: Props) {
  const qc = useQueryClient();
  const produtos = useQuery({ queryKey: ['indent', 'products', 'options'], queryFn: listIndentProductOptions });

  const [linhas, setLinhas] = useState<LinhaItem[]>(() => linhasIniciais(solicitacao, edicoesIniciais));
  const [proxima, setProxima] = useState(() => Math.max(solicitacao.items.length, 1) + 1);
  const [errosLinhas, setErrosLinhas] = useState<Record<number, ErroLinha>>({});
  const [erroForm, setErroForm] = useState<string | null>(avisoInicial);

  const visiveis = linhas.filter((linha) => !linha.removida);
  const primeiraVisivel = visiveis[0]?.chave;
  const rotuloLinhas = new Map(visiveis.map((linha, indice) => [linha.chave, indice + 1]));

  const confirmar = useMutation({
    mutationFn: (itens: IndentNoteItemInput[]) => updateIndentNoteItems(solicitacao.id, itens),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['indent', 'requests'] });
      // Item sem produto do catalogo vira produto LIVRE no backend: o catalogo muda.
      void qc.invalidateQueries({ queryKey: ['indent', 'products'] });
      onConfirmed();
    },
    onError: (err) => {
      const mensagem = mensagemDoErro(err);
      if (err instanceof ApiError && err.status === 400 && ERRO_MUDARAM.test(mensagem)) {
        // A sincronizacao trocou os itens da nota com o modal aberto: confirmar uma lista que a pessoa nao viu quebraria a confirmacao humana.
        void qc.refetchQueries({ queryKey: ['indent', 'requests', solicitacao.id] }).then(() => onStale(mensagem, edicoesDoUsuario()));
        return;
      }
      setErroForm(mensagem);
      // 409 "Os itens desta solicitação já foram cotados." (outra pessoa gerou as cotacoes): o detalhe e relido.
      void qc.invalidateQueries({ queryKey: ['indent', 'requests'] });
    },
  });

  // So itens que ja existem (por id) e nao foram removidos: sao os que continuam valendo depois de recarregar.
  function edicoesDoUsuario(): EdicoesDoModal {
    const edicoes: EdicoesDoModal = {};
    for (const linha of linhas) {
      if (linha.id !== undefined && !linha.removida) edicoes[linha.id] = { produto: linha.produto, quantidade: linha.quantidade };
    }
    return edicoes;
  }

  function atualizar(chave: number, campo: 'produto' | 'quantidade', valor: string) {
    setLinhas((atuais) => atuais.map((linha) => (linha.chave === chave ? { ...linha, [campo]: valor } : linha)));
  }

  function adicionar() {
    setLinhas((atuais) => [...atuais, { chave: proxima, produto: '', quantidade: '', linhaOriginal: null, removida: false }]);
    setProxima((n) => n + 1);
  }

  function remover(chave: number) {
    // Item atual continua na lista (como `remove: true`); item novo some de vez.
    setLinhas((atuais) =>
      atuais.flatMap((linha) => {
        if (linha.chave !== chave) return [linha];
        return linha.id === undefined ? [] : [{ ...linha, removida: true }];
      }),
    );
    setErrosLinhas((atuais) => {
      const resto = { ...atuais };
      delete resto[chave];
      return resto;
    });
  }

  function enviar(event: FormEvent) {
    event.preventDefault();
    // Catalogo ainda carregando: o produto digitado nao seria ligado ao catalogo (o backend o trataria como item livre).
    if (confirmar.isPending || produtos.isLoading) return;
    setErroForm(null);

    if (visiveis.length === 0) {
      setErroForm('Mantenha ao menos um item.');
      return;
    }
    // O limite do backend vale para a lista enviada: itens removidos (remove:true) tambem contam.
    if (linhas.length > LIMITE_ITENS) {
      setErroForm(`Informe no máximo ${LIMITE_ITENS} itens.`);
      return;
    }

    const erros: Record<number, ErroLinha> = {};
    const itens: IndentNoteItemInput[] = [];

    for (const linha of linhas) {
      if (linha.removida) {
        // `remove: true` so para item que ja existe (a lista tem de cobrir todos os ids atuais).
        if (linha.id !== undefined) itens.push({ id: linha.id, remove: true });
        continue;
      }
      const descricao = linha.produto.trim();
      const quantidade = parseQuantidadePtBr(linha.quantidade);
      const erro: ErroLinha = {};

      if (descricao === '') erro.produto = 'Informe o produto.';
      else if (descricao.length > 300) erro.produto = 'O produto deve ter no máximo 300 caracteres.';
      if (!quantidadeValida(quantidade)) erro.quantidade = 'Informe a quantidade em kg.';
      if (erro.produto || erro.quantidade) {
        erros[linha.chave] = erro;
        continue;
      }

      // Produto do catalogo quando o texto bate (sem acento/caixa/espacos); senao o backend reaproveita/cria o item livre.
      const chave = normalizeItemNameKey(descricao);
      const doCatalogo = (produtos.data ?? []).find((produto) => normalizeItemNameKey(produto.name) === chave);
      itens.push({
        ...(linha.id !== undefined ? { id: linha.id } : {}),
        ...(doCatalogo ? { productId: doCatalogo.id } : {}),
        description: descricao,
        quantityKg: quantidade as number,
      });
    }

    setErrosLinhas(erros);
    if (Object.keys(erros).length > 0) return;

    confirmar.mutate(itens);
  }

  const semItens = solicitacao.items.length === 0;

  return (
    <Modal
      isOpen
      restoreFocus
      onClose={onClose}
      eyebrow={`Pipedrive · negócio #${solicitacao.pipedriveDealId ?? '—'}`}
      title={semItens ? 'Digitar itens' : 'Revisar itens da nota'}
    >
      <form onSubmit={enviar} noValidate className="indent-form">
        {erroForm && (
          <div role="alert" className="alert alert--error">
            {erroForm}
          </div>
        )}
        {produtos.isError && (
          <div role="alert" className="alert alert--warning">
            Não foi possível carregar o catálogo: {mensagemDoErro(produtos.error)} Os produtos digitados entram como item livre.
          </div>
        )}

        {solicitacao.rawNote && (
          <div className="field">
            <span className="field-label">Nota do negócio (texto original)</span>
            <pre className="indent-nota">{solicitacao.rawNote}</pre>
          </div>
        )}

        <div className="indent-itens">
          <span className="field-label">Itens</span>
          {visiveis.map((linha) => {
            const erro = errosLinhas[linha.chave];
            return (
              <div key={linha.chave} className="indent-item-linha">
                <div className="indent-campos">
                  <div className="field">
                    <label className="field-label" htmlFor={`nota-produto-${linha.chave}`}>
                      Produto
                    </label>
                    <input
                      id={`nota-produto-${linha.chave}`}
                      className="input"
                      list="nota-catalogo"
                      placeholder="Digite ou escolha do catálogo"
                      data-autofocus={linha.chave === primeiraVisivel ? true : undefined}
                      value={linha.produto}
                      aria-invalid={erro?.produto ? true : undefined}
                      onChange={(event) => atualizar(linha.chave, 'produto', event.target.value)}
                    />
                    {linha.linhaOriginal && <span className="field-hint">Linha da nota: {linha.linhaOriginal}</span>}
                    {erro?.produto && (
                      <p className="field-error" role="alert">
                        {erro.produto}
                      </p>
                    )}
                  </div>
                  <div className="field">
                    <label className="field-label" htmlFor={`nota-qtd-${linha.chave}`}>
                      Quantidade (kg)
                    </label>
                    <input
                      id={`nota-qtd-${linha.chave}`}
                      className="input indent-input-mono"
                      inputMode="decimal"
                      value={linha.quantidade}
                      aria-invalid={erro?.quantidade ? true : undefined}
                      onChange={(event) => atualizar(linha.chave, 'quantidade', event.target.value)}
                    />
                    {erro?.quantidade && (
                      <p className="field-error" role="alert">
                        {erro.quantidade}
                      </p>
                    )}
                  </div>
                </div>
                {visiveis.length > 1 && (
                  <button
                    type="button"
                    className="ghost-button ghost-button--sm indent-item-remover"
                    aria-label={`Remover item ${rotuloLinhas.get(linha.chave) ?? ''}`.trim()}
                    onClick={() => remover(linha.chave)}
                  >
                    <Icon name="x" size={16} />
                  </button>
                )}
              </div>
            );
          })}
          <datalist id="nota-catalogo">
            {(produtos.data ?? []).map((produto) => (
              <option key={produto.id} value={produto.name} />
            ))}
          </datalist>

          <div className="alert alert--warning">
            <span>
              Se o produto não estiver no catálogo, ele entra como <b>item livre</b> e você pode promovê-lo depois.
            </span>
          </div>
          <div>
            <button type="button" className="ghost-button ghost-button--sm" onClick={adicionar} disabled={linhas.length >= LIMITE_ITENS}>
              <Icon name="plus" size={15} strokeWidth={2.4} />
              Adicionar outro item
            </button>
          </div>
        </div>

        <div className="modal-actions">
          <button type="button" className="ghost-button" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="primary-button" aria-disabled={confirmar.isPending || produtos.isLoading ? true : undefined}>
            Confirmar itens
          </button>
        </div>
      </form>
    </Modal>
  );
}
