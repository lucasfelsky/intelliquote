import { useId, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/components/Modal';
import Spinner from '@/components/Spinner';
import { Tab, TabList, TabPanel, Tabs } from '@/components/Tabs';
import {
  forecastFontesKeys,
  listForecastSources,
  patchForecastSourceLeadTime,
  type ForecastFonte,
} from '@/services/forecastFontes';
import {
  addForecastProductCode,
  createForecastProduct,
  FALHA_AO_CARREGAR,
  forecastPendentesErrorMessage,
  forecastPendentesKeys,
  listFamiliasAtivas,
  listProdutosAtivos,
  type ForecastProdutoCadastro,
} from '@/services/forecastPendentes';
import {
  filtrarProdutos,
  fontesAtivas,
  MAX_CODIGOS_POR_PRODUTO,
  MAX_PRODUTOS_LISTADOS,
  primeiroCampoComErro,
  produtoCheio,
  rotuloDaFonte,
  semLeadTime,
  TEXTO_AVISO_PLANILHA,
  validarNovoProduto,
  vagasTexto,
  contagemTexto,
  type CampoNovoProduto,
  type ErrosNovoProduto,
} from './forecastPendentes';

/** O que o chamador precisa saber para dar o retorno ao usuario (mensagem e aviso da planilha). */
export interface ResultadoCadastro {
  tipo: 'novo' | 'codigo';
  /** So em `codigo`: 'planilha' | 'dbcorp' (origem do produto que recebeu o codigo). */
  produtoOrigem?: string;
}

interface Props {
  /** Codigo pendente que originou a acao (vem pre-preenchido). */
  codigo: string;
  /** codigo (maiusculas) -> nome do produto INATIVO conhecido; o formulario avisa antes de o backend recusar (409). */
  inativos?: Readonly<Record<string, string>>;
  onFechar: () => void;
  onConcluido: (resultado: ResultadoCadastro) => void;
}

type Aba = 'novo' | 'existente';

function Carregando({ texto }: { texto: string }) {
  return (
    <div className="fcc-carregando" role="status">
      <Spinner size="sm" />
      <span>{texto}</span>
    </div>
  );
}

function ErroDeLista({ mensagem, onTentar }: { mensagem: string; onTentar: () => void }) {
  return (
    <div className="alert alert--error" role="alert">
      <p className="fcc-alert__texto">{mensagem}</p>
      <button type="button" className="ghost-button ghost-button--sm" onClick={onTentar}>
        Tentar de novo
      </button>
    </div>
  );
}

function ErroDeCampo({ id, texto }: { id: string; texto?: string }) {
  return texto ? (
    <p className="fcc-erro" id={id}>
      {texto}
    </p>
  ) : null;
}

// ---------- aba: novo produto ----------

function NovoProduto({ codigo, inativos, onFechar, onConcluido }: Props) {
  const queryClient = useQueryClient();
  const baseId = useId();
  const [nome, setNome] = useState('');
  const [codigos, setCodigos] = useState<string[]>([codigo]);
  const [sourceId, setSourceId] = useState<number | null>(null);
  const [familyId, setFamilyId] = useState<number | null>(null);
  const [leadTimeTexto, setLeadTimeTexto] = useState('');
  const [erros, setErros] = useState<ErrosNovoProduto>({});
  const [erroServidor, setErroServidor] = useState('');
  const leadTimeGravado = useRef(false);
  const refs = {
    nome: useRef<HTMLInputElement>(null),
    codigos: useRef<HTMLInputElement>(null),
    fonte: useRef<HTMLSelectElement>(null),
    leadTime: useRef<HTMLInputElement>(null),
    familia: useRef<HTMLSelectElement>(null),
  };

  const fontesQuery = useQuery({ queryKey: forecastFontesKeys.todas, queryFn: listForecastSources, staleTime: 30_000 });
  const familiasQuery = useQuery({
    queryKey: forecastPendentesKeys.familias,
    queryFn: listFamiliasAtivas,
    staleTime: 30_000,
  });
  const fontes = fontesAtivas(fontesQuery.data ?? []);
  const fonte: ForecastFonte | null = fontes.find((f) => f.id === sourceId) ?? null;
  const precisaLeadTime = fonte !== null && semLeadTime(fonte);

  const gravar = useMutation({
    gcTime: 0,
    mutationFn: async (entrada: { corpo: Parameters<typeof createForecastProduct>[0]; leadTimeDias: number | null }) => {
      leadTimeGravado.current = false;
      // O lead time pertence a FONTE: grava antes do produto (o backend recusa fonte sem lead time).
      if (entrada.leadTimeDias !== null) {
        await patchForecastSourceLeadTime(entrada.corpo.sourceId, entrada.leadTimeDias);
        leadTimeGravado.current = true;
        await queryClient.invalidateQueries({ queryKey: forecastFontesKeys.todas });
      }
      return createForecastProduct(entrada.corpo);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['forecast'] });
      onConcluido({ tipo: 'novo' });
    },
    onError: (err) => {
      const mensagem = forecastPendentesErrorMessage(err);
      setErroServidor(
        leadTimeGravado.current
          ? `O lead time da fonte foi gravado, mas o produto não foi cadastrado. ${mensagem}`
          : mensagem,
      );
    },
  });

  // O erro de um campo some assim que ele muda (o proximo envio valida de novo).
  const limpar = (campo: CampoNovoProduto) => setErros((e) => (e[campo] ? { ...e, [campo]: undefined } : e));
  const alterarCodigo = (indice: number, valor: string) => {
    limpar('codigos');
    setCodigos((atual) => atual.map((c, i) => (i === indice ? valor : c)));
  };

  function aoEnviar(e: FormEvent) {
    e.preventDefault();
    if (gravar.isPending) return;
    setErroServidor('');
    const validacao = validarNovoProduto({ nome, codigos, sourceId, familyId, leadTimeTexto }, fonte, inativos);
    if (!validacao.ok) {
      setErros(validacao.erros);
      const primeiro = primeiroCampoComErro(validacao.erros);
      if (primeiro) refs[primeiro].current?.focus();
      return;
    }
    setErros({});
    gravar.mutate({ corpo: validacao.corpo, leadTimeDias: validacao.leadTimeDias });
  }

  const carregando = fontesQuery.isLoading || familiasQuery.isLoading;
  if (carregando) return <Carregando texto="Carregando fontes e famílias…" />;
  if (fontesQuery.isError || familiasQuery.isError) {
    return (
      <ErroDeLista
        mensagem={forecastPendentesErrorMessage(fontesQuery.error ?? familiasQuery.error, FALHA_AO_CARREGAR)}
        onTentar={() => {
          void fontesQuery.refetch();
          void familiasQuery.refetch();
        }}
      />
    );
  }
  const familias = familiasQuery.data ?? [];
  if (fontes.length === 0 || familias.length === 0) {
    return (
      <div className="fcc-vazio" role="status">
        {fontes.length === 0
          ? 'Não há fonte ativa no cadastro. Importe a planilha do Forecast para cadastrar as fontes antes de criar o produto.'
          : 'Não há família ativa. Cadastre a família em “Famílias” antes de criar o produto.'}
      </div>
    );
  }

  const id = (campo: string) => `${baseId}-${campo}`;
  const descricao = (campo: CampoNovoProduto, extra?: string) =>
    [erros[campo] ? id(`${campo}-erro`) : '', extra ?? ''].filter(Boolean).join(' ') || undefined;

  return (
    <form className="fcc-form" onSubmit={aoEnviar} noValidate>
      <div className="fcc-campo">
        <label className="field-label" htmlFor={id('nome')}>
          Nome do produto
        </label>
        <input
          ref={refs.nome}
          id={id('nome')}
          className="input"
          maxLength={200}
          autoComplete="off"
          value={nome}
          onChange={(e) => {
            limpar('nome');
            setNome(e.target.value);
          }}
          aria-invalid={erros.nome ? true : undefined}
          aria-describedby={descricao('nome')}
          disabled={gravar.isPending}
        />
        <ErroDeCampo id={id('nome-erro')} texto={erros.nome} />
      </div>

      <fieldset className="fcc-campo fcc-codigos" aria-describedby={descricao('codigos', id('codigos-dica'))} disabled={gravar.isPending}>
        <legend className="field-label">Códigos do produto</legend>
        <p className="fcc-dica" id={id('codigos-dica')}>
          Até {MAX_CODIGOS_POR_PRODUTO} códigos DBCorp. O código pendente já está preenchido.
        </p>
        {codigos.map((valor, indice) => (
          <div className="fcc-codigo" key={indice}>
            <label className="sr-only" htmlFor={id(`codigo-${indice}`)}>
              {`Código ${indice + 1}`}
            </label>
            <input
              ref={indice === 0 ? refs.codigos : undefined}
              id={id(`codigo-${indice}`)}
              className="input"
              maxLength={40}
              autoComplete="off"
              value={valor}
              onChange={(e) => alterarCodigo(indice, e.target.value)}
              aria-invalid={erros.codigos ? true : undefined}
            />
            {codigos.length > 1 && (
              <button
                type="button"
                className="ghost-button ghost-button--sm"
                onClick={() => {
                  limpar('codigos');
                  setCodigos((atual) => atual.filter((_, i) => i !== indice));
                }}
                aria-label={`Remover código ${indice + 1}`}
              >
                Remover
              </button>
            )}
          </div>
        ))}
        <ErroDeCampo id={id('codigos-erro')} texto={erros.codigos} />
        <div>
          <button
            type="button"
            className="ghost-button ghost-button--sm"
            onClick={() => setCodigos((atual) => [...atual, ''])}
            disabled={codigos.length >= MAX_CODIGOS_POR_PRODUTO}
          >
            Adicionar outro código
          </button>
        </div>
      </fieldset>

      <div className="fcc-campo">
        <label className="field-label" htmlFor={id('fonte')}>
          Fonte
        </label>
        <select
          ref={refs.fonte}
          id={id('fonte')}
          className="select"
          value={sourceId ?? ''}
          onChange={(e) => {
            limpar('fonte');
            limpar('leadTime');
            setSourceId(e.target.value === '' ? null : Number(e.target.value));
          }}
          aria-invalid={erros.fonte ? true : undefined}
          aria-describedby={descricao('fonte')}
          disabled={gravar.isPending}
        >
          <option value="">Escolha a fonte</option>
          {fontes.map((f) => (
            <option key={f.id} value={f.id}>
              {rotuloDaFonte(f)}
            </option>
          ))}
        </select>
        <ErroDeCampo id={id('fonte-erro')} texto={erros.fonte} />
      </div>

      {precisaLeadTime && (
        <div className="fcc-campo">
          <label className="field-label" htmlFor={id('leadtime')}>
            Lead time da fonte (dias)
          </label>
          <input
            ref={refs.leadTime}
            id={id('leadtime')}
            className="input fcc-input-curto"
            inputMode="numeric"
            autoComplete="off"
            value={leadTimeTexto}
            onChange={(e) => {
              limpar('leadTime');
              setLeadTimeTexto(e.target.value);
            }}
            aria-invalid={erros.leadTime ? true : undefined}
            aria-describedby={descricao('leadTime', id('leadtime-dica'))}
            disabled={gravar.isPending}
          />
          <p className="fcc-dica" id={id('leadtime-dica')}>
            Esta fonte não tem lead time. O valor é gravado na fonte e vale até o próximo import da planilha, que pode
            sobrescrevê-lo.
          </p>
          <ErroDeCampo id={id('leadtime-erro')} texto={erros.leadTime} />
        </div>
      )}

      <div className="fcc-campo">
        <label className="field-label" htmlFor={id('familia')}>
          Família
        </label>
        <select
          ref={refs.familia}
          id={id('familia')}
          className="select"
          value={familyId ?? ''}
          onChange={(e) => {
            limpar('familia');
            setFamilyId(e.target.value === '' ? null : Number(e.target.value));
          }}
          aria-invalid={erros.familia ? true : undefined}
          aria-describedby={descricao('familia')}
          disabled={gravar.isPending}
        >
          <option value="">Escolha a família</option>
          {familias.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
        <ErroDeCampo id={id('familia-erro')} texto={erros.familia} />
      </div>

      {erroServidor && (
        <div className="alert alert--error" role="alert">
          {erroServidor}
        </div>
      )}
      <div className="modal-actions">
        <button type="button" className="ghost-button" onClick={onFechar} disabled={gravar.isPending}>
          Cancelar
        </button>
        <button type="submit" className="primary-button" disabled={gravar.isPending} aria-busy={gravar.isPending}>
          {gravar.isPending ? 'Cadastrando…' : 'Cadastrar produto'}
        </button>
      </div>
    </form>
  );
}

