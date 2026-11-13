import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/auth/AuthProvider';
import { Icon } from '@/components/icons';
import type { IndentSupplierType } from '@/services/indent';
import {
  generateIndentQuotes,
  getIndentRequestSupplierOptions,
  type IndentGenerateResult,
  type IndentRequestDetail,
  type IndentRequestSupplierOption,
} from '@/services/indentRequests';
import { formatarDataHora, mensagemDoErro, primeiraPalavra } from './indentFila';

// IQ Indent: seletor de fornecedores da solicitacao (mock supplierPicker). A restricao do cliente e a cobertura vem calculadas do BACKEND
// (supplier-options) e sao RECALCULADAS no generate: aqui so se exibe. Excecao a fornecedor travado exige motivo e fica no historico.

const TIPO: Record<IndentSupplierType, string> = {
  FABRICANTE: 'Fabricante',
  TRADING: 'Trading',
  IMPORTADO: 'Importado',
};

const ERRO_MOTIVO = 'Escreva o motivo da exceção';

interface Excecao {
  motivo: string;
  por: string;
  quando: string;
}

interface Props {
  request: IndentRequestDetail;
  /** Quem escreve (admin/comprador/gestor). Viewer ve o seletor so para leitura. */
  canWrite: boolean;
  /** Chamado depois de gerar: a tela mostra o toast. */
  onGenerated: (mensagem: string) => void;
}

function pluralCotacoes(n: number): string {
  return n === 1 ? 'cotação' : 'cotações';
}

