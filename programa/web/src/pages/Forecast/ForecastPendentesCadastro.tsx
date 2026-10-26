import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  forecastPendentesErrorMessage,
  forecastPendentesKeys,
  getForecastPendentes,
  postForecastReativarProduto,
  type ForecastPendente,
  type ForecastPendentesResumo,
} from '@/services/forecastPendentes';
import ForecastCompletarCadastroModal, { type ResultadoCadastro } from './ForecastCompletarCadastroModal';
import { inteiroBr } from './forecastPainel';
import {
  contagemTexto,
  criterioTexto,
  historicoAusenteTexto,
  mensagemCadastroGravado,
  mensagemProdutoReativado,
  nenhumPendenteTexto,
  semVendaRecenteTexto,
  situacaoTexto,
  soSaldoTexto,
  TEXTO_REATIVACAO_INDISPONIVEL,
  TEXTO_REATIVACAO_NO_PAINEL,
  textoEntradaNoCalculo,
  textoProdutoInativo,
} from './forecastPendentes';

const numero = (v: number): string => (v === 0 ? '—' : inteiroBr(v));

/** codigo -> nome do produto inativo, para o formulario avisar antes do 409 do backend. */
export function inativosDosPendentes(itens: readonly ForecastPendente[]): Record<string, string> {
  return Object.fromEntries(
    itens.filter((p) => p.situacao === 'produto_inativo' && p.produtoInativo).map((p) => [p.codigo, p.produtoInativo!.nome]),
  );
}

interface TabelaProps {
  itens: readonly ForecastPendente[];
  omitidos: number;
  soSaldo: ForecastPendentesResumo['soSaldo'];
  /** Criterio e contagens fora da lista (regra do COMEX); ausentes em backend antigo. */
  regra?: ForecastPendentesResumo['regra'];
  semVendaRecente?: ForecastPendentesResumo['semVendaRecente'];
  /** Quem completa (admin/comprador) ve a coluna Acao; os demais so leem. */
  podeCompletar: boolean;
  onCompletar?: (codigo: string, gatilho: HTMLElement) => void;
  /** So o painel da quinzena passa: com ele a linha de produto inativo ganha o botao "Reativar produto". */
  onReativar?: (productId: number, nome: string) => void;
  /** Produto cuja reativacao esta gravando (o botao fica desabilitado). */
  reativandoId?: number | null;
  legenda: string;
}

