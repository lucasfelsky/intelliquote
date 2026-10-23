import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/components/Modal';
import Spinner from '@/components/Spinner';
import {
  FORECAST_GRUPO_NOME_MAX,
  FORECAST_GRUPO_OBSERVACAO_MAX,
  createForecastGrupo,
  deleteForecastGrupo,
  filtrarProdutosParaGrupo,
  forecastGrupoErrorMessage,
  forecastGruposKeys,
  listForecastGrupos,
  listForecastProdutosParaGrupo,
  patchForecastGrupo,
  validarGrupo,
  type CampoGrupo,
  type ForecastGrupoEquivalencia,
} from '@/services/forecastGrupos';

interface Props {
  /** admin/comprador: cria, edita e desfaz grupos; os demais so leem. */
  podeEditar: boolean;
  onFechar: () => void;
}

type Modo =
  | { tipo: 'lista' }
  | { tipo: 'form'; grupo?: ForecastGrupoEquivalencia }
  | { tipo: 'desfazer'; grupo: ForecastGrupoEquivalencia };

const MAX_PRODUTOS_LISTADOS = 50;

const plural = (n: number, singular: string, pluralForm: string) => (n === 1 ? singular : pluralForm);

function Erro({ id, texto }: { id: string; texto?: string }) {
  return texto ? (
    <p className="fcd-erro" id={id}>
      {texto}
    </p>
  ) : null;
}

// O grupo muda o relatorio de compras e a memoria de calculo de TODAS as quinzenas (cadastro ATUAL).
function useAtualizarForecast() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ['forecast'] });
}

interface VoltarProps {
  onVoltar: (aviso?: string) => void;
}