export default function IndentSupplierPicker({ request, canWrite, onGenerated }: Props) {
  const { user } = useAuth();
  const qc = useQueryClient();

  const opcoes = useQuery({
    queryKey: ['indent', 'requests', request.id, 'supplier-options'],
    queryFn: () => getIndentRequestSupplierOptions(request.id),
  });

  // Escolhas do usuario por fornecedor; sem escolha vale a pre-marcacao (permitido e cobre ao menos 1 item).
  const [escolhas, setEscolhas] = useState<Record<number, boolean>>({});
  const [excecoes, setExcecoes] = useState<Record<number, Excecao>>({});
  const [abertos, setAbertos] = useState<Record<number, boolean>>({});
  const [motivos, setMotivos] = useState<Record<number, string>>({});
  const [erroMotivo, setErroMotivo] = useState<Record<number, boolean>>({});
  const [erroGerar, setErroGerar] = useState<string | null>(null);
  const [focar, setFocar] = useState<number | null>(null);
  const motivoRefs = useRef(new Map<number, HTMLInputElement>());

  // Foco no campo de motivo logo que ele aparece (o campo so existe depois da renderizacao).
  useEffect(() => {
    if (focar === null) return;
    motivoRefs.current.get(focar)?.focus();
    setFocar(null);
  }, [focar]);

  const gerar = useMutation({
    mutationFn: (input: Parameters<typeof generateIndentQuotes>[1]) => generateIndentQuotes(request.id, input),
    onSuccess: (resultado: IndentGenerateResult) => {
      setErroGerar(null);
      void qc.invalidateQueries({ queryKey: ['indent', 'requests'] });
      const total = resultado.quotes.length;
      const nomes = resultado.quotes.map((cotacao) => primeiraPalavra(cotacao.supplierName)).join(', ');
      onGenerated(
        `${total} ${total === 1 ? 'cotação criada' : 'cotações criadas'} com o número ${resultado.processNumber}: ${nomes}`,
      );
    },
    onError: (err) => {
      setErroGerar(mensagemDoErro(err));
      // Regra ou fornecedor mudou desde que a lista foi aberta: recarrega as opcoes.
      void qc.invalidateQueries({ queryKey: ['indent', 'requests', request.id, 'supplier-options'] });
    },
  });

  const fornecedores = opcoes.data?.suppliers ?? [];
  const regra = opcoes.data?.clientRuleMode ?? request.client?.supplierRuleMode ?? 'LIVRE';

  const liberado = (opcao: IndentRequestSupplierOption) => opcao.allowed || excecoes[opcao.id] !== undefined;
  const marcado = (opcao: IndentRequestSupplierOption) =>
    liberado(opcao) && (escolhas[opcao.id] ?? (opcao.allowed && opcao.coverage.covered > 0));

  const escolhidos = fornecedores.filter(marcado);
  const comExcecao = escolhidos.filter((opcao) => !opcao.allowed && excecoes[opcao.id] !== undefined);

  function liberarExcecao(id: number) {
    setAbertos((atual) => ({ ...atual, [id]: true }));
    setFocar(id);
  }

  function confirmarExcecao(id: number) {
    const motivo = (motivos[id] ?? '').trim();
    if (motivo === '') {
      setErroMotivo((atual) => ({ ...atual, [id]: true }));
      motivoRefs.current.get(id)?.focus();
      return;
    }
    setErroMotivo((atual) => ({ ...atual, [id]: false }));
    setExcecoes((atual) => ({
      ...atual,
      [id]: { motivo, por: user?.name ?? '', quando: formatarDataHora(new Date()) },
    }));
    setEscolhas((atual) => ({ ...atual, [id]: true }));
    setAbertos((atual) => ({ ...atual, [id]: false }));
  }

  function enviar() {
    setErroGerar(null);
    gerar.mutate({
      suppliers: escolhidos.map((opcao) => {
        const excecao = excecoes[opcao.id];
        return !opcao.allowed && excecao
          ? { supplierId: opcao.id, exceptionReason: excecao.motivo }
          : { supplierId: opcao.id };
      }),
    });
  }

  if (opcoes.isLoading) {
    return (
      <p className="indent-cell-sub" role="status">
        Carregando fornecedores…
      </p>
    );
  }

  if (opcoes.isError) {
    return (
      <div role="alert" className="alert alert--error">
        Não foi possível carregar os fornecedores: {mensagemDoErro(opcoes.error)}
      </div>
    );
  }

  return (
    <div className="indent-pilha">
      {comExcecao.length > 0 && (
        <div role="alert" className="indent-excbanner">
          <Icon name="lock" size={22} strokeWidth={2.2} />
          <div>
            <strong>
              Atenção: {comExcecao.length} {comExcecao.length === 1 ? 'fornecedor' : 'fornecedores'} fora da regra deste cliente
            </strong>
            <span>Estas cotações serão marcadas com EXCEÇÃO em toda a tela e no histórico.</span>
          </div>
        </div>
      )}

      {erroGerar && (
        <div role="alert" className="alert alert--error">
          {erroGerar}
        </div>
      )}

      <div className="indent-pilha">
        {fornecedores.length === 0 && <div className="indent-vazio">Nenhum fornecedor ativo cadastrado.</div>}
        {fornecedores.map((opcao) => {
          const excecao = excecoes[opcao.id];
          const ok = liberado(opcao);
          const ligado = marcado(opcao);
          const { covered, total } = opcao.coverage;
          const travado = !opcao.allowed && !excecao;
          const classe = `indent-sup${ligado ? ' is-on' : ''}${!ok ? ' is-blocked' : ''}${excecao ? ' is-exc' : ''}`;

          return (
            <div key={opcao.id} className={classe}>
              <input
                type="checkbox"
                id={`ind-sup-${opcao.id}`}
                checked={ligado}
                disabled={!ok || !canWrite}
                onChange={(event) => setEscolhas((atual) => ({ ...atual, [opcao.id]: event.target.checked }))}
              />
              <label htmlFor={`ind-sup-${opcao.id}`} className="indent-cell-main">
                <span className="indent-sup__nome">{opcao.name}</span>
                <span className="indent-cell-sub">
                  {opcao.country ?? '—'} · {TIPO[opcao.type]}
                </span>
              </label>
              <span className="indent-sup__direita">
                <span className={`indent-tag${covered === total ? ' indent-tag--ok' : ''}`}>
                  Cobre {covered} de {total} {total > 1 ? 'itens' : 'item'}
                </span>
                {travado && canWrite && !abertos[opcao.id] && (
                  <button type="button" className="indent-linkbtn" onClick={() => liberarExcecao(opcao.id)}>
                    Liberar exceção
                  </button>
                )}
              </span>
              {(travado || excecao || (regra === 'APROVADOS' && opcao.approvedByClient)) && (
                <span className="indent-sup__nota">
                  {travado && (
                    <>
                      <span className="indent-tag indent-tag--lock">
                        <Icon name="lock" size={11} strokeWidth={2.2} />
                        {opcao.blockedReason}
                      </span>
                      {canWrite && abertos[opcao.id] && (
                        <span className="indent-sup__motivo">
                          <label className="sr-only" htmlFor={`ind-mot-${opcao.id}`}>
                            Motivo da exceção
                          </label>
                          <input
                            id={`ind-mot-${opcao.id}`}
                            ref={(el) => {
                              if (el) motivoRefs.current.set(opcao.id, el);
                              else motivoRefs.current.delete(opcao.id);
                            }}
                            className="input"
                            placeholder="Motivo (fica no histórico)"
                            value={motivos[opcao.id] ?? ''}
                            aria-invalid={erroMotivo[opcao.id] ? true : undefined}
                            aria-describedby={erroMotivo[opcao.id] ? `ind-mot-erro-${opcao.id}` : undefined}
                            onChange={(event) => setMotivos((atual) => ({ ...atual, [opcao.id]: event.target.value }))}
                          />
                          <button
                            type="button"
                            className="ghost-button"
                            onClick={() => confirmarExcecao(opcao.id)}
                          >
                            Confirmar exceção
                          </button>
                          {erroMotivo[opcao.id] && (
                            <span id={`ind-mot-erro-${opcao.id}`} className="field-error" role="alert">
                              {ERRO_MOTIVO}
                            </span>
                          )}
                        </span>
                      )}
                    </>
                  )}
                  {excecao && (
                    <>
                      <span className="indent-tag indent-tag--exc">
                        <Icon name="lock" size={11} strokeWidth={2.4} />
                        Exceção à restrição do cliente
                      </span>
                      <span>
                        <b>Motivo:</b> {excecao.motivo} · liberada por {excecao.por} em {excecao.quando}
                      </span>
                    </>
                  )}
                  {!travado && !excecao && regra === 'APROVADOS' && opcao.approvedByClient && (
                    <span className="indent-tag indent-tag--ok">
                      <Icon name="check" size={11} strokeWidth={2.6} />
                      Aprovado pelo cliente
                    </span>
                  )}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {canWrite && (
        <div className="indent-gerar">
          <div className="indent-cell-main">
            <strong>
              {escolhidos.length > 0
                ? 'Uma cotação por fornecedor, todas com o mesmo número de processo'
                : 'Escolha ao menos um fornecedor'}
            </strong>
            <div className="indent-gerar__refs">
              {escolhidos.length > 0 && (
                <>
                  <span className="indent-ref indent-ref--indent">{request.processNumber}</span>
                  <span className="indent-cell-sub">
                    {escolhidos.length === 1 ? 'em 1 cotação' : `em todas as ${escolhidos.length} cotações`}
                  </span>
                </>
              )}
            </div>
            <span className="indent-cell-sub">
              Todas as cotações usam o número da solicitação; o fornecedor diferencia uma da outra.
            </span>
          </div>
          <button
            type="button"
            className="primary-button"
            disabled={escolhidos.length === 0 || gerar.isPending}
            onClick={enviar}
          >
            <Icon name="send" size={16} />
            Gerar {escolhidos.length} {pluralCotacoes(escolhidos.length)}
          </button>
        </div>
      )}
    </div>
  );
}
