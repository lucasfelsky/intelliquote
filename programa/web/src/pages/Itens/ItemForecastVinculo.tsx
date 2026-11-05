import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Spinner from '@/components/Spinner';
import {
  catalogForecastKeys,
  listProdutosDoForecast,
  situacaoDoCodigo,
  TEXTO_ENTRA_NO_CALCULO,
  type SituacaoDoCodigo,
} from '@/services/catalogForecast';
import { forecastFontesKeys, listForecastSources, type ForecastFonte } from '@/services/forecastFontes';
import {
  FALHA_AO_CARREGAR,
  forecastPendentesErrorMessage,
  forecastPendentesKeys,
  listFamiliasAtivas,
  type ForecastProdutoCadastro,
} from '@/services/forecastPendentes';
import {
  contagemTexto,
  filtrarProdutos,
  fontesAtivas,
  MAX_PRODUTOS_LISTADOS,
  normalizarCodigo,
  produtoCheio,
  rotuloDaFonte,
  semLeadTime,
  TEXTO_AVISO_PLANILHA,
  textoProdutoInativo,
  vagasTexto,
} from '@/pages/Forecast/forecastPendentes';
import { VINCULO_VAZIO, validarVinculo, type FormVinculo, type ValidacaoVinculo } from './itemForecastVinculoForm';

/**
 * Dados que o formulario e o modal usam para validar a escolha. `situacao` e `null` enquanto a lista de produtos
 * nao carregou (o backend decide). As consultas sao as mesmas da secao: o cache evita pedir duas vezes.
 */
export function useDadosDoVinculo(codigo: string, vinculo: FormVinculo) {
  const norm = normalizarCodigo(codigo);
  const produtosQuery = useQuery({
    queryKey: catalogForecastKeys.produtos,
    queryFn: listProdutosDoForecast,
    staleTime: 30_000,
    enabled: norm !== '',
  });
  const fontesQuery = useQuery({
    queryKey: forecastFontesKeys.todas,
    queryFn: listForecastSources,
    staleTime: 30_000,
    enabled: vinculo.modo === 'novo',
  });
  const produtos = produtosQuery.data;
  const situacao: SituacaoDoCodigo | null = produtos && norm !== '' ? situacaoDoCodigo(produtos, norm) : null;
  const produto: ForecastProdutoCadastro | null = produtos?.find((p) => p.id === vinculo.productId) ?? null;
  const fonte: ForecastFonte | null = fontesAtivas(fontesQuery.data ?? []).find((f) => f.id === vinculo.sourceId) ?? null;
  return { produtosQuery, situacao, produto, fonte };
}

/**
 * Estado do vinculo no formulario do item. Editando: so exige a escolha se o codigo mudou (D2: nota/NCM de item
 * legado nao trava); item novo sempre exige; item INATIVO em edicao nao tem vinculo (reativa pelo card).
 */
export function useVinculoDoItem(dbcorpCode: string, editing: { dbcorpCode: string | null; isActive: boolean } | null) {
  const [vinculo, setVinculo] = useState<FormVinculo>(VINCULO_VAZIO);
  const [erro, setErro] = useState<string | null>(null);
  const aplicavel = !editing || editing.isActive;
  const codigoMudou = !editing || normalizarCodigo(dbcorpCode) !== normalizarCodigo(editing.dbcorpCode ?? '');
  const dados = useDadosDoVinculo(aplicavel ? dbcorpCode : '', vinculo);
  const limpar = useCallback(() => {
    setVinculo(VINCULO_VAZIO);
    setErro(null);
  }, []);
  /** Valida a escolha (e mostra o erro na secao). Sem vinculo aplicavel devolve `forecast: null`. */
  function validar(): ValidacaoVinculo {
    if (!aplicavel) return { ok: true, forecast: null, leadTimeDias: null };
    const validacao = validarVinculo(vinculo, {
      codigo: dbcorpCode,
      exigido: codigoMudou,
      situacao: dados.situacao,
      fonte: dados.fonte,
      produto: dados.produto,
    });
    setErro(validacao.ok ? null : validacao.erro);
    return validacao;
  }
  return { vinculo, setVinculo, erro, aplicavel, codigoMudou, limpar, validar };
}

