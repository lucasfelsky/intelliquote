import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { Icon } from '@/components/icons';
import { ForecastToast, useToastForecast } from '@/pages/Forecast/ForecastToast';
import {
  getIndentPipedriveOptions,
  getIndentPipedriveStatus,
  saveIndentPipedriveConfig,
  syncIndentPipedrive,
  type IndentPipedriveConfigInput,
  type IndentPipedriveStatus,
  type IndentPipedriveSyncResult,
} from '@/services/indentPipedrive';
import { formatarHora, formatarQuando, mensagemDoErro } from './indentFila';
import IndentIntegracaoFila from './IndentIntegracaoFila';

// IQ Indent: Integracao Pipedrive (mock v14, viewIntegracao). O IQ so LE o Pipedrive (sentido unico Pipedrive -> IQ Indent); esta tela
// mostra o estado da conexao, deixa o admin escolher funil, coluna de origem e prazo interno, explica o mapeamento dos campos e traz a
// fila de vinculo de cliente (IndentIntegracaoFila). Estado, opcoes e regras sao do BACKEND: aqui so se exibe.
// Divergencias conscientes do mock (decisao 32 do plano): sem a linha "Anexos"; "Consulta automatica" no lugar de "Webhook ativo" enquanto
// nao ha webhook; estados de conexao alem de "Conectado"; selects salvam ao mudar; colunas reais do funil; sem o aside "Sugestoes".

const ESCRITA = ['admin', 'comprador', 'gestor'];
const PRAZOS = [1, 2, 3];
const CHAVE_STATUS = ['indent', 'pipedrive', 'status'] as const;

const SEM_CONFIGURACAO = 'Integração não configurada';

type TomConexao = 'ok' | 'aviso' | 'erro' | 'neutro';

interface Conexao {
  titulo: string;
  sub: string;
  tom: TomConexao;
}

function plural(n: number, singular: string, pluralTexto: string): string {
  return `${n.toLocaleString('pt-BR')} ${n === 1 ? singular : pluralTexto}`;
}

function rotuloPrazo(dias: number): string {
  return dias === 1 ? '1 dia útil' : `${dias} dias úteis`;
}

/** Linha da conexao (.conn do mock): titulo + subtitulo + tom do ponto. Cada estado do backend tem a sua frase. */
function descreverConexao(status: IndentPipedriveStatus): Conexao {
  switch (status.connection) {
    case 'ok': {
      const sub = status.lastSyncAt
        ? `Última sincronização ${formatarQuando(status.lastSyncAt)} · ${plural(status.lastSyncNewDeals, 'negócio novo', 'negócios novos')} · ${plural(status.lastSyncErrors, 'erro', 'erros')}`
        : 'Nenhuma sincronização ainda.';
      return { titulo: 'Conectado ao Pipedrive', sub, tom: 'ok' };
    }
    case 'auth_failed':
      return { titulo: 'Falha de autenticação no Pipedrive', sub: 'O token pode ter sido trocado ou revogado. Avise o administrador.', tom: 'erro' };
    case 'rate_limited':
      return { titulo: 'Limite de chamadas atingido', sub: 'O Pipedrive pediu uma pausa. Tente sincronizar de novo em alguns minutos.', tom: 'aviso' };
    case 'budget_low':
      return { titulo: 'Orçamento diário de chamadas quase no fim', sub: 'As sincronizações voltam quando o orçamento diário for renovado.', tom: 'aviso' };
    case 'config_mismatch':
      return { titulo: 'Funil ou coluna não conferem com o Pipedrive', sub: 'Nada é sincronizado até o administrador revisar o funil e a coluna de origem.', tom: 'erro' };
    case 'error':
      return { titulo: 'Falha na última sincronização', sub: 'O Pipedrive não respondeu como esperado. Tente sincronizar de novo em alguns minutos.', tom: 'erro' };
    default:
      return { titulo: SEM_CONFIGURACAO, sub: 'A conexão com o Pipedrive ainda não foi configurada. Avise o administrador.', tom: 'neutro' };
  }
}

/** Respostas do proprio backend (409/429/502) trazem `message` no corpo; timeout do Hosting (504), HTML ou queda de rede nao. */
function respostaDoServidor(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  const corpo = err.body as { message?: unknown; contentType?: unknown } | null;
  return corpo !== null && typeof corpo === 'object' && typeof corpo.message === 'string' && corpo.contentType === undefined;
}

interface AvisoSync {
  tom: 'erro' | 'aviso' | 'info';
  texto: string;
}

