import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/api/client';
import { forecastKeys, putForecastObservacao, type ForecastLinha, type ForecastSnapshotDetail } from '@/services/forecast';
import type { FeedbackCelula } from './ForecastPainelAnaliseEditavel';
import type { ColunaPainel } from './forecastPainel';

// Celula editavel da coluna OBS. do painel (admin/comprador): clicar abre o campo; Enter ou sair do campo grava; Esc
// cancela; campo vazio apaga a observacao. A observacao fica na quinzena e, na mais recente, vai ao cadastro do produto:
// e de la que a proxima importacao a puxa. So a celula em edicao tem mutacao (o painel tem centenas de linhas).

export const OBS_MAX_CHARS = 1000;
export const ID_COLUNA_OBS = 'obs';

const rotuloDoCampo = (item: string) => `Observação de ${item}`;

export function mensagemDeErroObservacao(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.status) {
      case 401:
        return 'Sua sessão expirou. Entre de novo.';
      case 403:
        return 'Seu perfil só pode ler as observações.';
      case 404:
        return 'Item ou quinzena não encontrados (pode ter sido excluída).';
      case 400:
        return err.message && err.message !== `HTTP ${err.status}` ? err.message : 'Observação recusada pelo servidor.';
      default:
        return `Não foi possível salvar a observação (HTTP ${err.status}).`;
    }
  }
  return 'Sem conexão com o servidor. Tente de novo.';
}

interface CelulaProps {
  linha: ForecastLinha;
  snapshotId: number;
  texto: string;
  aoFeedback: (f: FeedbackCelula) => void;
}

export function CelulaObservacaoEditavel({ linha, snapshotId, texto, aoFeedback }: CelulaProps) {
  const queryClient = useQueryClient();
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState('');
  const [erro, setErro] = useState('');
  const botao = useRef<HTMLButtonElement>(null);
  const campo = useRef<HTMLInputElement>(null);
  const devolverFoco = useRef(false);
  const ocupado = useRef(false);
  const cancelado = useRef(false);
  const productId = linha.productId as number;
  const nome = linha.item;
  const atual = linha.obs ?? '';

  const gravar = useMutation({
    mutationFn: (observacao: string) => putForecastObservacao(snapshotId, productId, observacao),
    onSuccess: (r) => {
      queryClient.setQueryData<ForecastSnapshotDetail>(forecastKeys.snapshot(snapshotId), (detalhe) =>
        detalhe
          ? { ...detalhe, linhas: detalhe.linhas.map((l) => (l.productId === productId ? { ...l, obs: r.observacao } : l)) }
          : detalhe,
      );
      // O relatorio de compras mostra a mesma observacao: refaz a leitura dele na proxima vez que abrir.
      void queryClient.invalidateQueries({ queryKey: forecastKeys.relatorio(snapshotId) });
      ocupado.current = false;
      setErro('');
      setEditando(false);
      aoFeedback({
        tipo: 'ok',
        acao: r.observacao === '' ? 'removido' : 'salvo',
        titulo: r.observacao === '' ? 'Observação removida' : 'Observação salva',
        texto:
          r.observacao === ''
            ? `Observação de ${nome} removida.`
            : `Observação de ${nome} salva.${r.cadastroAtualizado ? ' Ela virá nas próximas quinzenas importadas.' : ''}`,
      });
    },
    onError: (err) => {
      ocupado.current = false;
      const msg = mensagemDeErroObservacao(err);
      setErro(msg);
      aoFeedback({ tipo: 'erro', texto: `${rotuloDoCampo(nome)}: ${msg}` });
    },
  });

  useEffect(() => {
    if (!editando && devolverFoco.current) {
      devolverFoco.current = false;
      botao.current?.focus();
    }
  }, [editando]);
  useEffect(() => {
    if (editando) {
      campo.current?.focus();
      campo.current?.select();
    }
  }, [editando]);

  const abrir = () => {
    setValor(atual);
    setErro('');
    aoFeedback(null);
    cancelado.current = false;
    setEditando(true);
  };

  const cancelar = () => {
    if (ocupado.current) return;
    cancelado.current = true;
    setErro('');
    aoFeedback(null);
    setEditando(false);
  };

  const salvar = () => {
    if (ocupado.current || cancelado.current) return;
    const novo = valor.trim();
    if (novo.length > OBS_MAX_CHARS) {
      const msg = `A observação aceita no máximo ${OBS_MAX_CHARS} caracteres.`;
      setErro(msg);
      aoFeedback({ tipo: 'erro', texto: `${rotuloDoCampo(nome)}: ${msg}` });
      return;
    }
    if (novo === atual.trim()) {
      setErro('');
      setEditando(false);
      return;
    }
    ocupado.current = true;
    setErro('');
    gravar.mutate(novo);
  };

  const aoTeclar = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      devolverFoco.current = true;
      salvar();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      devolverFoco.current = true;
      cancelar();
    }
  };

  if (!editando) {
    return (
      <button
        ref={botao}
        type="button"
        className="fcae-botao fcoe-botao"
        aria-label={rotuloDoCampo(nome)}
        title={texto !== '' ? texto : 'Clique para escrever a observação'}
        onClick={abrir}
      >
        {texto !== '' ? texto : <span className="fcoe-vazio">Adicionar</span>}
      </button>
    );
  }

  return (
    <input
      ref={campo}
      type="text"
      autoComplete="off"
      className="fcae-campo fcoe-campo"
      aria-label={rotuloDoCampo(nome)}
      aria-invalid={erro !== '' || undefined}
      aria-busy={gravar.isPending || undefined}
      title="Enter grava, Esc cancela, vazio apaga"
      value={valor}
      disabled={gravar.isPending}
      onChange={(e) => {
        setValor(e.target.value);
        if (erro) setErro('');
        if (gravar.isError) gravar.reset();
      }}
      onKeyDown={aoTeclar}
      onBlur={salvar}
    />
  );
}

interface OpcoesObservacao {
  snapshotId: number;
  aoFeedback: (f: FeedbackCelula) => void;
}

/** Devolve as colunas com a OBS. editavel (admin/comprador). Linha sem produto no cadastro segue so leitura. */
export function colunasComObservacao(colunas: ColunaPainel[], { snapshotId, aoFeedback }: OpcoesObservacao): ColunaPainel[] {
  return colunas.map((c) => {
    if (c.id !== ID_COLUNA_OBS) return c;
    return {
      ...c,
      celula: (l, base) =>
        l.productId === null || l.productId === undefined ? null : (
          <CelulaObservacaoEditavel linha={l} snapshotId={snapshotId} texto={base.texto} aoFeedback={aoFeedback} />
        ),
    };
  });
}