interface Props {
  codigo: string;
  /** Item novo, codigo trocado ou reativacao: a escolha e obrigatoria. Sem isso o titulo diz "(opcional)". */
  exigido: boolean;
  /** Familia do item (pre-seleciona a familia do produto novo, se estiver ativa). */
  familiaDoItem: number | null;
  /** Nome sugerido para o produto novo (nome comercial do item). */
  nomeSugerido: string;
  valor: FormVinculo;
  onChange: (valor: FormVinculo) => void;
  erro?: string | null;
  desabilitado?: boolean;
}

/** Secao "Forecast" do cadastro do item: produto existente (acrescenta o codigo) ou produto novo. Controlada. */
export default function ItemForecastVinculo({
  codigo,
  exigido,
  familiaDoItem,
  nomeSugerido,
  valor,
  onChange,
  erro,
  desabilitado = false,
}: Props) {
  const baseId = useId();
  const [busca, setBusca] = useState('');
  const norm = normalizarCodigo(codigo);
  const { produtosQuery, situacao, produto } = useDadosDoVinculo(codigo, valor);
  const novo = valor.modo === 'novo';
  const fontesQuery = useQuery({
    queryKey: forecastFontesKeys.todas,
    queryFn: listForecastSources,
    staleTime: 30_000,
    enabled: novo,
  });
  const familiasQuery = useQuery({
    queryKey: forecastPendentesKeys.familias,
    queryFn: listFamiliasAtivas,
    staleTime: 30_000,
    enabled: novo,
  });
  const fontes = useMemo(() => fontesAtivas(fontesQuery.data ?? []), [fontesQuery.data]);
  const familias = useMemo(() => familiasQuery.data ?? [], [familiasQuery.data]);
  const fonte = fontes.find((f) => f.id === valor.sourceId) ?? null;

  // Produto novo: o nome vem do item e a familia do item entra pre-selecionada (se estiver ativa), UMA vez por
  // escolha do modo (quem apaga o campo depois nao ve o texto voltar).
  const nomeFeito = useRef(false);
  const familiaFeita = useRef(false);
  useEffect(() => {
    if (!novo) {
      nomeFeito.current = false;
      familiaFeita.current = false;
      return;
    }
    const preencher: Partial<FormVinculo> = {};
    if (!nomeFeito.current) {
      nomeFeito.current = true;
      if (valor.nome === '' && nomeSugerido.trim() !== '') preencher.nome = nomeSugerido.trim();
    }
    if (!familiaFeita.current && familias.length > 0) {
      familiaFeita.current = true;
      if (valor.familyId === null && familiaDoItem !== null && familias.some((f) => f.id === familiaDoItem)) {
        preencher.familyId = familiaDoItem;
      }
    }
    if (Object.keys(preencher).length > 0) onChange({ ...valor, ...preencher });
  }, [novo, valor, nomeSugerido, familiaDoItem, familias, onChange]);

  if (norm === '') return null;
  const id = (campo: string) => `${baseId}-${campo}`;
  const titulo = exigido ? 'Forecast' : 'Forecast (opcional)';

  if (produtosQuery.isLoading) {
    return (
      <div className="fcc-carregando" role="status">
        <Spinner size="sm" />
        <span>Verificando o código no Forecast…</span>
      </div>
    );
  }
  if (produtosQuery.isError) {
    return (
      <div className="alert alert--error" role="alert">
        <p className="fcc-alert__texto">{forecastPendentesErrorMessage(produtosQuery.error, FALHA_AO_CARREGAR)}</p>
        <button type="button" className="ghost-button ghost-button--sm" onClick={() => void produtosQuery.refetch()}>
          Tentar de novo
        </button>
      </div>
    );
  }
  if (situacao?.tipo === 'ativo') {
    return (
      <p className="fcc-dica" role="status">
        Já está no Forecast: produto {situacao.produto.name} ({vagasTexto(situacao.produto)}).
      </p>
    );
  }
  if (situacao?.tipo === 'inativo') {
    return (
      <div className="alert" role="status">
        <p className="fcc-alert__texto">
          {textoProdutoInativo(situacao.produto.name)} O item será salvo sem novo vínculo.
        </p>
      </div>
    );
  }

  const ativos = (produtosQuery.data ?? []).filter((p) => p.isActive);
  const achados = filtrarProdutos(ativos, busca);
  const listados = achados.slice(0, MAX_PRODUTOS_LISTADOS);
  const mudar = (parcial: Partial<FormVinculo>) => onChange({ ...valor, ...parcial });

  return (
    <fieldset className="fcc-campo" disabled={desabilitado}>
      <legend className="field-label">{titulo}</legend>
      <p className="fcc-dica">
        O código <strong>{norm}</strong> não está no Forecast.{' '}
        {exigido
          ? 'Escolha o produto do Forecast ou crie um produto novo para salvar o item.'
          : 'Você pode vinculá-lo agora ou deixar o item fora do Forecast.'}
      </p>
      <div className="fcc-codigo">
        <label className="fcc-produto">
          <input
            type="radio"
            name={id('modo')}
            checked={valor.modo === 'existente'}
            onChange={() => mudar({ modo: 'existente' })}
          />
          <span className="fcc-produto__nome">Produto existente</span>
        </label>
        <label className="fcc-produto">
          <input type="radio" name={id('modo')} checked={novo} onChange={() => mudar({ modo: 'novo' })} />
          <span className="fcc-produto__nome">Criar produto novo</span>
        </label>
      </div>

      {valor.modo === 'existente' && (
        <>
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
          />
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
                    checked={valor.productId === p.id}
                    onChange={() => mudar({ productId: p.id })}
                    disabled={cheio}
                  />
                  <span className="fcc-produto__nome">{p.name}</span>
                  <span className="fcc-produto__vagas">{cheio ? `${vagasTexto(p)} · cheio` : vagasTexto(p)}</span>
                </label>
              );
            })}
          </div>
          {produto && produto.origin === 'planilha' && (
            <p className="fcc-dica" role="status">
              Este produto vem da planilha. {TEXTO_AVISO_PLANILHA}
            </p>
          )}
        </>
      )}

      {novo && (
        <>
          <label className="field-label" htmlFor={id('nome')}>
            Nome do produto
          </label>
          <input
            id={id('nome')}
            className="input"
            maxLength={200}
            autoComplete="off"
            value={valor.nome}
            onChange={(e) => mudar({ nome: e.target.value })}
          />
          <label className="field-label" htmlFor={id('fonte')}>
            Fonte
          </label>
          <select
            id={id('fonte')}
            className="select"
            value={valor.sourceId ?? ''}
            onChange={(e) => mudar({ sourceId: e.target.value === '' ? null : Number(e.target.value), leadTimeTexto: '' })}
          >
            <option value="">Escolha a fonte</option>
            {fontes.map((f) => (
              <option key={f.id} value={f.id}>
                {rotuloDaFonte(f)}
              </option>
            ))}
          </select>
          {fonte && semLeadTime(fonte) && (
            <>
              <label className="field-label" htmlFor={id('leadtime')}>
                Lead time da fonte (dias)
              </label>
              <input
                id={id('leadtime')}
                className="input fcc-input-curto"
                inputMode="numeric"
                autoComplete="off"
                value={valor.leadTimeTexto}
                onChange={(e) => mudar({ leadTimeTexto: e.target.value })}
              />
              <p className="fcc-dica">
                Esta fonte não tem lead time. O valor é gravado na fonte e vale até o próximo import da planilha, que
                pode sobrescrevê-lo.
              </p>
            </>
          )}
          <label className="field-label" htmlFor={id('familia')}>
            Família do produto
          </label>
          <select
            id={id('familia')}
            className="select"
            value={valor.familyId ?? ''}
            onChange={(e) => mudar({ familyId: e.target.value === '' ? null : Number(e.target.value) })}
          >
            <option value="">Escolha a família</option>
            {familias.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
          {(fontesQuery.isError || familiasQuery.isError) && (
            <div className="alert alert--error" role="alert">
              {forecastPendentesErrorMessage(fontesQuery.error ?? familiasQuery.error, FALHA_AO_CARREGAR)}
            </div>
          )}
        </>
      )}

      {valor.modo !== null && <p className="fcc-dica">{TEXTO_ENTRA_NO_CALCULO}</p>}
      {erro && (
        <div className="alert alert--error" role="alert">
          {erro}
        </div>
      )}
    </fieldset>
  );
}