// ---------- aba: produto existente ----------

function ProdutoExistente({ codigo, onFechar, onConcluido }: Props) {
  const queryClient = useQueryClient();
  const baseId = useId();
  const [busca, setBusca] = useState('');
  const [escolhido, setEscolhido] = useState<number | null>(null);
  const [erroServidor, setErroServidor] = useState('');
  const produtosQuery = useQuery({
    queryKey: forecastPendentesKeys.produtos,
    queryFn: listProdutosAtivos,
    staleTime: 30_000,
  });

  const gravar = useMutation({
    gcTime: 0,
    mutationFn: (productId: number) => addForecastProductCode(productId, codigo),
    onSuccess: (resposta) => {
      void queryClient.invalidateQueries({ queryKey: ['forecast'] });
      onConcluido({ tipo: 'codigo', produtoOrigem: resposta.produtoOrigem });
    },
    onError: (err) => setErroServidor(forecastPendentesErrorMessage(err)),
  });

  if (produtosQuery.isLoading) return <Carregando texto="Carregando produtos…" />;
  if (produtosQuery.isError) {
    return (
      <ErroDeLista
        mensagem={forecastPendentesErrorMessage(produtosQuery.error, FALHA_AO_CARREGAR)}
        onTentar={() => void produtosQuery.refetch()}
      />
    );
  }
  const todos = produtosQuery.data ?? [];
  if (todos.length === 0) {
    return (
      <div className="fcc-vazio" role="status">
        Não há produto ativo no cadastro. Crie um produto novo na outra aba.
      </div>
    );
  }

  const achados = filtrarProdutos(todos, busca);
  const listados = achados.slice(0, MAX_PRODUTOS_LISTADOS);
  const produto: ForecastProdutoCadastro | null = todos.find((p) => p.id === escolhido) ?? null;
  const id = (campo: string) => `${baseId}-${campo}`;

  return (
    <form
      className="fcc-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!produto || produtoCheio(produto) || gravar.isPending) return;
        setErroServidor('');
        gravar.mutate(produto.id);
      }}
    >
      <p className="fcc-dica">
        O código <strong>{codigo}</strong> será acrescentado ao produto escolhido, na primeira posição livre e sem
        embalagem.
      </p>
      <div className="fcc-campo">
        <label className="field-label" htmlFor={id('busca')}>
          Buscar produto por nome ou código
        </label>
        <input
          id={id('busca')}
          className="input"
          type="search"
          autoComplete="off"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          disabled={gravar.isPending}
        />
      </div>
      <fieldset className="fcc-campo fcc-produtos" disabled={gravar.isPending}>
        <legend className="field-label">Produto</legend>
        <p className="fcc-dica" role="status">
          {achados.length === 0
            ? 'Nenhum produto encontrado.'
            : achados.length > listados.length
              ? `Mostrando ${listados.length} de ${achados.length} produtos. Refine a busca para ver os demais.`
              : contagemTexto(achados.length, 'produto', 'produtos')}
        </p>
        <div className="fcc-produtos__lista">
          {listados.map((p) => {
            const cheio = produtoCheio(p);
            return (
              <label key={p.id} className={`fcc-produto${cheio ? ' fcc-produto--cheio' : ''}`}>
                <input
                  type="radio"
                  name={id('produto')}
                  checked={escolhido === p.id}
                  onChange={() => setEscolhido(p.id)}
                  disabled={cheio}
                />
                <span className="fcc-produto__nome">{p.name}</span>
                <span className="fcc-produto__vagas">{cheio ? `${vagasTexto(p)} · cheio` : vagasTexto(p)}</span>
              </label>
            );
          })}
        </div>
      </fieldset>
      {produto && produto.origin === 'planilha' && (
        <p className="fcc-dica" role="status">
          Este produto vem da planilha. {TEXTO_AVISO_PLANILHA}
        </p>
      )}
      {erroServidor && (
        <div className="alert alert--error" role="alert">
          {erroServidor}
        </div>
      )}
      <div className="modal-actions">
        <button type="button" className="ghost-button" onClick={onFechar} disabled={gravar.isPending}>
          Cancelar
        </button>
        <button
          type="submit"
          className="primary-button"
          disabled={!produto || produtoCheio(produto) || gravar.isPending}
          aria-busy={gravar.isPending}
        >
          {gravar.isPending ? 'Acrescentando…' : 'Acrescentar código'}
        </button>
      </div>
    </form>
  );
}

