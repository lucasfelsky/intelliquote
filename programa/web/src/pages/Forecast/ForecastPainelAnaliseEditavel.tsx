import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/api/client';
import { Icon } from '@/components/icons';
import { InfoPopover } from '@/components/InfoPopover';
import type { ForecastLinha } from '@/services/forecast';
import {
  forecastDecisaoErrorMessage,
  forecastDecisoesKeys,
  putForecastDecisao,
  type ForecastDecisao,
} from '@/services/forecastDecisoes';
import { ID_COLUNA_ANALISE } from './forecastAnaliseDecidida';
import {
  aplicarGravacao,
  APOIO_ANALISE_CANDIDATO,
  APOIO_ANALISE_PREENCHER,
  corpoDaGravacao,
  DICA_FORA_DA_LISTA,
  foraDaListaDeCompra,
  kgParaCampo,
  somenteLeitura,
  validarQuantidade,
} from './forecastAnaliseEditavel';
import { kgBr, type ColunaPainel } from './forecastPainel';

// Celula editavel da coluna ANALISE FORECAST (papeis admin/comprador): clicar abre o campo; Enter ou sair do campo grava;
// Esc cancela; campo vazio apaga a decisao. Grava a mesma ForecastPurchaseDecision do relatorio e atualiza o MESMO cache
// (forecastDecisoesKeys), sem novo GET. So a celula em edicao tem mutacao (o painel tem centenas de linhas).

// Retorno da celula para o Painel: "ok" vira o aviso flutuante (toast); "erro" segue como alerta persistente; nulo limpa o alerta.
export type FeedbackCelula =
  | { tipo: 'ok'; acao: 'salvo' | 'removido'; texto: string }
  | { tipo: 'erro'; texto: string }
  | null;

/** Duracao do destaque da celula recem gravada (CSS .fcae-botao--piscar). */
export const PISCAR_CELULA_MS = 1500;

interface CelulaProps {
  linha: ForecastLinha;
  decisao: ForecastDecisao | undefined;
  snapshotId: number;
  texto: string;
  destaque: string | undefined;
  aoFeedback: (f: FeedbackCelula) => void;
}

const rotuloDoCampo = (item: string) => `Quantidade fechada de ${item}`;

