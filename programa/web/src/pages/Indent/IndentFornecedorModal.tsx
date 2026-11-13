import { FormEvent, useId, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ApiError } from '@/api/client';
import { Modal } from '@/components/Modal';
import {
  createIndentSupplier,
  listIndentProductOptions,
  updateIndentSupplier,
  type IndentCurrency,
  type IndentIncoterm,
  type IndentSupplier,
  type IndentSupplierType,
} from '@/services/indent';

// IQ Indent: modal de fornecedor (mock openForn). Novo e editar; inclui "Produtos que fornece" (vinculo gravado junto, na mesma transacao).

const TIPOS: ReadonlyArray<{ valor: IndentSupplierType; rotulo: string }> = [
  { valor: 'FABRICANTE', rotulo: 'Fabricante' },
  { valor: 'TRADING', rotulo: 'Trading' },
  { valor: 'IMPORTADO', rotulo: 'Importado' },
];
const MOEDAS: ReadonlyArray<IndentCurrency> = ['USD', 'EUR'];
const INCOTERMS: ReadonlyArray<IndentIncoterm> = ['CFR', 'CIF', 'FOB'];

const AVISO_PARCERIA_LIGADA =
  'Ao salvar, os próximos envios e os links já enviados passam a poder mostrar o nome do cliente (na opção "Mostrar o nome do cliente" de cada envio).';
const AVISO_PARCERIA_DESLIGADA =
  'Ao salvar, os links já enviados deixam de mostrar o nome do cliente no próximo acesso, e os próximos envios saem sem esse dado.';

interface Props {
  /** null = novo fornecedor. */
  supplier: IndentSupplier | null;
  onClose: () => void;
  /** Mensagem do toast; o chamador fecha o modal e atualiza as listas. */
  onSaved: (mensagem: string) => void;
}

function messageOf(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body as { message?: unknown } | null;
    if (body && typeof body.message === 'string') return body.message;
    return err.message;
  }
  return err instanceof Error ? err.message : 'Erro desconhecido.';
}

// Sem acento, sem caixa: a busca por nome ou CAS ignora "Ácido" x "acido".
function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

function toNullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function contadorProdutos(n: number): string {
  if (n === 0) return 'Nenhum produto selecionado.';
  return n === 1 ? '1 produto selecionado.' : `${n.toLocaleString('pt-BR')} produtos selecionados.`;
}

interface LinhaProduto {
  id: number;
  nome: string;
  /** undefined = CAS desconhecido (produto inativo ja vinculado, fora de /products/options). */
  cas: string | null | undefined;
  inativo: boolean;
}