export default function IndentIntegracao() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const papel = user?.role ?? '';
  const canWrite = ESCRITA.includes(papel);
  const isAdmin = papel === 'admin';
  const { toast, mostrar, fechar } = useToastForecast();

  const [sincronizando, setSincronizando] = useState(false);
  const [avisoSync, setAvisoSync] = useState<AvisoSync | null>(null);
  const [funilRascunho, setFunilRascunho] = useState<number | null>(null);
  const [erroConfig, setErroConfig] = useState<string | null>(null);

  const estado = useQuery({ queryKey: CHAVE_STATUS, queryFn: getIndentPipedriveStatus });
  const status = estado.data;

  // Opcoes ao vivo so para o admin (a rota e so dele): funis e as colunas do funil escolhido.
  const opcoes = useQuery({
    queryKey: ['indent', 'pipedrive', 'options', funilRascunho],
    queryFn: () => getIndentPipedriveOptions(funilRascunho ?? undefined),
    enabled: isAdmin,
    retry: false,
    // Trocar o funil busca as colunas do novo: os selects nao piscam vazios enquanto isso.
    placeholderData: keepPreviousData,
  });

  const configurado = status?.configured === true;
  const prazoAtual = status?.slaBusinessDays ?? 2;
  const funilEfetivo = funilRascunho ?? status?.pipelineId ?? null;
  const funilMudou = funilRascunho !== null && funilRascunho !== (status?.pipelineId ?? null);
  const colunaSelecionada = funilMudou ? '' : String(status?.stageId ?? '');

  const salvar = useMutation({
    mutationFn: (input: IndentPipedriveConfigInput) => saveIndentPipedriveConfig(input),
    onSuccess: (novoEstado) => {
      qc.setQueryData(CHAVE_STATUS, novoEstado);
      setFunilRascunho(null);
      setErroConfig(null);
      void qc.invalidateQueries({ queryKey: ['indent', 'pipedrive', 'options'] });
      mostrar('salvo', 'Configuração da integração salva', '');
    },
    onError: (err) => setErroConfig(mensagemDoErro(err)),
  });

  function trocarFunil(valor: string) {
    setErroConfig(null);
    const id = Number(valor);
    if (!Number.isInteger(id) || id <= 0) return;
    // Volta ao funil ja salvo: nada a salvar. Funil novo: a coluna tem de ser escolhida (nada e salvo sem ela).
    setFunilRascunho(id === status?.pipelineId ? null : id);
  }

  function trocarColuna(valor: string) {
    const id = Number(valor);
    if (funilEfetivo === null || !Number.isInteger(id) || id <= 0) return;
    salvar.mutate({ pipelineId: funilEfetivo, stageId: id });
  }

  function trocarPrazo(valor: string) {
    const dias = Number(valor);
    // O prazo salva com o funil e a coluna JA gravados (um funil novo ainda sem coluna nao entra).
    if (status?.pipelineId == null || status.stageId == null || !PRAZOS.includes(dias)) return;
    salvar.mutate({ pipelineId: status.pipelineId, stageId: status.stageId, slaBusinessDays: dias });
  }

  function avisarSucesso(resultado: IndentPipedriveSyncResult, antes: string | null) {
    const novos = resultado.created;
    const titulo =
      novos === 0
        ? `Pipedrive sincronizado: nenhum negócio novo${antes ? ` desde ${formatarHora(antes)}` : ''}`
        : `Pipedrive sincronizado: ${plural(novos, 'negócio novo', 'negócios novos')}`;
    const detalhes: string[] = [];
    if (resultado.errors > 0) detalhes.push(plural(resultado.errors, 'negócio com erro', 'negócios com erro'));
    if (resultado.missed > 0) detalhes.push(`${plural(resultado.missed, 'negócio ficou', 'negócios ficaram')} para a próxima execução`);
    mostrar('salvo', titulo, detalhes.join(' · '));
  }

  // "Sincronizar agora" segura a requisicao ate ~50 s e o rewrite do Hosting corta em 60 s: sem resposta do backend (timeout, HTML ou
  // rede) o resultado e conferido reconsultando o estado, que a varredura grava mesmo quando a resposta se perde.
  async function reconsultar(antes: string | null) {
    try {
      const atual = await qc.fetchQuery({ queryKey: CHAVE_STATUS, queryFn: getIndentPipedriveStatus, staleTime: 0 });
      if (atual.lastSyncAt !== null && atual.lastSyncAt !== antes) {
        avisarSucesso({ outcome: 'run_ok', processed: 0, created: atual.lastSyncNewDeals, errors: atual.lastSyncErrors, missed: 0, durationMs: 0 }, antes);
      } else {
        setAvisoSync({
          tom: 'info',
          texto: 'A resposta demorou mais que o esperado e a sincronização pode ainda estar em andamento. O estado da integração foi atualizado; confira a última sincronização.',
        });
      }
    } catch {
      setAvisoSync({ tom: 'aviso', texto: 'Não foi possível confirmar o resultado da sincronização. Atualize a página para ver o estado da integração.' });
    }
  }

  async function sincronizar() {
    // aria-disabled (e nao disabled) enquanto roda: o foco fica no botao.
    if (sincronizando) return;
    setSincronizando(true);
    setAvisoSync(null);
    const antes = status?.lastSyncAt ?? null;
    try {
      avisarSucesso(await syncIndentPipedrive(), antes);
    } catch (err) {
      if (respostaDoServidor(err)) {
        const http = err instanceof ApiError ? err.status : 0;
        setAvisoSync({ tom: http === 409 || http === 429 ? 'aviso' : 'erro', texto: mensagemDoErro(err) });
      } else {
        await reconsultar(antes);
      }
    } finally {
      setSincronizando(false);
      void qc.invalidateQueries({ queryKey: ['indent'] });
    }
  }

  const conexao = status ? descreverConexao(status) : null;
  const podeSincronizar = canWrite && configurado;
  const tokensRestantes = status?.dailyTokensRemaining ?? null;
  const tokensLimite = status?.dailyTokensLimit ?? null;

  // Funis e colunas: o admin recebe as opcoes ao vivo; os demais so veem o valor salvo (select desabilitado).
  const funis = opcoes.data?.pipelines ?? [];
  const funisLista =
    funilEfetivo !== null && !funis.some((funil) => funil.id === funilEfetivo)
      ? [{ id: funilEfetivo, name: status?.pipelineName ?? `Funil #${funilEfetivo}` }, ...funis]
      : funis;
  const colunas = (opcoes.data?.stages ?? []).filter((coluna) => funilEfetivo === null || coluna.pipelineId === funilEfetivo);
  const colunasLista =
    !funilMudou && status?.stageId != null && !colunas.some((coluna) => coluna.id === status.stageId)
      ? [{ id: status.stageId, name: status.stageName ?? `Coluna #${status.stageId}`, pipelineId: funilEfetivo ?? 0 }, ...colunas]
      : colunas;
  const edita = isAdmin && opcoes.data !== undefined;

  const mapeamento: ReadonlyArray<{ campo: string; destino: string; nota: string }> = [
    { campo: 'Organização', destino: 'Cliente', nota: 'Casa pelo CNPJ da organização; sem correspondência vai para a fila' },
    {
      campo: 'Título do negócio',
      destino: 'Número do processo (NNN/AA)',
      nota: 'Ex.: “274/26 INDENT - CLIENTE”. Prefixo “R2 -” indica revisão. Sem número, pede digitação',
    },
    {
      campo: 'Anotações do negócio',
      destino: 'Itens da solicitação',
      nota: 'Pedido vem em texto livre; o sistema propõe os itens e o usuário confirma. Sem casamento no catálogo vira item livre',
    },
    { campo: 'Proprietário', destino: 'Responsável', nota: '' },
    {
      campo: 'Entrada na coluna',
      destino: 'Tempo na fila',
      nota: `Prazo interno de resposta de ${rotuloPrazo(prazoAtual)}; a data prevista de fechamento do negócio não é usada`,
    },
    { campo: 'Tipo de negócio', destino: 'Tipo de negócio', nota: 'Ex.: Contratipo' },
  ];

  return (
    <div className="page indent-page indent-integracao-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Administração</p>
          <h1>Integração Pipedrive</h1>
          <p className="page-subtitle">
            Conexão com o CRM da empresa para puxar as solicitações de cotação indent. Somente leitura.
          </p>
        </div>
        <div className="page-header__actions">
          <button
            type="button"
            className="primary-button"
            disabled={!podeSincronizar}
            aria-disabled={sincronizando ? true : undefined}
            aria-busy={sincronizando ? true : undefined}
            onClick={() => void sincronizar()}
          >
            <Icon name="refresh" size={16} />
            {sincronizando ? 'Sincronizando…' : 'Sincronizar agora'}
          </button>
        </div>
      </header>

      {avisoSync && (
        <div role={avisoSync.tom === 'info' ? 'status' : 'alert'} className={`alert alert--${avisoSync.tom === 'erro' ? 'error' : avisoSync.tom === 'aviso' ? 'warning' : 'info'}`}>
          {avisoSync.texto}
        </div>
      )}

      {estado.isError && (
        <div role="alert" className="alert alert--error">
          Não foi possível carregar o estado da integração: {mensagemDoErro(estado.error)}
        </div>
      )}

      <section className="indent-painel" aria-label="Conexão com o Pipedrive">
        <div className="indent-conn">
          <span className={`indent-conn__ponto${(conexao?.tom ?? 'neutro') !== 'ok' ? ` indent-conn__ponto--${conexao?.tom ?? 'neutro'}` : ''}`} aria-hidden="true" />
          <div className="indent-cell-main" role="status">
            {conexao ? (
              <>
                <strong>{conexao.titulo}</strong>
                <span className="indent-cell-sub">{conexao.sub}</span>
                {tokensRestantes !== null && tokensLimite !== null && (
                  <span className="indent-cell-sub">
                    Orçamento diário de chamadas: {tokensRestantes.toLocaleString('pt-BR')} de {tokensLimite.toLocaleString('pt-BR')} restantes
                  </span>
                )}
              </>
            ) : (
              <span className="indent-cell-sub">{estado.isError ? 'Estado indisponível.' : 'Carregando o estado da integração…'}</span>
            )}
          </div>
          {conexao && (
            <>
              <span className="indent-tag indent-conn__tag">Somente leitura</span>
              {status?.webhook === 'active' ? (
                <span className="indent-tag indent-tag--ok">Webhook ativo</span>
              ) : (
                status?.connection !== 'not_configured' && (
                  <span className="indent-tag indent-tag--ok">Consulta automática a cada {status?.intervalMinutes ?? 10} min</span>
                )
              )}
            </>
          )}
        </div>
      </section>

      <div className="indent-cols">
        <div className="indent-coluna">
          <section className="indent-painel" aria-labelledby="ii-vira-solicitacao">
            <div className="indent-painel__cabeca">
              <h2 id="ii-vira-solicitacao">O que vira solicitação</h2>
            </div>

            {isAdmin && opcoes.isError && (
              <div role="alert" className="alert alert--error">
                Não foi possível carregar as opções do Pipedrive: {mensagemDoErro(opcoes.error)}
              </div>
            )}
            {erroConfig && (
              <div role="alert" className="alert alert--error">
                {erroConfig}
              </div>
            )}

            <div className="indent-campos-config">
              <div className="field">
                <label className="field-label" htmlFor="ii-funil">
                  Funil
                </label>
                <select
                  id="ii-funil"
                  className="input"
                  value={funilEfetivo !== null ? String(funilEfetivo) : ''}
                  disabled={!edita}
                  aria-busy={salvar.isPending ? true : undefined}
                  onChange={(event) => trocarFunil(event.target.value)}
                >
                  {funilEfetivo === null && <option value="">—</option>}
                  {funisLista.map((funil) => (
                    <option key={funil.id} value={funil.id}>
                      {funil.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label className="field-label" htmlFor="ii-coluna">
                  Coluna de origem
                </label>
                <select
                  id="ii-coluna"
                  className="input"
                  value={colunaSelecionada}
                  disabled={!edita}
                  aria-busy={salvar.isPending ? true : undefined}
                  onChange={(event) => trocarColuna(event.target.value)}
                >
                  {colunaSelecionada === '' && <option value="">{funilMudou ? 'Escolha a coluna de origem' : '—'}</option>}
                  {colunasLista.map((coluna) => (
                    <option key={coluna.id} value={coluna.id}>
                      {coluna.name}
                    </option>
                  ))}
                </select>
                {funilMudou && <span className="field-hint">Escolha a coluna do novo funil para salvar.</span>}
              </div>
              <div className="field">
                <label className="field-label" htmlFor="ii-prazo">
                  Prazo interno de resposta
                </label>
                <select
                  id="ii-prazo"
                  className="input"
                  value={String(prazoAtual)}
                  disabled={!isAdmin || status?.pipelineId == null || status.stageId == null}
                  aria-busy={salvar.isPending ? true : undefined}
                  onChange={(event) => trocarPrazo(event.target.value)}
                >
                  {PRAZOS.map((dias) => (
                    <option key={dias} value={dias}>
                      {rotuloPrazo(dias)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="indent-tabela-caixa">
              <div className="table-wrapper">
                <table className="table indent-tabela indent-mapa">
                  <thead>
                    <tr>
                      <th>Campo no Pipedrive</th>
                      <th>
                        <span className="sr-only">Corresponde a</span>
                      </th>
                      <th>No IQ Indent</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mapeamento.map((linha) => (
                      <tr key={linha.campo}>
                        <td>{linha.campo}</td>
                        <td className="indent-seta">
                          <span aria-hidden="true">→</span>
                        </td>
                        <td>
                          <div className="indent-cell-main">
                            <span>{linha.destino}</span>
                            {linha.nota && <span className="indent-cell-sub">{linha.nota}</span>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </div>

        <div className="indent-coluna">
          <IndentIntegracaoFila canWrite={canWrite} mostrar={mostrar} />
        </div>
      </div>

      {toast && <ForecastToast key={toast.id} dados={toast} onFechar={fechar} />}
    </div>
  );
}
