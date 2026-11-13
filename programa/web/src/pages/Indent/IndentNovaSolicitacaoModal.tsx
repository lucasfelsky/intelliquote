import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import { Icon } from '@/components/icons';
import { Modal } from '@/components/Modal';
import { normalizeItemNameKey } from '@/pages/Solicitacoes/itemNovo';
import { listIndentProductOptions } from '@/services/indent';
import {
  createIndentRequest,
  getIndentRequestClientOptions,
  type IndentRequestCreateInput,
} from '@/services/indentRequests';
import { mensagemDoErro, parseQuantidadePtBr } from './indentFila';

// IQ Indent: "Nova solicitacao" (mock openNewSol). Origem IQ_INDENT: o responsavel e o usuario logado (o backend grava, sem campo de escolha).
// Produto fora do catalogo entra como item livre. Depois de criar, navega para o detalhe (o toast chega pelo state da navegacao).

interface LinhaItem {
  chave: number;
  produto: string;
  quantidade: string;
}

interface ErroLinha {
  produto?: string;
  quantidade?: string;
}

interface Props {
  onClose: () => void;
}

export default function IndentNovaSolicitacaoModal({ onClose }: Props) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const clientes = useQuery({
    queryKey: ['indent', 'requests', 'client-options'],
    queryFn: getIndentRequestClientOptions,
  });
  const produtos = useQuery({
    queryKey: ['indent', 'products', 'options'],
    queryFn: listIndentProductOptions,
  });

  const [clienteEscolhido, setClienteEscolhido] = useState('');
  const [linhas, setLinhas] = useState<LinhaItem[]>([{ chave: 1, produto: '', quantidade: '' }]);
  const [proxima, setProxima] = useState(2);
  const [erroCliente, setErroCliente] = useState<string | null>(null);
  const [errosLinhas, setErrosLinhas] = useState<Record<number, ErroLinha>>({});
  const [erroForm, setErroForm] = useState<string | null>(null);

  const opcoesCliente = clientes.data ?? [];
  // O select nao tem opcao em branco (mock): enquanto nada foi escolhido vale o 1o cliente da lista.
  const clienteId = clienteEscolhido !== '' ? clienteEscolhido : opcoesCliente[0] ? String(opcoesCliente[0].id) : '';

  // Sem lista de clientes (carregando, erro ou nenhum ativo) nao ha o que escolher: o envio fica desabilitado.
  const semClientes = clientes.isLoading || clientes.isError || opcoesCliente.length === 0;

  const salvar = useMutation({
    mutationFn: (input: IndentRequestCreateInput) => createIndentRequest(input),
    onSuccess: (criada) => {
      void qc.invalidateQueries({ queryKey: ['indent', 'requests'] });
      void qc.invalidateQueries({ queryKey: ['indent', 'products'] });
      navigate(`/indent/solicitacoes/${criada.id}`, {
        state: { toast: `Solicitação ${criada.processNumber} criada. Escolha os fornecedores` },
      });
    },
    onError: (err) => setErroForm(mensagemDoErro(err)),
  });

  function atualizar(chave: number, campo: 'produto' | 'quantidade', valor: string) {
    setLinhas((atuais) => atuais.map((linha) => (linha.chave === chave ? { ...linha, [campo]: valor } : linha)));
  }

  function adicionar() {
    setLinhas((atuais) => [...atuais, { chave: proxima, produto: '', quantidade: '' }]);
    setProxima((n) => n + 1);
  }

  function remover(chave: number) {
    setLinhas((atuais) => atuais.filter((linha) => linha.chave !== chave));
    setErrosLinhas((atuais) => {
      const resto = { ...atuais };
      delete resto[chave];
      return resto;
    });
  }

  function enviar(event: FormEvent) {
    event.preventDefault();
    setErroForm(null);

    const semCliente = clienteId === '';
    setErroCliente(semCliente ? 'Escolha o cliente.' : null);

    const erros: Record<number, ErroLinha> = {};
    const itens: IndentRequestCreateInput['items'] = [];

    for (const linha of linhas) {
      const descricao = linha.produto.trim();
      const quantidade = parseQuantidadePtBr(linha.quantidade);
      const erro: ErroLinha = {};

      if (descricao === '') erro.produto = 'Informe o produto.';
      if (quantidade === null || quantidade <= 0) erro.quantidade = 'Informe a quantidade em kg.';
      if (erro.produto || erro.quantidade) {
        erros[linha.chave] = erro;
        continue;
      }

      // Produto do catalogo quando o texto bate (sem acento/caixa/espacos); senao o backend cria o item livre.
      const chave = normalizeItemNameKey(descricao);
      const doCatalogo = (produtos.data ?? []).find((produto) => normalizeItemNameKey(produto.name) === chave);
      itens.push({
        ...(doCatalogo ? { productId: doCatalogo.id } : {}),
        description: descricao,
        quantityKg: quantidade as number,
      });
    }

    setErrosLinhas(erros);
    if (semCliente || Object.keys(erros).length > 0) return;

    salvar.mutate({ clientId: Number(clienteId), items: itens });
  }

  return (
    <Modal isOpen restoreFocus onClose={onClose} eyebrow="Origem: IQ Indent" title="Nova solicitação">
      <form onSubmit={enviar} noValidate className="indent-form">
        {erroForm && (
          <div role="alert" className="alert alert--error">
            {erroForm}
          </div>
        )}
        {clientes.isError && (
          <div role="alert" className="alert alert--error">
            Não foi possível carregar os clientes: {mensagemDoErro(clientes.error)}
          </div>
        )}

        <div className="indent-campos">
          <div className="field">
            <label className="field-label" htmlFor="ns-cliente">
              Cliente
            </label>
            <select
              id="ns-cliente"
              className="input"
              data-autofocus
              value={clienteId}
              aria-invalid={erroCliente ? true : undefined}
              onChange={(event) => setClienteEscolhido(event.target.value)}
            >
              {clientes.isLoading && <option value="">Carregando clientes…</option>}
              {opcoesCliente.map((cliente) => (
                <option key={cliente.id} value={cliente.id}>
                  {cliente.name}
                </option>
              ))}
            </select>
            {erroCliente && (
              <p className="field-error" role="alert">
                {erroCliente}
              </p>
            )}
            {!clientes.isLoading && !clientes.isError && opcoesCliente.length === 0 && (
              <span className="field-hint">Nenhum cliente ativo cadastrado.</span>
            )}
          </div>
          <div className="field">
            <span className="field-label" id="ns-responsavel-rotulo">
              Responsável
            </span>
            <div
              className="input indent-leitura"
              role="textbox"
              aria-readonly="true"
              aria-labelledby="ns-responsavel-rotulo"
            >
              {user?.name ?? '—'} (você)
            </div>
            <span className="field-hint">Preenchido automaticamente com o seu usuário.</span>
          </div>
        </div>

        <div className="indent-itens">
          <span className="field-label">Itens</span>
          {linhas.map((linha, indice) => {
            const erro = errosLinhas[linha.chave];
            return (
              <div key={linha.chave} className="indent-item-linha">
                <div className="indent-campos">
                  <div className="field">
                    <label className="field-label" htmlFor={`ns-produto-${linha.chave}`}>
                      Produto
                    </label>
                    <input
                      id={`ns-produto-${linha.chave}`}
                      className="input"
                      list="ns-catalogo"
                      placeholder="Digite ou escolha do catálogo"
                      value={linha.produto}
                      aria-invalid={erro?.produto ? true : undefined}
                      onChange={(event) => atualizar(linha.chave, 'produto', event.target.value)}
                    />
                    {erro?.produto && (
                      <p className="field-error" role="alert">
                        {erro.produto}
                      </p>
                    )}
                  </div>
                  <div className="field">
                    <label className="field-label" htmlFor={`ns-qtd-${linha.chave}`}>
                      Quantidade (kg)
                    </label>
                    <input
                      id={`ns-qtd-${linha.chave}`}
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
                {indice > 0 && (
                  <button
                    type="button"
                    className="ghost-button ghost-button--sm indent-item-remover"
                    aria-label={`Remover item ${indice + 1}`}
                    onClick={() => remover(linha.chave)}
                  >
                    <Icon name="x" size={16} />
                  </button>
                )}
              </div>
            );
          })}
          <datalist id="ns-catalogo">
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
            <button type="button" className="ghost-button ghost-button--sm" onClick={adicionar}>
              <Icon name="plus" size={15} strokeWidth={2.4} />
              Adicionar outro item
            </button>
          </div>
        </div>

        <div className="modal-actions">
          <button type="button" className="ghost-button" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="primary-button" disabled={salvar.isPending || semClientes}>
            Criar solicitação
          </button>
        </div>
      </form>
    </Modal>
  );
}
