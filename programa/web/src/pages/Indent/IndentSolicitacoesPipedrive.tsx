import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/api/client';
import type { DadosToast } from '@/pages/Forecast/ForecastToast';
import {
  CHAVES_APOS_ACAO,
  getIndentPipedriveStatus,
  syncIndentPipedrive,
  type IndentPipedriveStatus,
  type IndentPipedriveSyncResult,
} from '@/services/indentPipedrive';
import { formatarHora, mensagemDoErro } from './indentFila';

// IQ Indent: botao "Pipedrive · <funil> · ha N min" da lista de Solicitacoes (mock v14, `#sync`). Sincroniza na hora (so LE o Pipedrive; nada volta
// para o CRM). Mesmo contrato da tela Integracao: o estado vem do BACKEND (`GET /pipedrive/status`, sem chamar a API do Pipedrive) e o "Sincronizar"
// trata 409/429/502 como aviso e timeout/rede reconsultando o estado (o rewrite do Hosting corta em 60 s e a varredura grava o resultado mesmo assim).

type Mostrar = (tipo: DadosToast['tipo'], titulo: string, texto: string) => void;

const CHAVE_STATUS = ['indent', 'pipedrive', 'status'] as const;
const UM_MINUTO_MS = 60_000;

export interface AvisoSincronizacao {
  tom: 'erro' | 'aviso' | 'info';
  texto: string;
}

/** "há menos de 1 min" | "há 3 min" | "há 2 h" | "há 4 d"; sem data = null (nunca sincronizou). */
export function rotuloHa(valor: string | null | undefined, agora: Date): string | null {
  if (!valor) return null;
  const instante = new Date(valor).getTime();
  if (Number.isNaN(instante)) return null;
  const minutos = Math.floor((agora.getTime() - instante) / UM_MINUTO_MS);
  // `agora` pode estar atrasado em relacao a uma sincronizacao recem-gravada (minutos negativos): tambem vale "menos de 1 min".
  if (minutos < 1) return 'há menos de 1 min';
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `há ${horas} h`;
  return `há ${Math.floor(horas / 24)} d`;
}

/** Rotulo do botao: "Pipedrive · Funil de Vendas Indent · há 3 min" (so as partes que existem). */
export function rotuloDoBotao(status: IndentPipedriveStatus | undefined, agora: Date): string {
  const partes = ['Pipedrive'];
  if (status?.pipelineName) partes.push(status.pipelineName);
  const ha = rotuloHa(status?.lastSyncAt, agora);
  if (ha) partes.push(ha);
  else if (status?.configured === true) partes.push('sem sincronização');
  return partes.join(' · ');
}

function plural(n: number, singular: string, pluralTexto: string): string {
  return `${n.toLocaleString('pt-BR')} ${n === 1 ? singular : pluralTexto}`;
}

/** Respostas do proprio backend (409/429/502) trazem `message` no corpo; timeout do Hosting (504), HTML ou queda de rede nao. */
function respostaDoServidor(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  const corpo = err.body as { message?: unknown; contentType?: unknown } | null;
  return corpo !== null && typeof corpo === 'object' && typeof corpo.message === 'string' && corpo.contentType === undefined;
}

export function useSincronizarPipedrive(ativo: boolean, mostrar: Mostrar) {
  const qc = useQueryClient();
  // So quem escreve (admin/comprador/gestor) ve o botao: o estado nem e pedido para os demais.
  const estado = useQuery({ queryKey: CHAVE_STATUS, queryFn: getIndentPipedriveStatus, enabled: ativo });
  const status = estado.data;
  const [agora, setAgora] = useState(() => new Date());
  const [sincronizando, setSincronizando] = useState(false);
  const [aviso, setAviso] = useState<AvisoSincronizacao | null>(null);

  // O "há N min" avanca sozinho, sem nova consulta.
  useEffect(() => {
    if (!ativo) return undefined;
    const timer = window.setInterval(() => setAgora(new Date()), UM_MINUTO_MS);
    return () => window.clearInterval(timer);
  }, [ativo]);

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

  async function reconsultar(antes: string | null) {
    try {
      const atual = await qc.fetchQuery({ queryKey: CHAVE_STATUS, queryFn: getIndentPipedriveStatus, staleTime: 0 });
      if (atual.lastSyncAt !== null && atual.lastSyncAt !== antes) {
        avisarSucesso({ outcome: 'run_ok', processed: 0, created: atual.lastSyncNewDeals, errors: atual.lastSyncErrors, missed: 0, durationMs: 0 }, antes);
      } else {
        setAviso({
          tom: 'info',
          texto: 'A resposta demorou mais que o esperado e a sincronização pode ainda estar em andamento. O estado da integração foi atualizado; confira a última sincronização.',
        });
      }
    } catch {
      setAviso({ tom: 'aviso', texto: 'Não foi possível confirmar o resultado da sincronização. Atualize a página para ver o estado da integração.' });
    }
  }

  async function sincronizar() {
    // aria-disabled (e nao disabled) enquanto roda: o foco fica no botao.
    if (sincronizando) return;
    setSincronizando(true);
    setAviso(null);
    const antes = status?.lastSyncAt ?? null;
    try {
      avisarSucesso(await syncIndentPipedrive(), antes);
    } catch (err) {
      if (respostaDoServidor(err)) {
        const http = err instanceof ApiError ? err.status : 0;
        setAviso({ tom: http === 409 || http === 429 ? 'aviso' : 'erro', texto: mensagemDoErro(err) });
      } else {
        await reconsultar(antes);
      }
    } finally {
      setSincronizando(false);
      setAgora(new Date());
      // A lista, os contadores e a fila de vinculo mudam com a sincronizacao (as opcoes ao vivo do Pipedrive NAO: ver CHAVES_APOS_ACAO).
      for (const queryKey of CHAVES_APOS_ACAO) void qc.invalidateQueries({ queryKey });
    }
  }

  return {
    rotulo: rotuloDoBotao(status, agora),
    configurado: status?.configured === true,
    sincronizando,
    aviso,
    sincronizar,
  };
}