export function CelulaAnaliseEditavel({ linha, decisao, snapshotId, texto, destaque, aoFeedback }: CelulaProps) {
  const queryClient = useQueryClient();
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState('');
  const [erro, setErro] = useState('');
  const [piscar, setPiscar] = useState(false);
  const botao = useRef<HTMLButtonElement>(null);
  const campo = useRef<HTMLInputElement>(null);
  const devolverFoco = useRef(false);
  const ocupado = useRef(false);
  const cancelado = useRef(false);
  const productId = linha.productId as number;
  const nome = linha.item;
  const fora = foraDaListaDeCompra(linha) && !decisao;

  const gravar = useMutation({
    mutationFn: (kg: number | null) => putForecastDecisao(snapshotId, productId, corpoDaGravacao(linha, decisao, kg)),
    onSuccess: (r, kg) => {
      queryClient.setQueryData<ForecastDecisao[]>(forecastDecisoesKeys.lista(snapshotId), (lista) =>
        aplicarGravacao(lista, productId, r),
      );
      ocupado.current = false;
      setErro('');
      setEditando(false);
      // Remocao nao pisca (a celula volta ao vazio); gravar destaca a celula por ~1,5 s.
      setPiscar(kg !== null);
      const manual = r.decisao?.incluidoManualmente === true && decisao?.incluidoManualmente !== true;
      aoFeedback({
        tipo: 'ok',
        acao: kg === null ? 'removido' : 'salvo',
        texto:
          kg === null
            ? `Quantidade fechada de ${nome} removida.`
            : `Quantidade fechada de ${nome} salva: ${kgBr(kg)} kg.${manual ? ' Item fora da lista de compra: passou a ser candidato a cotação.' : ''}`,
      });
    },
    onError: (err) => {
      ocupado.current = false;
      const base = forecastDecisaoErrorMessage(err);
      // Outra pessoa gravou antes: recarrega a lista (o digitado fica no campo) e pede para conferir.
      const conflito = err instanceof ApiError && err.status === 409;
      if (conflito) void queryClient.invalidateQueries({ queryKey: forecastDecisoesKeys.lista(snapshotId) });
      const msg = conflito ? `${base} A lista foi recarregada: confira e salve de novo.` : base;
      setErro(msg);
      aoFeedback({ tipo: 'erro', texto: `${rotuloDoCampo(nome)}: ${msg}` });
    },
  });

  // O destaque some depois de ~1,5 s (a animacao CSS acompanha; o estado so evita repeti-la ao remontar o botao).
  useEffect(() => {
    if (!piscar) return undefined;
    const t = window.setTimeout(() => setPiscar(false), PISCAR_CELULA_MS);
    return () => window.clearTimeout(t);
  }, [piscar]);

  // Volta o foco ao botao so quando o teclado encerrou a edicao (Enter/Esc); clicar fora nao rouba o foco.
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
    setValor(decisao ? kgParaCampo(decisao.quantidadeKg) : '');
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
    const v = validarQuantidade(valor);
    if (v.erro) {
      setErro(v.erro);
      aoFeedback({ tipo: 'erro', texto: `${rotuloDoCampo(nome)}: ${v.erro}` });
      return;
    }
    // Sem mudanca (inclui campo vazio sem decisao): so fecha.
    if (v.kg === (decisao?.quantidadeKg ?? null)) {
      setErro('');
      setEditando(false);
      return;
    }
    ocupado.current = true;
    setErro('');
    gravar.mutate(v.kg);
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
        className={piscar ? 'fcae-botao fcae-botao--piscar' : 'fcae-botao'}
        aria-label={rotuloDoCampo(nome)}
        title={fora ? DICA_FORA_DA_LISTA : 'Clique para preencher a quantidade fechada'}
        onClick={abrir}
      >
        {destaque ? <span className={destaque}>{texto}</span> : texto}
      </button>
    );
  }

  return (
    <input
      ref={campo}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      className="fcae-campo"
      aria-label={rotuloDoCampo(nome)}
      aria-invalid={erro !== '' || undefined}
      aria-busy={gravar.isPending || undefined}
      title={fora ? DICA_FORA_DA_LISTA : 'Enter grava, Esc cancela, vazio apaga'}
      placeholder={texto === '-' ? '' : texto}
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

/** Icone "i" no titulo da coluna ANALISE FORECAST: balao (hover, foco ou clique) com como preencher. So admin/comprador (quem edita). */
export function DicaAnaliseForecast() {
  return (
    <InfoPopover
      label="Como preencher a análise forecast"
      tone="info"
      className="fcae-dica"
      testId="fc-analise-dica"
      contentTestId="fc-analise-dica-balao"
      trigger={<Icon name="info" size={14} />}
    >
      <strong>Quantidade fechada</strong>
      <span>{APOIO_ANALISE_PREENCHER}</span>
      <span>{APOIO_ANALISE_CANDIDATO}</span>
    </InfoPopover>
  );
}

interface OpcoesEdicao {
  snapshotId: number;
  mapa: ReadonlyMap<number, ForecastDecisao> | null;
  aoFeedback: (f: FeedbackCelula) => void;
}

function decisaoDaLinha(linha: ForecastLinha, mapa: ReadonlyMap<number, ForecastDecisao>): ForecastDecisao | undefined {
  return linha.productId === null || linha.productId === undefined ? undefined : mapa.get(linha.productId);
}

/**
 * Devolve as colunas com a ANALISE FORECAST editavel (admin/comprador). `mapa` nulo (decisoes ainda sem dados) devolve o
 * proprio array: sem saber da cotacao vinculada nao se edita. Item sem cadastro ou com cotacao aberta segue so leitura,
 * com a dica do motivo. As demais colunas mantem a referencia.
 */
export function colunasComEdicao(colunas: ColunaPainel[], { snapshotId, mapa, aoFeedback }: OpcoesEdicao): ColunaPainel[] {
  if (mapa === null) return colunas;
  return colunas.map((c) => {
    if (c.id !== ID_COLUNA_ANALISE) return c;
    return {
      ...c,
      rotuloExtra: <DicaAnaliseForecast />,
      celula: (l, base) => {
        if (somenteLeitura(l, decisaoDaLinha(l, mapa))) return null;
        return (
          <CelulaAnaliseEditavel
            linha={l}
            decisao={decisaoDaLinha(l, mapa)}
            snapshotId={snapshotId}
            texto={base.texto}
            destaque={base.destaque}
            aoFeedback={aoFeedback}
          />
        );
      },
      titulo: (l) => {
        const d = decisaoDaLinha(l, mapa);
        const trava = somenteLeitura(l, d);
        const dica = c.titulo?.(l);
        if (trava) return dica ? `${dica} · ${trava.motivo}` : trava.motivo;
        if (!d && foraDaListaDeCompra(l)) return dica ? `${dica} · ${DICA_FORA_DA_LISTA}` : DICA_FORA_DA_LISTA;
        return dica;
      },
      textoAcessivel: (l) => {
        const trava = somenteLeitura(l, decisaoDaLinha(l, mapa));
        const antes = c.textoAcessivel?.(l);
        if (!trava) return antes;
        return antes ? `${antes} · ${trava.motivo}` : ` — ${trava.motivo}`;
      },
    };
  });
}
