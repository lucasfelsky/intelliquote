import { useEffect, useId, useState } from 'react';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { ApiError } from '@/api/client';
import { Icon } from '@/components/icons';
import { Modal } from '@/components/Modal';
import {
  importIndentProducts,
  importIndentSuppliers,
  listIndentProductCandidates,
  listIndentSupplierCandidates,
} from '@/services/indent';

// IQ Indent: "Importar do IntelliQuote" (mock openImport). Os dados sao COPIADOS: depois de importar o cadastro do Indent nao acompanha mais o do
// IntelliQuote e nenhum vinculo fornecedor x produto e criado. A origem so e lida.

export const LIMITE_IMPORTACAO = 100;

interface Candidato {
  id: number;
  nome: string;
  detalhe: string;
  jaNoIndent: boolean;
}

interface Props {
  kind: 'produtos' | 'fornecedores';
  onClose: () => void;
  /** Mensagem do toast ("N registro(s) importado(s) do IntelliQuote, sem vínculo"). */
  onImported: (mensagem: string) => void;
}

function messageOf(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body as { message?: unknown } | null;
    if (body && typeof body.message === 'string') return body.message;
    return err.message;
  }
  return err instanceof Error ? err.message : 'Erro desconhecido.';
}

export function mensagemImportacao(criados: number): string {
  return `${criados.toLocaleString('pt-BR')} ${criados === 1 ? 'registro importado' : 'registros importados'} do IntelliQuote, sem vínculo`;
}

export default function IndentImportModal({ kind, onClose, onImported }: Props) {
  const produtos = kind === 'produtos';
  const tituloId = useId();
  const [busca, setBusca] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [escolhidos, setEscolhidos] = useState<Set<number>>(new Set());
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQ(busca.trim());
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [busca]);

  const candidatos = useQuery({
    queryKey: ['indent', 'import', kind, { q, page }],
    queryFn: async (): Promise<{ itens: Candidato[]; totalPages: number }> => {
      if (produtos) {
        const res = await listIndentProductCandidates({ q, page });
        return {
          totalPages: res.pagination.totalPages,
          itens: res.data.map((item) => ({ id: item.id, nome: item.name, detalhe: item.marketName, jaNoIndent: item.alreadyInIndent })),
        };
      }
      const res = await listIndentSupplierCandidates({ q, page });
      return {
        totalPages: res.pagination.totalPages,
        itens: res.data.map((item) => ({ id: item.id, nome: item.name, detalhe: item.country ?? '', jaNoIndent: item.alreadyInIndent })),
      };
    },
    placeholderData: keepPreviousData,
  });

  const importar = useMutation({
    mutationFn: (ids: number[]) => (produtos ? importIndentProducts(ids) : importIndentSuppliers(ids)),
    onSuccess: (resultado) => onImported(mensagemImportacao(resultado.created)),
    onError: (err) => setErro(messageOf(err)),
  });

  function alternar(id: number, marcado: boolean) {
    setEscolhidos((atual) => {
      const proximo = new Set(atual);
      if (marcado) proximo.add(id);
      else proximo.delete(id);
      return proximo;
    });
  }

  const itens = candidatos.data?.itens ?? [];
  const totalPaginas = candidatos.data?.totalPages ?? 1;
  const acimaDoLimite = escolhidos.size > LIMITE_IMPORTACAO;
  const titulo = produtos ? 'Importar produtos do IntelliQuote' : 'Importar fornecedores do IntelliQuote';

  return (
    <Modal isOpen restoreFocus onClose={onClose} title={titulo}>
      <form className="indent-form" onSubmit={(event) => event.preventDefault()} noValidate>
        <div className="alert alert--info">
          Os dados são copiados. Depois de importar, o cadastro do Indent não acompanha mais o do IntelliQuote.
        </div>

        <label className="indent-busca indent-busca--cheia">
          <Icon name="search" size={18} />
          <span className="sr-only">{produtos ? 'Buscar produto do IntelliQuote' : 'Buscar fornecedor do IntelliQuote'}</span>
          <input
            className="indent-busca__campo"
            type="search"
            data-autofocus
            placeholder={produtos ? 'Buscar por nome' : 'Buscar por razão social'}
            value={busca}
            onChange={(event) => setBusca(event.target.value)}
          />
        </label>

        {erro && (
          <div role="alert" className="alert alert--error">
            {erro}
          </div>
        )}
        {candidatos.isError && (
          <div role="alert" className="alert alert--error">
            Não foi possível carregar a lista do IntelliQuote: {messageOf(candidatos.error)}
          </div>
        )}

        <div className="indent-lista-caixa" role="group" aria-labelledby={tituloId}>
          <span id={tituloId} className="sr-only">
            {produtos ? 'Produtos do IntelliQuote' : 'Fornecedores do IntelliQuote'}
          </span>
          {candidatos.isLoading && (
            <div className="indent-vazio" role="status">
              Carregando…
            </div>
          )}
          {!candidatos.isLoading && itens.length === 0 && !candidatos.isError && (
            <div className="indent-vazio">{produtos ? 'Nenhum produto encontrado.' : 'Nenhum fornecedor encontrado.'}</div>
          )}
          {itens.map((item) => (
            <div key={item.id} className="indent-check">
              <label>
                <input
                  type="checkbox"
                  checked={!item.jaNoIndent && escolhidos.has(item.id)}
                  disabled={item.jaNoIndent}
                  onChange={(event) => alternar(item.id, event.target.checked)}
                />
                <span>{item.nome}</span>
                {item.detalhe && <span className="indent-cell-sub">{item.detalhe}</span>}
                {item.jaNoIndent && <span className="indent-tag">Já no Indent</span>}
              </label>
            </div>
          ))}
        </div>

        {totalPaginas > 1 && (
          <nav className="indent-paginacao" aria-label="Paginação da lista do IntelliQuote">
            <button type="button" className="ghost-button ghost-button--sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Anterior
            </button>
            <span className="indent-cell-sub">
              Página {page} de {totalPaginas}
            </span>
            <button
              type="button"
              className="ghost-button ghost-button--sm"
              disabled={page >= totalPaginas}
              onClick={() => setPage(page + 1)}
            >
              Próxima
            </button>
          </nav>
        )}

        {acimaDoLimite && (
          <p className="field-error" role="alert">
            Selecione no máximo {LIMITE_IMPORTACAO} registros por vez.
          </p>
        )}

        <div className="modal-actions">
          <button type="button" className="ghost-button" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={escolhidos.size === 0 || acimaDoLimite || importar.isPending}
            onClick={() => {
              setErro(null);
              importar.mutate(Array.from(escolhidos));
            }}
          >
            Importar selecionados
          </button>
        </div>
      </form>
    </Modal>
  );
}