/** Tabela dos codigos pendentes (painel da quinzena e pre-visualizacao do import). Quantidades em kg. */
export function TabelaPendentes({
  itens,
  omitidos,
  soSaldo,
  regra,
  semVendaRecente,
  podeCompletar,
  onCompletar,
  onReativar,
  reativandoId = null,
  legenda,
}: TabelaProps) {
  const mostrarSaldo = itens.some((p) => p.saldo !== 0);
  const comAcao = podeCompletar && onCompletar !== undefined;
  const temInativo = itens.some((p) => p.situacao === 'produto_inativo');
  const saldoTexto = soSaldoTexto(soSaldo, inteiroBr);
  const criterio = criterioTexto(regra);
  const semVendaTexto = semVendaRecenteTexto(semVendaRecente, inteiroBr);
  const historicoTexto = historicoAusenteTexto(regra);
  return (
    <>
      <div className="fcp-scroll" role="region" tabIndex={0} aria-label={legenda}>
        <table className="fcp-tabela">
          <caption className="sr-only">{legenda}. Quantidades em kg.</caption>
          <thead>
            <tr>
              <th scope="col">Código</th>
              <th scope="col">Situação</th>
              <th scope="col" className="fcp-num">
                Vendas 3 meses
              </th>
              <th scope="col" className="fcp-num">
                Vendas mês atual
              </th>
              <th scope="col" className="fcp-num">
                Programação
              </th>
              <th scope="col" className="fcp-num">
                Compras em aberto (FUP)
              </th>
              {mostrarSaldo && (
                <th scope="col" className="fcp-num">
                  Saldo
                </th>
              )}
              {comAcao && (
                <th scope="col" className="fcp-acao">
                  Ação
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {itens.map((p) => (
              <tr key={p.codigo}>
                <th scope="row">{p.codigo}</th>
                <td>
                  <span className={p.situacao === 'produto_inativo' ? 'badge badge--muted' : 'badge badge--info'}>
                    {situacaoTexto(p)}
                  </span>
                  {p.situacao === 'produto_inativo' && p.produtoInativo && (
                    <span className="fcp-produto-inativo">{p.produtoInativo.nome}</span>
                  )}
                </td>
                <td className="fcp-num">{numero(p.vendas3Meses ?? p.vendasMes)}</td>
                <td className="fcp-num">{numero(p.vendasAtual)}</td>
                <td className="fcp-num">{numero(p.programacao)}</td>
                <td className="fcp-num">{numero(p.comprasEmAberto ?? p.chegadas)}</td>
                {mostrarSaldo && <td className="fcp-num">{numero(p.saldo)}</td>}
                {comAcao && (
                  <td className="fcp-acao">
                    {p.situacao === 'sem_cadastro' ? (
                      <button
                        type="button"
                        className="ghost-button ghost-button--sm"
                        aria-label={`Completar cadastro do código ${p.codigo}`}
                        onClick={(e) => onCompletar?.(p.codigo, e.currentTarget)}
                      >
                        Completar cadastro
                      </button>
                    ) : onReativar && p.produtoInativo ? (
                      <button
                        type="button"
                        className="ghost-button ghost-button--sm"
                        aria-label={`Reativar produto ${p.produtoInativo.nome} (código ${p.codigo})`}
                        disabled={reativandoId !== null}
                        aria-busy={reativandoId === p.produtoInativo.id ? true : undefined}
                        onClick={() => onReativar(p.produtoInativo!.id, p.produtoInativo!.nome)}
                      >
                        Reativar produto
                      </button>
                    ) : (
                      <span className="fcp-nota">Reativar o produto</span>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {criterio && <p className="fcp-nota">{criterio}</p>}
      {omitidos > 0 && (
        <p className="fcp-nota">… e mais {contagemTexto(omitidos, 'código', 'códigos')} (lista cortada nos primeiros itens).</p>
      )}
      {semVendaTexto && <p className="fcp-nota">{semVendaTexto}</p>}
      {saldoTexto && <p className="fcp-nota">{saldoTexto}</p>}
      {historicoTexto && <p className="fcp-nota">{historicoTexto}</p>}
      {temInativo && (
        <p className="fcp-nota">
          {textoProdutoInativo(null)} {onReativar ? TEXTO_REATIVACAO_NO_PAINEL : TEXTO_REATIVACAO_INDISPONIVEL}
        </p>
      )}
    </>
  );
}

/**
 * Abre o dialogo "Completar cadastro" e cuida do foco: Esc/Cancelar devolve o foco ao botao que abriu; depois de
 * gravar, o chamador leva o foco para a mensagem de retorno (o botao some quando o codigo sai da lista).
 */
export function useDialogoCompletar(aoConcluir: (resultado: ResultadoCadastro) => void) {
  const [codigo, setCodigo] = useState<string | null>(null);
  const gatilho = useRef<HTMLElement | null>(null);
  const aberto = useRef(false);
  const concluiu = useRef(false);

  useEffect(() => {
    if (codigo !== null) {
      aberto.current = true;
      return;
    }
    if (aberto.current) {
      aberto.current = false;
      if (!concluiu.current && gatilho.current?.isConnected) gatilho.current.focus();
    }
  }, [codigo]);

  return {
    aberto: codigo !== null,
    abrir: (c: string, el: HTMLElement) => {
      gatilho.current = el;
      concluiu.current = false;
      setCodigo(c);
    },
    renderizar: (inativos?: Readonly<Record<string, string>>) =>
      codigo === null ? null : (
        <ForecastCompletarCadastroModal
          codigo={codigo}
          inativos={inativos}
          onFechar={() => setCodigo(null)}
          onConcluido={(resultado) => {
            concluiu.current = true;
            setCodigo(null);
            aoConcluir(resultado);
          }}
        />
      ),
  };
}

interface Props {
  snapshotId: number;
  label: string;
  /** admin/comprador completam; os demais papeis COMEX so veem a lista. */
  podeEditar: boolean;
}

/** Pendentes de cadastro da quinzena DBCorp (codigos do DBCorp fora do cadastro, hoje FORA do calculo). */
export default function ForecastPendentesCadastro({ snapshotId, label, podeEditar }: Props) {
  const consulta = useQuery({
    queryKey: forecastPendentesKeys.snapshot(snapshotId),
    queryFn: () => getForecastPendentes(snapshotId),
    staleTime: 30_000,
  });
  const queryClient = useQueryClient();
  const [mensagem, setMensagem] = useState('');
  const [erroReativar, setErroReativar] = useState('');
  const statusRef = useRef<HTMLDivElement>(null);
  const dialogo = useDialogoCompletar((resultado) => setMensagem(mensagemCadastroGravado(resultado)));
  const reativar = useMutation({
    gcTime: 0,
    mutationFn: (entrada: { productId: number; nome: string }) => postForecastReativarProduto(entrada.productId),
    onSuccess: (resultado) => {
      setErroReativar('');
      setMensagem(mensagemProdutoReativado(resultado));
      // Os pendentes sao recalculados na leitura com o cadastro atual: o codigo sai da lista.
      void queryClient.invalidateQueries({ queryKey: ['forecast'] });
    },
    onError: (err) => {
      setMensagem('');
      setErroReativar(forecastPendentesErrorMessage(err, 'Não foi possível reativar o produto'));
    },
  });

  // Depois de gravar, o foco vai para a mensagem (o botao do codigo some da lista).
  useEffect(() => {
    if (mensagem) statusRef.current?.focus();
  }, [mensagem]);

  const dados = consulta.data;
  const status = mensagem ? (
    <div ref={statusRef} className="alert alert--success" role="status" tabIndex={-1}>
      {mensagem}
    </div>
  ) : null;
  const alertaReativar = erroReativar ? (
    <div className="alert alert--error" role="alert">
      {erroReativar}
    </div>
  ) : null;

  if (consulta.isLoading) {
    return (
      <p className="fcp-estado" role="status">
        Carregando pendentes de cadastro…
      </p>
    );
  }
  if (consulta.isError) {
    return (
      <div className="alert alert--error fcp-erro" role="alert">
        <p className="fcp-erro__texto">{forecastPendentesErrorMessage(consulta.error, 'Não foi possível carregar os pendentes de cadastro')}</p>
        <button type="button" className="ghost-button ghost-button--sm" onClick={() => void consulta.refetch()}>
          Tentar de novo
        </button>
      </div>
    );
  }
  if (!dados || !dados.aplicavel) return null;

  if (dados.totalItens === 0) {
    return (
      <section className="fcp" aria-label="Pendentes de cadastro">
        {status}
        {alertaReativar}
        <p className="fcp-estado">{nenhumPendenteTexto(dados.regra)}</p>
        {[semVendaRecenteTexto(dados.semVendaRecente, inteiroBr), historicoAusenteTexto(dados.regra)].map(
          (nota) => nota && <p key={nota} className="fcp-nota">{nota}</p>,
        )}
      </section>
    );
  }

  return (
    <section className="fcp" aria-label="Pendentes de cadastro">
      {status}
      {alertaReativar}
      <details className="fc-card fcp__detalhes">
        <summary>
          Pendentes de cadastro ({inteiroBr(dados.totalItens)})
          <span className="fcp__resumo"> · ficam fora do cálculo</span>
        </summary>
        <div className="fcp__corpo">
          <p className="fcp-nota">{textoEntradaNoCalculo(label, dados.totalItens)}</p>
          <TabelaPendentes
            itens={dados.itens}
            omitidos={dados.omitidos}
            soSaldo={dados.soSaldo}
            regra={dados.regra}
            semVendaRecente={dados.semVendaRecente}
            podeCompletar={podeEditar}
            onCompletar={dialogo.abrir}
            onReativar={(productId, nome) => {
              setErroReativar('');
              setMensagem('');
              reativar.mutate({ productId, nome });
            }}
            reativandoId={reativar.isPending ? reativar.variables.productId : null}
            legenda={`Códigos pendentes de cadastro da quinzena ${label}`}
          />
        </div>
      </details>
      {dialogo.renderizar(inativosDosPendentes(dados.itens))}
    </section>
  );
}