export default function IndentFornecedorModal({ supplier, onClose, onSaved }: Props) {
  const novo = supplier === null;
  const labelId = useId();
  const [nome, setNome] = useState(supplier?.name ?? '');
  const [pais, setPais] = useState(supplier?.country ?? '');
  const [contato, setContato] = useState(supplier?.contactName ?? '');
  const [tipo, setTipo] = useState<IndentSupplierType>(supplier?.type ?? 'TRADING');
  const [moeda, setMoeda] = useState<IndentCurrency>((supplier?.defaultCurrency as IndentCurrency | undefined) ?? 'USD');
  const [incoterm, setIncoterm] = useState<IndentIncoterm>((supplier?.defaultIncoterm as IndentIncoterm | undefined) ?? 'CFR');
  const [parceria, setParceria] = useState(supplier?.hasPartnership ?? false);
  const [busca, setBusca] = useState('');
  const [selecionados, setSelecionados] = useState<Set<number>>(() => new Set((supplier?.products ?? []).map((p) => p.id)));
  const [erroNome, setErroNome] = useState<string | null>(null);
  const [erroForm, setErroForm] = useState<string | null>(null);

  const opcoes = useQuery({ queryKey: ['indent', 'products', 'options'], queryFn: listIndentProductOptions });

  // Ativos (options) + os ja vinculados ao fornecedor (inclusive inativos, que ficam marcados com a tag "Inativo").
  const linhas = useMemo<LinhaProduto[]>(() => {
    const porId = new Map<number, LinhaProduto>();
    for (const produto of opcoes.data ?? []) {
      porId.set(produto.id, { id: produto.id, nome: produto.name, cas: produto.cas, inativo: !produto.isActive });
    }
    for (const produto of supplier?.products ?? []) {
      if (!porId.has(produto.id)) porId.set(produto.id, { id: produto.id, nome: produto.name, cas: undefined, inativo: !produto.isActive });
    }
    return Array.from(porId.values()).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }, [opcoes.data, supplier]);

  const termo = normalizar(busca.trim());
  const visiveis = termo ? linhas.filter((linha) => normalizar(`${linha.nome} ${linha.cas ?? ''}`).includes(termo)) : linhas;

  const salvar = useMutation({
    mutationFn: () => {
      const payload = {
        name: nome.trim(),
        country: toNullable(pais),
        contactName: toNullable(contato),
        type: tipo,
        defaultCurrency: moeda,
        defaultIncoterm: incoterm,
        hasPartnership: parceria,
        productIds: Array.from(selecionados),
      };
      return supplier ? updateIndentSupplier(supplier.id, payload) : createIndentSupplier(payload);
    },
    onSuccess: () => {
      const nomeFinal = nome.trim();
      if (novo) onSaved(`Fornecedor ${nomeFinal} cadastrado`);
      else if (parceria !== supplier.hasPartnership) onSaved(`Parceria ${parceria ? 'firmada' : 'removida'} para ${nomeFinal}`);
      else onSaved(`Cadastro de ${nomeFinal} atualizado`);
    },
    onError: (err) => setErroForm(messageOf(err)),
  });

  function enviar(event: FormEvent) {
    event.preventDefault();
    setErroForm(null);
    if (nome.trim().length === 0) {
      setErroNome('Informe a razão social.');
      return;
    }
    setErroNome(null);
    salvar.mutate();
  }

  function alternar(id: number, marcado: boolean) {
    setSelecionados((atual) => {
      const proximo = new Set(atual);
      if (marcado) proximo.add(id);
      else proximo.delete(id);
      return proximo;
    });
  }

  const mudouParceria = !novo && parceria !== supplier.hasPartnership;

  return (
    <Modal isOpen onClose={onClose} title={supplier ? supplier.name : 'Cadastro'} eyebrow={novo ? 'Novo fornecedor' : 'Editar fornecedor'}>
      <form onSubmit={enviar} noValidate className="indent-form">
        {erroForm && (
          <div role="alert" className="alert alert--error">
            {erroForm}
          </div>
        )}

        <div className="indent-campos">
          <div className="field">
            <label className="field-label" htmlFor="if-nome">
              Razão social
            </label>
            <input
              id="if-nome"
              className="input"
              data-autofocus
              value={nome}
              aria-invalid={erroNome ? true : undefined}
              onChange={(event) => setNome(event.target.value)}
            />
            {erroNome && (
              <p className="field-error" role="alert">
                {erroNome}
              </p>
            )}
          </div>
          <div className="field">
            <label className="field-label" htmlFor="if-pais">
              País
            </label>
            <input id="if-pais" className="input" value={pais} onChange={(event) => setPais(event.target.value)} />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="if-contato">
              Contato
            </label>
            <input id="if-contato" className="input" value={contato} onChange={(event) => setContato(event.target.value)} />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="if-tipo">
              Tipo
            </label>
            <select id="if-tipo" className="input" value={tipo} onChange={(event) => setTipo(event.target.value as IndentSupplierType)}>
              {TIPOS.map((item) => (
                <option key={item.valor} value={item.valor}>
                  {item.rotulo}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="if-moeda">
              Moeda padrão
            </label>
            <select id="if-moeda" className="input" value={moeda} onChange={(event) => setMoeda(event.target.value as IndentCurrency)}>
              {MOEDAS.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="if-inc">
              Incoterm padrão
            </label>
            <select id="if-inc" className="input" value={incoterm} onChange={(event) => setIncoterm(event.target.value as IndentIncoterm)}>
              {INCOTERMS.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="field">
          <span className="field-label" id={labelId}>
            Produtos que fornece
          </span>
          <input
            className="input"
            placeholder="Buscar produto por nome ou CAS"
            aria-labelledby={labelId}
            value={busca}
            onChange={(event) => setBusca(event.target.value)}
          />
          <div className="indent-produtos-caixa">
            {opcoes.isLoading && (
              <div className="indent-vazio" role="status">
                Carregando produtos…
              </div>
            )}
            {opcoes.isError && (
              <div className="indent-vazio" role="alert">
                Não foi possível carregar os produtos: {messageOf(opcoes.error)}
              </div>
            )}
            {!opcoes.isLoading && visiveis.length === 0 && <div className="indent-vazio">Nenhum produto encontrado.</div>}
            {visiveis.map((linha) => (
              <div key={linha.id} className="indent-check">
                <label>
                  <input
                    type="checkbox"
                    checked={selecionados.has(linha.id)}
                    onChange={(event) => alternar(linha.id, event.target.checked)}
                  />
                  <span>{linha.nome}</span>
                  {linha.cas !== undefined && <span className="indent-cell-sub">{linha.cas ? `CAS ${linha.cas}` : 'sem CAS'}</span>}
                  {linha.inativo && <span className="indent-tag">Inativo</span>}
                </label>
              </div>
            ))}
          </div>
          <span className="field-hint">{contadorProdutos(selecionados.size)}</span>
        </div>

        <div className="indent-parceria">
          <div>
            <strong>Parceria firmada</strong>
            <small>
              Com parceria, o nome do cliente final pode ser mostrado ao fornecedor. Sem parceria, a SQ aparece, mas nunca como compradora, e nenhum
              dado do cliente final é exibido.
            </small>
          </div>
          <label className="indent-switch">
            <span className="sr-only">Parceria firmada</span>
            <input type="checkbox" role="switch" checked={parceria} onChange={(event) => setParceria(event.target.checked)} />
            <i aria-hidden="true" />
          </label>
        </div>

        {mudouParceria && (
          <div className="alert alert--info" role="status">
            {parceria ? AVISO_PARCERIA_LIGADA : AVISO_PARCERIA_DESLIGADA}
          </div>
        )}

        <div className="modal-actions">
          <button type="button" className="ghost-button" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="primary-button" disabled={salvar.isPending}>
            Salvar
          </button>
        </div>
      </form>
    </Modal>
  );
}