function Formulario({ grupo, grupos, onVoltar }: VoltarProps & { grupo?: ForecastGrupoEquivalencia; grupos: ForecastGrupoEquivalencia[] }) {
  const atualizar = useAtualizarForecast();
  const baseId = useId();
  const id = (campo: string) => `${baseId}-${campo}`;
  const editando = grupo !== undefined;

  const produtos = useQuery({ queryKey: forecastGruposKeys.produtos, queryFn: listForecastProdutosParaGrupo });
  const [nome, setNome] = useState(grupo?.nome ?? '');
  const [observacao, setObservacao] = useState(grupo?.observacao ?? '');
  const [busca, setBusca] = useState('');
  const [escolhidos, setEscolhidos] = useState<number[]>(grupo?.membros.map((m) => m.id) ?? []);
  const [principal, setPrincipal] = useState<number | null>(grupo?.principalProdutoId ?? null);
  const [erros, setErros] = useState<Partial<Record<CampoGrupo, string>>>({});
  const [confirmando, setConfirmando] = useState(false);
  const refs = {
    nome: useRef<HTMLInputElement>(null),
    observacao: useRef<HTMLTextAreaElement>(null),
    produtos: useRef<HTMLInputElement>(null),
    principal: useRef<HTMLInputElement>(null),
  };
  const titulo = useRef<HTMLHeadingElement>(null);

  const gravar = useMutation({
    mutationFn: (valores: NonNullable<ReturnType<typeof validarGrupo>['valores']>) =>
      grupo ? patchForecastGrupo(grupo.id, valores) : createForecastGrupo(valores),
    onSuccess: async (salvo) => {
      await atualizar();
      onVoltar(`Grupo ${salvo.nome} ${editando ? 'atualizado' : 'criado'}.`);
    },
  });
  const pendente = gravar.isPending;

  const nomeDe = useMemo(() => {
    const mapa = new Map<number, string>();
    for (const p of produtos.data ?? []) mapa.set(p.id, p.name);
    for (const m of grupo?.membros ?? []) mapa.set(m.id, m.nome);
    return (pid: number) => mapa.get(pid) ?? `Produto ${pid}`;
  }, [produtos.data, grupo]);
  const grupoDoProduto = useMemo(() => {
    const mapa = new Map<number, string>();
    for (const g of grupos) for (const m of g.membros) if (g.id !== grupo?.id) mapa.set(m.id, g.nome);
    return mapa;
  }, [grupos, grupo]);

  const listados = useMemo(
    () => filtrarProdutosParaGrupo(produtos.data ?? [], busca, grupo?.id ?? null),
    [produtos.data, busca, grupo],
  );
  const visiveis = listados.slice(0, MAX_PRODUTOS_LISTADOS);
  // Produtos ativos que ja estao em OUTRO grupo: nao aparecem como candidatos (um produto pertence a um unico grupo).
  const ocupados = useMemo(
    () => (produtos.data ?? []).filter((p) => p.isActive && p.equivalenceGroupId !== null && p.equivalenceGroupId !== grupo?.id).length,
    [produtos.data, grupo],
  );

  const limpar = (campo: CampoGrupo) => {
    gravar.reset();
    setErros((e) => (e[campo] ? { ...e, [campo]: undefined } : e));
  };
  const alternar = (pid: number) => {
    limpar('produtos');
    limpar('principal');
    setEscolhidos((atual) => {
      const novo = atual.includes(pid) ? atual.filter((x) => x !== pid) : [...atual, pid];
      if (principal !== null && !novo.includes(principal)) setPrincipal(null);
      return novo;
    });
  };

  const validar = () => {
    const { erros: achados, valores } = validarGrupo({ nome, observacao, produtoIds: escolhidos, principalProdutoId: principal });
    setErros(achados);
    if (!valores) {
      const primeiro = (['nome', 'observacao', 'produtos', 'principal'] as const).find((c) => achados[c]);
      if (primeiro) refs[primeiro].current?.focus();
    }
    return valores;
  };

  const aoEnviar = (evento: FormEvent) => {
    evento.preventDefault();
    if (pendente) return;
    if (!confirmando) {
      // Grupo errado esconde compra: confirma antes de gravar, com os produtos a vista.
      if (validar()) {
        setConfirmando(true);
        window.setTimeout(() => titulo.current?.focus(), 0);
      }
      return;
    }
    const valores = validar();
    if (valores) gravar.mutate(valores);
  };

  if (confirmando) {
    return (
      <form className="fcd-form fcg-form" onSubmit={aoEnviar} noValidate>
        <h3 className="fcg-titulo" tabIndex={-1} ref={titulo}>
          Confirmar o grupo {nome.trim()}
        </h3>
        <p className="fcd-dica">
          Estes {escolhidos.length} produtos passam a ser avaliados como o MESMO material: o estoque, as chegadas, as
          programações e as médias são somados, e a compra sai pelo produto principal. O estoque de um produto pode cobrir
          a compra de outro.
        </p>
        <ul className="fcg-membros">
          {escolhidos.map((pid) => (
            <li key={pid}>
              {nomeDe(pid)}
              {principal === pid && <span className="badge badge--info">Principal</span>}
            </li>
          ))}
        </ul>
        {principal === null && (
          <p className="fcd-dica">Sem produto principal: a compra sai pelo membro de maior média na quinzena.</p>
        )}
        {gravar.isError && (
          <div className="alert alert--error" role="alert">
            {forecastGrupoErrorMessage(gravar.error)}
          </div>
        )}
        <div className="modal-actions">
          <button type="button" className="ghost-button" onClick={() => setConfirmando(false)} disabled={pendente}>
            Voltar e revisar
          </button>
          <button type="submit" className="primary-button" disabled={pendente} aria-busy={pendente}>
            {pendente ? 'Salvando…' : 'Confirmar e salvar'}
          </button>
        </div>
      </form>
    );
  }

  return (
    <form className="fcd-form fcg-form" onSubmit={aoEnviar} noValidate>
      <h3 className="fcg-titulo" tabIndex={-1} ref={titulo}>
        {editando ? `Editar o grupo ${grupo.nome}` : 'Novo grupo de equivalência'}
      </h3>
      <p className="fcd-dica">
        Agrupe só produtos que são exatamente o mesmo material (nomes ou fontes diferentes). O estoque do grupo é somado
        e pode cobrir a compra de um dos produtos.
      </p>

      <div className="fcd-campo">
        <label className="field-label" htmlFor={id('nome')}>
          Nome do grupo
        </label>
        <input
          ref={refs.nome}
          id={id('nome')}
          className="input"
          maxLength={FORECAST_GRUPO_NOME_MAX}
          autoComplete="off"
          value={nome}
          onChange={(e) => {
            limpar('nome');
            setNome(e.target.value);
          }}
          aria-invalid={erros.nome ? true : undefined}
          aria-describedby={erros.nome ? id('nome-erro') : undefined}
          disabled={pendente}
        />
        <Erro id={id('nome-erro')} texto={erros.nome} />
      </div>

      <fieldset className="fcd-campo" disabled={pendente} aria-describedby={erros.produtos ? id('produtos-erro') : undefined}>
        <legend className="field-label">Produtos do grupo</legend>
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
            <p className="fcd-alert__texto">{forecastGrupoErrorMessage(produtos.error)}</p>
            <button type="button" className="ghost-button" onClick={() => void produtos.refetch()}>
              Tentar de novo
            </button>
          </div>
        )}
        {produtos.isSuccess && (
          <>
            <p className="fcd-dica" role="status">
              {listados.length === 0
                ? 'Nenhum produto livre encontrado.'
                : listados.length > visiveis.length
                  ? `Mostrando ${visiveis.length} de ${listados.length} produtos. Refine a busca para ver os demais.`
                  : `${listados.length} ${plural(listados.length, 'produto', 'produtos')}`}
              {ocupados > 0 &&
                ` · ${ocupados} ${plural(ocupados, 'produto já está', 'produtos já estão')} em outro grupo e ${plural(ocupados, 'não aparece', 'não aparecem')} aqui.`}
            </p>
            <div className="fcd-produtos" role="group" aria-label="Produtos para o grupo">
              {visiveis.map((p, i) => (
                <label key={p.id} className="fcd-produto">
                  <input
                    ref={i === 0 ? refs.produtos : undefined}
                    type="checkbox"
                    checked={escolhidos.includes(p.id)}
                    onChange={() => alternar(p.id)}
                  />
                  <span className="fcd-produto__nome">{p.name}</span>
                  <span className="fcd-produto__fonte">{p.source?.name ?? 'Sem fonte'}</span>
                </label>
              ))}
            </div>
          </>
        )}
        <Erro id={id('produtos-erro')} texto={erros.produtos} />
      </fieldset>

      <fieldset className="fcd-campo" disabled={pendente} aria-describedby={erros.principal ? id('principal-erro') : undefined}>
        <legend className="field-label">
          Selecionados: {escolhidos.length} {plural(escolhidos.length, 'produto', 'produtos')} · produto principal
        </legend>
        {escolhidos.length === 0 ? (
          <p className="fcd-dica">Marque os produtos acima. O principal é o produto pelo qual a compra sai.</p>
        ) : (
          <div className="fcg-selecionados" role="radiogroup" aria-label="Produto principal">
            <label className="fcd-produto">
              <input
                ref={refs.principal}
                type="radio"
                name={id('principal')}
                checked={principal === null}
                onChange={() => {
                  limpar('principal');
                  setPrincipal(null);
                }}
              />
              <span className="fcd-produto__nome">Automático: o de maior média na quinzena</span>
            </label>
            {escolhidos.map((pid) => {
              const outroGrupo = grupoDoProduto.get(pid);
              return (
                <div key={pid} className="fcd-produto fcg-selecionado">
                  <label className="fcg-selecionado__radio">
                    <input
                      type="radio"
                      name={id('principal')}
                      checked={principal === pid}
                      onChange={() => {
                        limpar('principal');
                        setPrincipal(pid);
                      }}
                    />
                    <span className="fcd-produto__nome">
                      {nomeDe(pid)} <span className="sr-only">como produto principal</span>
                    </span>
                  </label>
                  {outroGrupo && <span className="badge badge--warning">Está no grupo {outroGrupo}</span>}
                  <button type="button" className="ghost-button" onClick={() => alternar(pid)} aria-label={`Tirar ${nomeDe(pid)} do grupo`}>
                    Tirar
                  </button>
                </div>
              );
            })}
          </div>
        )}
        <Erro id={id('principal-erro')} texto={erros.principal} />
      </fieldset>

      <div className="fcd-campo">
        <label className="field-label" htmlFor={id('observacao')}>
          Observação (opcional)
        </label>
        <textarea
          ref={refs.observacao}
          id={id('observacao')}
          className="input fcd-motivo"
          rows={2}
          maxLength={FORECAST_GRUPO_OBSERVACAO_MAX}
          value={observacao}
          onChange={(e) => {
            limpar('observacao');
            setObservacao(e.target.value);
          }}
          aria-invalid={erros.observacao ? true : undefined}
          aria-describedby={erros.observacao ? id('observacao-erro') : undefined}
          disabled={pendente}
        />
        <Erro id={id('observacao-erro')} texto={erros.observacao} />
      </div>

      <div className="modal-actions">
        <button type="button" className="ghost-button" onClick={() => onVoltar()} disabled={pendente}>
          Cancelar
        </button>
        <button type="submit" className="primary-button" disabled={pendente}>
          Revisar e salvar
        </button>
      </div>
    </form>
  );
}

