import { useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/components/Modal';
import Spinner from '@/components/Spinner';
import {
  createForecastDemandaComercial,
  FORECAST_DEMANDA_CLIENTE_MAX,
  FORECAST_DEMANDA_MOTIVO_MAX,
  forecastDemandaComercialErrorMessage,
  forecastDemandaKeys,
  listForecastProdutosParaDemanda,
  patchForecastDemandaComercial,
  validarDemandaComercial,
  type CampoDemanda,
  type ForecastProdutoParaDemanda,
} from '@/services/forecastDemandaComercial';
import { kgBr } from './forecastPainel';

/** Pedido ja existente (edicao): o produto nao muda; para trocar de produto, cancele e lance de novo. */
export interface DemandaParaEditar {
  id: number;
  productId: number;
  item: string;
  kg: number;
  necessidade: string;
  motivo: string;
  cliente: string | null;
  solicitacaoId: number | null;
}

interface Props {
  /** Data de hoje da quinzena (AAAA-MM-DD): menor data de necessidade aceita em um pedido novo. */
  hoje: string;
  /** Ausente = lancar pedido novo. */
  demanda?: DemandaParaEditar;
  onFechar: () => void;
  /** Chamado depois de gravar, com o texto para o aviso de status da tela. */
  onSalvo: (mensagem: string) => void;
}

const MAX_PRODUTOS_LISTADOS = 50;

const semAcento = (t: string) =>
  t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

export function filtrarProdutosParaDemanda(
  produtos: ForecastProdutoParaDemanda[],
  busca: string,
): ForecastProdutoParaDemanda[] {
  const termo = semAcento(busca.trim());
  const ativos = produtos.filter((p) => p.isActive);
  if (!termo) return ativos;
  return ativos.filter(
    (p) => semAcento(p.name).includes(termo) || p.codes.some((c) => semAcento(c.code).includes(termo)),
  );
}

function Erro({ id, texto }: { id: string; texto?: string }) {
  return texto ? (
    <p className="fcd-erro" id={id}>
      {texto}
    </p>
  ) : null;
}

function Formulario({ hoje, demanda, onFechar, onSalvo }: Props) {
  const queryClient = useQueryClient();
  const baseId = useId();
  const id = (campo: string) => `${baseId}-${campo}`;
  const editando = demanda !== undefined;

  const produtos = useQuery({
    queryKey: forecastDemandaKeys.produtos,
    queryFn: listForecastProdutosParaDemanda,
    enabled: !editando,
  });

  const [busca, setBusca] = useState('');
  const [escolhido, setEscolhido] = useState<number | null>(demanda?.productId ?? null);
  const [kg, setKg] = useState(demanda ? kgBr(demanda.kg).replace(/\./g, '') : '');
  const [necessidade, setNecessidade] = useState(demanda?.necessidade ?? '');
  const [motivo, setMotivo] = useState(demanda?.motivo ?? '');
  const [cliente, setCliente] = useState(demanda?.cliente ?? '');
  const [solicitacao, setSolicitacao] = useState(demanda?.solicitacaoId ? String(demanda.solicitacaoId) : '');
  const [erros, setErros] = useState<Partial<Record<CampoDemanda, string>>>({});
  const refs = {
    produto: useRef<HTMLInputElement>(null),
    kg: useRef<HTMLInputElement>(null),
    necessidade: useRef<HTMLInputElement>(null),
    motivo: useRef<HTMLTextAreaElement>(null),
    cliente: useRef<HTMLInputElement>(null),
    solicitacao: useRef<HTMLInputElement>(null),
  };

  const gravar = useMutation({
    mutationFn: (valores: NonNullable<ReturnType<typeof validarDemandaComercial>['valores']>) =>
      demanda
        ? patchForecastDemandaComercial(demanda.id, valores)
        : createForecastDemandaComercial({ ...valores, productId: escolhido as number }),
    onSuccess: () => {
      // O pedido e do cadastro ATUAL: muda a secao do relatorio de todas as quinzenas.
      void queryClient.invalidateQueries({ queryKey: ['forecast', 'relatorio'] });
      onSalvo(demanda ? 'Demanda do comercial atualizada.' : 'Demanda do comercial lançada.');
      onFechar();
    },
  });

  const listados = useMemo(
    () => filtrarProdutosParaDemanda(produtos.data ?? [], busca),
    [produtos.data, busca],
  );
  const visiveis = listados.slice(0, MAX_PRODUTOS_LISTADOS);
  // So conta como escolhido o produto VISIVEL na lista (a busca que o tira tambem desfaz a escolha).
  const produtoEscolhido = editando ? true : visiveis.some((p) => p.id === escolhido);
  const pendente = gravar.isPending;

  const limpar = (campo: CampoDemanda) => {
    gravar.reset();
    setErros((e) => (e[campo] ? { ...e, [campo]: undefined } : e));
  };

  const aoEnviar = (evento: FormEvent) => {
    evento.preventDefault();
    if (pendente) return;
    // Na edicao a data so e barrada quando muda (pedido antigo continua editavel com a mesma data).
    const dataMudou = !demanda || necessidade !== demanda.necessidade;
    const { erros: achados, valores } = validarDemandaComercial(
      { kg, necessidade, motivo, cliente, solicitacao },
      { produtoEscolhido, minNecessidade: dataMudou ? hoje : undefined },
    );
    setErros(achados);
    if (!valores) {
      const primeiro = (['produto', 'kg', 'necessidade', 'motivo', 'cliente', 'solicitacao'] as const).find(
        (c) => achados[c],
      );
      if (primeiro) refs[primeiro].current?.focus();
      return;
    }
    gravar.mutate(valores);
  };

  const descricao = (campo: CampoDemanda, extra?: string) =>
    [erros[campo] ? id(`${campo}-erro`) : '', extra ?? ''].filter(Boolean).join(' ') || undefined;

  return (
    <form className="fcd-form" onSubmit={aoEnviar} noValidate>
      <p className="fcd-dica">
        Compra pedida pelo comercial por uma programação futura de cliente. Só soma ao Forecast quando a data de
        necessidade é posterior ao último mês de programação do DBCorp; antes disso a programação já deve conter o
        pedido.
      </p>

      {editando ? (
        <p className="fcd-dica">Para trocar o produto, cancele este pedido e lance outro.</p>
      ) : (
        <fieldset className="fcd-campo" disabled={pendente} aria-describedby={descricao('produto')}>
          <legend className="field-label">Produto</legend>
          <label className="sr-only" htmlFor={id('busca')}>
            Buscar produto por nome ou código
          </label>
          <input
            id={id('busca')}
            className="input"
            type="search"
            placeholder="Buscar produto por nome ou código"
            autoComplete="off"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
          {produtos.isLoading && (
            <div className="fcd-carregando" role="status">
              <Spinner /> Carregando produtos…
            </div>
          )}
          {produtos.isError && (
            <div className="alert alert--error" role="alert">
              <p className="fcd-alert__texto">{forecastDemandaComercialErrorMessage(produtos.error)}</p>
              <button type="button" className="ghost-button" onClick={() => void produtos.refetch()}>
                Tentar de novo
              </button>
            </div>
          )}
          {produtos.isSuccess && (
            <>
              <p className="fcd-dica" role="status">
                {listados.length === 0
                  ? 'Nenhum produto ativo encontrado.'
                  : listados.length > visiveis.length
                    ? `Mostrando ${visiveis.length} de ${listados.length} produtos. Refine a busca para ver os demais.`
                    : `${listados.length} ${listados.length === 1 ? 'produto' : 'produtos'}`}
              </p>
              <div className="fcd-produtos" role="radiogroup" aria-label="Produto">
                {visiveis.map((p, i) => (
                  <label key={p.id} className="fcd-produto">
                    <input
                      ref={i === 0 ? refs.produto : undefined}
                      type="radio"
                      name={id('produto')}
                      checked={escolhido === p.id}
                      onChange={() => {
                        limpar('produto');
                        setEscolhido(p.id);
                      }}
                    />
                    <span className="fcd-produto__nome">{p.name}</span>
                    <span className="fcd-produto__fonte">{p.source?.name ?? 'Sem fonte'}</span>
                  </label>
                ))}
              </div>
            </>
          )}
          <Erro id={id('produto-erro')} texto={erros.produto} />
        </fieldset>
      )}

      <div className="fcd-grade">
        <div className="fcd-campo">
          <label className="field-label" htmlFor={id('kg')}>
            Quantidade pedida (kg)
          </label>
          <input
            ref={refs.kg}
            id={id('kg')}
            className="input fcd-input-num"
            inputMode="decimal"
            autoComplete="off"
            value={kg}
            onChange={(e) => {
              limpar('kg');
              setKg(e.target.value);
            }}
            aria-invalid={erros.kg ? true : undefined}
            aria-describedby={descricao('kg', id('kg-dica'))}
            disabled={pendente}
          />
          <p className="fcd-dica" id={id('kg-dica')}>
            Até 3 casas decimais, ex.: 1600 ou 1.600,5.
          </p>
          <Erro id={id('kg-erro')} texto={erros.kg} />
        </div>
        <div className="fcd-campo">
          <label className="field-label" htmlFor={id('necessidade')}>
            Data de necessidade
          </label>
          <input
            ref={refs.necessidade}
            id={id('necessidade')}
            className="input"
            type="date"
            min={editando ? undefined : hoje}
            value={necessidade}
            onChange={(e) => {
              limpar('necessidade');
              setNecessidade(e.target.value);
            }}
            aria-invalid={erros.necessidade ? true : undefined}
            aria-describedby={descricao('necessidade')}
            disabled={pendente}
          />
          <Erro id={id('necessidade-erro')} texto={erros.necessidade} />
        </div>
      </div>

      <div className="fcd-campo">
        <label className="field-label" htmlFor={id('motivo')}>
          Motivo do pedido
        </label>
        <textarea
          ref={refs.motivo}
          id={id('motivo')}
          className="input fcd-motivo"
          rows={2}
          maxLength={FORECAST_DEMANDA_MOTIVO_MAX}
          value={motivo}
          onChange={(e) => {
            limpar('motivo');
            setMotivo(e.target.value);
          }}
          aria-invalid={erros.motivo ? true : undefined}
          aria-describedby={descricao('motivo', id('motivo-dica'))}
          disabled={pendente}
        />
        <p className="fcd-dica" id={id('motivo-dica')}>
          De 3 a {FORECAST_DEMANDA_MOTIVO_MAX} caracteres ({motivo.length}/{FORECAST_DEMANDA_MOTIVO_MAX}).
        </p>
        <Erro id={id('motivo-erro')} texto={erros.motivo} />
      </div>

      <div className="fcd-grade">
        <div className="fcd-campo">
          <label className="field-label" htmlFor={id('cliente')}>
            Cliente (opcional)
          </label>
          <input
            ref={refs.cliente}
            id={id('cliente')}
            className="input"
            maxLength={FORECAST_DEMANDA_CLIENTE_MAX}
            autoComplete="off"
            value={cliente}
            onChange={(e) => {
              limpar('cliente');
              setCliente(e.target.value);
            }}
            aria-invalid={erros.cliente ? true : undefined}
            aria-describedby={descricao('cliente')}
            disabled={pendente}
          />
          <Erro id={id('cliente-erro')} texto={erros.cliente} />
        </div>
        <div className="fcd-campo">
          <label className="field-label" htmlFor={id('solicitacao')}>
            Nº da Solicitação do IntelliQuote (opcional)
          </label>
          <input
            ref={refs.solicitacao}
            id={id('solicitacao')}
            className="input fcd-input-num"
            inputMode="numeric"
            autoComplete="off"
            value={solicitacao}
            onChange={(e) => {
              limpar('solicitacao');
              setSolicitacao(e.target.value);
            }}
            aria-invalid={erros.solicitacao ? true : undefined}
            aria-describedby={descricao('solicitacao', id('solicitacao-dica'))}
            disabled={pendente}
          />
          <p className="fcd-dica" id={id('solicitacao-dica')}>
            Só para rastreio: o número precisa existir em Solicitações (a solicitação não é alterada).
          </p>
          <Erro id={id('solicitacao-erro')} texto={erros.solicitacao} />
        </div>
      </div>

      {gravar.isError && (
        <div className="alert alert--error" role="alert">
          {forecastDemandaComercialErrorMessage(gravar.error)}
        </div>
      )}
      <div className="modal-actions">
        <button type="button" className="ghost-button" onClick={onFechar} disabled={pendente}>
          Cancelar
        </button>
        <button type="submit" className="primary-button" disabled={pendente} aria-busy={pendente}>
          {pendente ? 'Salvando…' : editando ? 'Salvar alterações' : 'Lançar demanda'}
        </button>
      </div>
    </form>
  );
}

export default function ForecastDemandaComercialModal(props: Props) {
  return (
    <Modal
      isOpen
      onClose={props.onFechar}
      title={props.demanda ? `Editar demanda do comercial · ${props.demanda.item}` : 'Lançar demanda do comercial'}
      size="wide"
    >
      <Formulario {...props} />
    </Modal>
  );
}