// ---------- dialogo ----------

function Corpo(props: Props) {
  const [aba, setAba] = useState<Aba>('novo');
  return (
    <div className="fcc-modal">
      <p className="fcc-codigo-pendente">
        Código pendente: <strong>{props.codigo}</strong>
      </p>
      <p className="fcc-dica">
        O produto entra no cálculo a partir da próxima pré-visualização ou quinzena importada. A quinzena já gravada não
        muda.
      </p>
      <Tabs value={aba} onValueChange={(v) => (v === 'novo' || v === 'existente') && setAba(v)} baseId="fcc">
        <TabList aria-label="Como completar o cadastro">
          <Tab value="novo">Novo produto</Tab>
          <Tab value="existente">Adicionar a produto existente</Tab>
        </TabList>
        <TabPanel value="novo">
          <NovoProduto {...props} />
        </TabPanel>
        <TabPanel value="existente">
          <ProdutoExistente {...props} />
        </TabPanel>
      </Tabs>
    </div>
  );
}

/** Dialogo "Completar cadastro" de um codigo pendente (sem cadastro). Admin e comprador. */
export default function ForecastCompletarCadastroModal(props: Props) {
  return (
    <Modal isOpen onClose={props.onFechar} title="Completar cadastro" size="wide">
      <Corpo {...props} />
    </Modal>
  );
}