function Desfazer({ grupo, onVoltar }: VoltarProps & { grupo: ForecastGrupoEquivalencia }) {
  const atualizar = useAtualizarForecast();
  const titulo = useRef<HTMLHeadingElement>(null);
  useEffect(() => titulo.current?.focus(), []);
  const desfazer = useMutation({
    mutationFn: () => deleteForecastGrupo(grupo.id),
    onSuccess: async () => {
      await atualizar();
      onVoltar(`Grupo ${grupo.nome} desfeito.`);
    },
  });
  return (
    <div className="fcd-form fcg-form">
      <h3 className="fcg-titulo" tabIndex={-1} ref={titulo}>
        Desfazer o grupo {grupo.nome}
      </h3>
      <p className="fcd-dica">
        Os {grupo.membros.length} produtos voltam a ser avaliados separadamente, cada um com o seu próprio estoque. O
        relatório de compras passa a mostrar de novo a necessidade de cada um.
      </p>
      {desfazer.isError && (
        <div className="alert alert--error" role="alert">
          {forecastGrupoErrorMessage(desfazer.error)}
        </div>
      )}
      <div className="modal-actions">
        <button type="button" className="ghost-button" onClick={() => onVoltar()} disabled={desfazer.isPending}>
          Cancelar
        </button>
        <button
          type="button"
          className="danger-button"
          onClick={() => desfazer.mutate()}
          disabled={desfazer.isPending}
          aria-busy={desfazer.isPending}
        >
          {desfazer.isPending ? 'Desfazendo…' : 'Desfazer grupo'}
        </button>
      </div>
    </div>
  );
}

