import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  forecastPendentesErrorMessage,
  forecastPendentesKeys,
  getForecastPendentes,
  type ForecastPendente,
  type ForecastPendentesResumo,
} from '@/services/forecastPendentes';
import ForecastCompletarCadastroModal, { type ResultadoCadastro } from './ForecastCompletarCadastroModal';
import { inteiroBr } from './forecastPainel';
import {
  contagemTexto,
  mensagemCadastroGravado,
  situacaoTexto,
  soSaldoTexto,
  TEXTO_REATIVACAO_INDISPONIVEL,
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
  /** Quem completa (admin/comprador) ve a coluna Acao; os demais so leem. */
  podeCompletar: boolean;
  onCompletar?: (codigo: string, gatilho: HTMLElement) => void;
  legenda: string;
}

/** Tabela dos codigos pendentes (painel da quinzena e pre-visualizacao do import). Quantidades em kg. */
export function TabelaPendentes({ itens, omitidos, soSaldo, podeCompletar, onCompletar, legenda }: TabelaProps) {
  const mostrarSaldo = itens.some((p) => p.saldo !== 0);
  const comAcao = podeCompletar && onCompletar !== undefined;
  const temInativo = itens.some((p) => p.situacao === 'produto_inativo');
  const saldoTexto = soSaldoTexto(soSaldo, inteiroBr);
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
                Vendas mês ant.
              </th>
              <th scope="col" className="fcp-num">
                Vendas mês atual
              </th>
              <th scope="col" className="fcp-num">
                Vendas anual
              </th>
              <th scope="col" className="fcp-num">
                Programação
              </th>
              <th scope="col" className="fcp-num">
                Chegadas
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
                <td className="fcp-num">{numero(p.vendasMes)}</td>
                <td className="fcp-num">{numero(p.vendasAtual)}</td>
                <td className="fcp-num">{numero(p.vendasAnual)}</td>
                <td className="fcp-num">{numero(p.programacao)}</td>
                <td className="fcp-num">{numero(p.chegadas)}</td>
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
      {omitidos > 0 && (
        <p className="fcp-nota">… e mais {contagemTexto(omitidos, 'código', 'códigos')} (lista cortada nos primeiros itens).</p>
      )}
      {saldoTexto && <p className="fcp-nota">{saldoTexto}</p>}
      {temInativo && (
        <p className="fcp-nota">
          {textoProdutoInativo(null)} {TEXTO_REATIVACAO_INDISPONIVEL}
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
  const [mensagem, setMensagem] = useState('');
  const statusRef = useRef<HTMLDivElement>(null);
  const dialogo = useDialogoCompletar((resultado) => setMensagem(mensagemCadastroGravado(resultado)));

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
        <p className="fcp-estado">Pendentes de cadastro: nenhum código fora do cadastro nesta quinzena.</p>
      </section>
    );
  }

  return (
    <section className="fcp" aria-label="Pendentes de cadastro">
      {status}
      <details className="fc-card fcp__detalhes">
        <summary>
          Pendentes de cadastro ({inteiroBr(dados.totalItens)})
          <span className="fcp__resumo"> · ficam fora do cálculo</span>
        </summary>
        <div className="fcp__corpo">
          <p className="fcp-nota">{textoEntradaNoCalculo(label)}</p>
          <TabelaPendentes
            itens={dados.itens}
            omitidos={dados.omitidos}
            soSaldo={dados.soSaldo}
            podeCompletar={podeEditar}
            onCompletar={dialogo.abrir}
            legenda={`Códigos pendentes de cadastro da quinzena ${label}`}
          />
        </div>
      </details>
      {dialogo.renderizar(inativosDosPendentes(dados.itens))}
    </section>
  );
}