interface ListaProps {
  podeEditar: boolean;
  grupos: ForecastGrupoEquivalencia[];
  onNovo: () => void;
  onEditar: (g: ForecastGrupoEquivalencia) => void;
  onDesfazer: (g: ForecastGrupoEquivalencia) => void;
}

function Lista({ podeEditar, grupos, onNovo, onEditar, onDesfazer }: ListaProps) {
  return (
    <div className="fcd-form fcg-lista-corpo">
      <p className="fcd-dica">
        Produtos que são o mesmo material, com nomes ou fontes diferentes, têm o estoque avaliado somado no relatório de
        compras; a compra sai pelo produto principal.{' '}
        {podeEditar ? '' : 'Só administrador e comprador criam ou alteram grupos.'}
      </p>
      {podeEditar && (
        <div>
          <button type="button" className="primary-button" onClick={onNovo}>
            Novo grupo
          </button>
        </div>
      )}
      {grupos.length === 0 ? (
        <p className="empty-state">Nenhum grupo de equivalência cadastrado.</p>
      ) : (
        <ul className="fcg-lista">
          {grupos.map((g) => {
            const sobDemanda = g.membros.filter((m) => m.sobDemanda && m.id !== g.principalProdutoId);
            return (
              <li key={g.id} className="fcg-grupo">
                <h3 className="fcg-grupo__nome">{g.nome}</h3>
                {g.observacao && <p className="fcd-dica">{g.observacao}</p>}
                <ul className="fcg-membros">
                  {g.membros.map((m) => (
                    <li key={m.id}>
                      <span>{m.nome}</span>
                      <span className="fcd-produto__fonte">{m.fonte ?? 'Sem fonte'}</span>
                      {g.principalProdutoId === m.id && <span className="badge badge--info">Principal</span>}
                      {!m.ativo && <span className="badge badge--muted">Inativo</span>}
                    </li>
                  ))}
                </ul>
                {g.principalProdutoId === null && (
                  <p className="fcd-dica">Sem produto principal: a compra sai pelo membro de maior média na quinzena.</p>
                )}
                {sobDemanda.length > 0 && (
                  <p className="fcd-dica">
                    {sobDemanda.length === 1
                      ? 'Um membro está marcado como compra sob demanda'
                      : `${sobDemanda.length} membros estão marcados como compra sob demanda`}
                    : dentro do grupo essa marca é ignorada (vale a do produto principal).
                  </p>
                )}
                {podeEditar && (
                  <div className="fcg-grupo__acoes" role="group" aria-label={`Ações do grupo ${g.nome}`}>
                    <button type="button" className="ghost-button" onClick={() => onEditar(g)} aria-label={`Editar o grupo ${g.nome}`}>
                      Editar
                    </button>
                    <button type="button" className="ghost-button" onClick={() => onDesfazer(g)} aria-label={`Desfazer o grupo ${g.nome}`}>
                      Desfazer
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default function ForecastGruposModal({ podeEditar, onFechar }: Props) {
  const [modo, setModo] = useState<Modo>({ tipo: 'lista' });
  const [aviso, setAviso] = useState('');
  const grupos = useQuery({ queryKey: forecastGruposKeys.lista, queryFn: listForecastGrupos });
  const voltar = (mensagem?: string) => {
    setAviso(mensagem ?? '');
    setModo({ tipo: 'lista' });
  };

  return (
    <Modal isOpen onClose={onFechar} title="Grupos de equivalência" size="wide">
      {aviso && modo.tipo === 'lista' && (
        <div className="alert alert--success" role="status">
          {aviso}
        </div>
      )}
      {grupos.isLoading && (
        <div className="fcd-carregando" role="status">
          <Spinner /> Carregando grupos…
        </div>
      )}
      {grupos.isError && (
        <div className="alert alert--error" role="alert">
          <p className="fcd-alert__texto">{forecastGrupoErrorMessage(grupos.error)}</p>
          <button type="button" className="ghost-button" onClick={() => void grupos.refetch()}>
            Tentar de novo
          </button>
        </div>
      )}
      {grupos.isSuccess && modo.tipo === 'lista' && (
        <Lista
          podeEditar={podeEditar}
          grupos={grupos.data}
          onNovo={() => {
            setAviso('');
            setModo({ tipo: 'form' });
          }}
          onEditar={(g) => {
            setAviso('');
            setModo({ tipo: 'form', grupo: g });
          }}
          onDesfazer={(g) => {
            setAviso('');
            setModo({ tipo: 'desfazer', grupo: g });
          }}
        />
      )}
      {grupos.isSuccess && modo.tipo === 'form' && podeEditar && (
        <Formulario grupo={modo.grupo} grupos={grupos.data} onVoltar={voltar} />
      )}
      {grupos.isSuccess && modo.tipo === 'desfazer' && podeEditar && <Desfazer grupo={modo.grupo} onVoltar={voltar} />}
      {modo.tipo === 'lista' && (
        <div className="modal-actions">
          <button type="button" className="ghost-button" onClick={onFechar}>
            Fechar
          </button>
        </div>
      )}
    </Modal>
  );
}
