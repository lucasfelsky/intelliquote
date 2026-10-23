import { useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/components/Modal';
import Spinner from '@/components/Spinner';
import {
  forecastEmbalagensErrorMessage,
  forecastEmbalagensKeys,
  getForecastEmbalagens,
  patchForecastEmbalagens,
  type ForecastEmbalagemCodigo,
  type ForecastEmbalagens,
  type ForecastEmbalagensPatch,
} from '@/services/forecastEmbalagens';
import { dataBr, kgBr } from './forecastPainel';
import { erroDoPallet, lerPalletKg, lerQuantidadeKg, montarPatch, quantidadeParaCampo } from './forecastEmbalagens';

interface Props {
  productId: number;
  /** admin/comprador editam; os demais papeis COMEX so consultam. */
  podeEditar: boolean;
  onFechar: () => void;
}

const ORIGEM_ROTULO = { manual: 'manual', dbcorp: 'DBCorp' } as const;

function origemTexto(c: ForecastEmbalagemCodigo): string {
  if (!c.origem) return '—';
  return c.atualizadoEm ? `${ORIGEM_ROTULO[c.origem]} · ${dataBr(c.atualizadoEm)}` : ORIGEM_ROTULO[c.origem];
}

// Valor lido do campo de pallet (vazio = sem pallet); invalido nunca chega aqui (bloqueia o Salvar antes).
const palletValor = (lida: ReturnType<typeof lerPalletKg> | undefined): number | null =>
  lida?.ok ? lida.valor : null;

function CodigoCelula({ c, usada }: { c: ForecastEmbalagemCodigo; usada: boolean }) {
  return (
    <span className="fce-codigo">
      <span>{c.codigo}</span>
      {usada && <span className="badge badge--info">Usada no relatório</span>}
    </span>
  );
}

function Leitura({ dados }: { dados: ForecastEmbalagens }) {
  return (
    <div className="fce-scroll" role="region" tabIndex={0} aria-label="Embalagens por código">
      <table className="fce-tabela">
        <caption className="sr-only">Embalagens cadastradas por código do produto</caption>
        <thead>
          <tr>
            <th scope="col">Posição</th>
            <th scope="col">Código</th>
            <th scope="col" className="fce-num">
              Quantidade (kg)
            </th>
            <th scope="col" className="fce-num">
              Pallet (kg)
            </th>
            <th scope="col">Rótulo</th>
            <th scope="col">Principal</th>
            <th scope="col">Origem</th>
          </tr>
        </thead>
        <tbody>
          {dados.codigos.map((c) => (
            <tr key={c.id}>
              <th scope="row">EMB.{c.posicao}</th>
              <td>
                <CodigoCelula c={c} usada={c.id === dados.usadaCodigoId} />
              </td>
              <td className="fce-num">{c.quantidadeKg === null ? '—' : `${kgBr(c.quantidadeKg)} kg`}</td>
              <td className="fce-num">{c.palletKg == null ? '—' : `${kgBr(c.palletKg)} kg`}</td>
              <td>{c.rotulo ?? '—'}</td>
              <td>{c.principal ? 'Sim' : '—'}</td>
              <td className="fce-origem">{origemTexto(c)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface FormProps {
  dados: ForecastEmbalagens;
  pendente: boolean;
  erro: string | null;
  salvo: boolean;
  onSalvar: (patch: ForecastEmbalagensPatch) => void;
  onFechar: () => void;
}

function Formulario({ dados, pendente, erro, salvo, onSalvar, onFechar }: FormProps) {
  const baseId = useId();
  const [textos, setTextos] = useState<Record<number, string>>(() =>
    Object.fromEntries(dados.codigos.map((c) => [c.id, quantidadeParaCampo(c.quantidadeKg)])),
  );
  const [pallets, setPallets] = useState<Record<number, string>>(() =>
    Object.fromEntries(dados.codigos.map((c) => [c.id, quantidadeParaCampo(c.palletKg ?? null)])),
  );
  const [rotulos, setRotulos] = useState<Record<number, string>>(() =>
    Object.fromEntries(dados.codigos.map((c) => [c.id, c.rotulo ?? ''])),
  );
  const [principalEscolhida, setPrincipalEscolhida] = useState<number | null>(
    () => dados.codigos.find((c) => c.principal)?.id ?? null,
  );

  const lidas = dados.codigos.map((c) => ({ c, lida: lerQuantidadeKg(textos[c.id] ?? '') }));
  const quantidadePorId = new Map(lidas.map((l) => [l.c.id, l.lida.ok ? l.lida.valor : undefined] as const));
  // Pallet: so vale com quantidade valida; o erro (formato ou "nao e multiplo") aparece no proprio campo.
  const palletsLidos = new Map(
    dados.codigos.map((c) => {
      const lida = lerPalletKg(pallets[c.id] ?? '');
      const quantidade = quantidadePorId.get(c.id);
      const erro = !lida.ok
        ? lida.erro
        : typeof quantidade === 'number' && lida.valor !== null
          ? erroDoPallet(quantidade, lida.valor)
          : null;
      return [c.id, { lida, erro }] as const;
    }),
  );
  const temErro = lidas.some((l) => !l.lida.ok) || [...palletsLidos.values()].some((p) => p.erro !== null);
  // A principal precisa de quantidade: sem ela (campo vazio ou invalido) deixa de valer.
  const principal =
    principalEscolhida !== null && typeof quantidadePorId.get(principalEscolhida) === 'number'
      ? principalEscolhida
      : null;
  const patch = temErro
    ? null
    : montarPatch(dados, {
        codigos: lidas.map(({ c, lida }) => ({
          codigoId: c.id,
          quantidadeKg: lida.ok ? lida.valor : c.quantidadeKg,
          rotulo: rotulos[c.id] ?? null,
          // Sem quantidade o pallet some junto (o servidor tambem apaga).
          palletKg: !lida.ok || lida.valor === null ? null : palletValor(palletsLidos.get(c.id)?.lida),
        })),
        principalCodigoId: principal,
      });

  return (
    <form
      className="fce-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (patch && !pendente) onSalvar(patch);
      }}
    >
      <div className="fce-scroll" role="region" tabIndex={0} aria-label="Embalagens por código">
        <table className="fce-tabela">
          <caption className="sr-only">Editar as embalagens cadastradas por código do produto</caption>
          <thead>
            <tr>
              <th scope="col">Posição</th>
              <th scope="col">Código</th>
              <th scope="col" className="fce-num">
                Quantidade (kg)
              </th>
              <th scope="col" className="fce-num">
                Pallet (kg)
              </th>
              <th scope="col">Rótulo</th>
              <th scope="col">Principal</th>
              <th scope="col">Origem</th>
            </tr>
          </thead>
          <tbody>
            {lidas.map(({ c, lida }) => {
              const erroId = `${baseId}-erro-${c.id}`;
              const erroPalletId = `${baseId}-erro-pallet-${c.id}`;
              const erroPallet = palletsLidos.get(c.id)?.erro ?? null;
              const semQuantidade = typeof quantidadePorId.get(c.id) !== 'number';
              return (
                <tr key={c.id}>
                  <th scope="row">EMB.{c.posicao}</th>
                  <td>
                    <CodigoCelula c={c} usada={c.id === dados.usadaCodigoId} />
                  </td>
                  <td className="fce-num">
                    <input
                      className="input fce-input-qtd"
                      inputMode="decimal"
                      autoComplete="off"
                      value={textos[c.id] ?? ''}
                      onChange={(e) => setTextos((t) => ({ ...t, [c.id]: e.target.value }))}
                      aria-label={`Quantidade em kg do código ${c.codigo}`}
                      aria-invalid={!lida.ok}
                      aria-describedby={!lida.ok ? erroId : undefined}
                      disabled={pendente}
                    />
                    {!lida.ok && (
                      <p className="fce-erro" id={erroId}>
                        {lida.erro}
                      </p>
                    )}
                  </td>
                  <td className="fce-num">
                    <input
                      className="input fce-input-qtd"
                      inputMode="decimal"
                      autoComplete="off"
                      value={semQuantidade ? '' : (pallets[c.id] ?? '')}
                      onChange={(e) => setPallets((p) => ({ ...p, [c.id]: e.target.value }))}
                      aria-label={`Pallet em kg do código ${c.codigo}`}
                      aria-invalid={erroPallet !== null}
                      aria-describedby={erroPallet !== null ? erroPalletId : undefined}
                      disabled={pendente || semQuantidade}
                    />
                    {erroPallet !== null && (
                      <p className="fce-erro" id={erroPalletId}>
                        {erroPallet}
                      </p>
                    )}
                  </td>
                  <td>
                    <input
                      className="input fce-input-rotulo"
                      maxLength={60}
                      autoComplete="off"
                      value={rotulos[c.id] ?? ''}
                      onChange={(e) => setRotulos((r) => ({ ...r, [c.id]: e.target.value }))}
                      aria-label={`Rótulo do código ${c.codigo}`}
                      disabled={pendente}
                    />
                  </td>
                  <td>
                    <input
                      type="radio"
                      name="fce-principal"
                      checked={principal === c.id}
                      onChange={() => setPrincipalEscolhida(c.id)}
                      aria-label={`Principal: código ${c.codigo}`}
                      disabled={pendente || semQuantidade}
                    />
                  </td>
                  <td className="fce-origem">{origemTexto(c)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <label className="checkbox-field fce-nenhuma">
        <input
          type="radio"
          name="fce-principal"
          checked={principal === null}
          onChange={() => setPrincipalEscolhida(null)}
          disabled={pendente}
        />
        Nenhuma (usa o primeiro código)
      </label>
      <p className="fce-dica">
        Pallet = kg de UM pallet fechado da embalagem (ex.: 24 bombonas de 25 kg = 600 kg), sempre múltiplo da
        embalagem. O relatório mostra os pallets fechados abaixo e acima da quantidade sugerida.
      </p>
      <p className="fce-dica">
        Valor editado manualmente pode ser substituído quando a integração com o DBCorp estiver ativa.
      </p>
      {erro && (
        <div className="alert alert--error" role="alert">
          {erro}
        </div>
      )}
      {salvo && !erro && !patch && (
        <div className="alert alert--success" role="status">
          Embalagens salvas. O relatório foi atualizado.
        </div>
      )}
      <div className="modal-actions">
        <button type="button" className="ghost-button" onClick={onFechar}>
          Cancelar
        </button>
        <button type="submit" className="primary-button" disabled={!patch || pendente} aria-busy={pendente}>
          {pendente ? 'Salvando…' : 'Salvar embalagens'}
        </button>
      </div>
    </form>
  );
}

function Corpo({ productId, podeEditar, onFechar }: Props) {
  const queryClient = useQueryClient();
  const [salvo, setSalvo] = useState(false);
  const consulta = useQuery({
    queryKey: forecastEmbalagensKeys.produto(productId),
    queryFn: () => getForecastEmbalagens(productId),
    // A embalagem e do cadastro e muda fora desta tela (outra pessoa, gateway): sempre le ao abrir.
    staleTime: 0,
  });
  const gravar = useMutation({
    mutationFn: (patch: ForecastEmbalagensPatch) => patchForecastEmbalagens(productId, patch),
    onSuccess: (resposta) => {
      setSalvo(true);
      queryClient.setQueryData(forecastEmbalagensKeys.produto(productId), resposta);
      // A embalagem e do cadastro ATUAL: vale para o relatorio de todas as quinzenas. A quinzena calculada
      // (['forecast', 'snapshot', ...]) nao contem embalagem e nao precisa ser refeita.
      void queryClient.invalidateQueries({ queryKey: ['forecast', 'relatorio'] });
      void queryClient.invalidateQueries({ queryKey: forecastEmbalagensKeys.todas });
    },
  });

  if (consulta.isLoading) return <Spinner />;
  if (consulta.isError || !consulta.data) {
    return (
      <>
        <div className="alert alert--error" role="alert">
          {forecastEmbalagensErrorMessage(consulta.error)}
        </div>
        <div className="modal-actions">
          <button type="button" className="ghost-button" onClick={onFechar}>
            Fechar
          </button>
        </div>
      </>
    );
  }
  const dados = consulta.data;

  return (
    <div className="fce-modal">
      <div className="fce-cabecalho">
        <p className="fce-produto">{dados.produto.nome}</p>
        {dados.produto.naoFraciona && <span className="badge badge--warning">Não fraciona</span>}
        {!dados.produto.ativo && <span className="badge badge--muted">Produto inativo no cadastro</span>}
      </div>
      {dados.produto.embalagemPlanilha && (
        <p className="fce-dica">Na planilha (coluna AW): {dados.produto.embalagemPlanilha}</p>
      )}
      <p className="fce-regra">
        Vale para todas as quinzenas: o relatório usa a embalagem do cadastro atual. Com mais de uma, usa a principal;
        sem principal, a do primeiro código.
      </p>
      {podeEditar ? (
        <Formulario
          key={JSON.stringify(dados.codigos)}
          dados={dados}
          pendente={gravar.isPending}
          erro={gravar.isError ? forecastEmbalagensErrorMessage(gravar.error) : null}
          salvo={salvo}
          onSalvar={(patch) => {
            setSalvo(false);
            gravar.mutate(patch);
          }}
          onFechar={onFechar}
        />
      ) : (
        <>
          <Leitura dados={dados} />
          <p className="fce-dica">Somente admin e comprador editam embalagens.</p>
          <div className="modal-actions">
            <button type="button" className="primary-button" onClick={onFechar}>
              Fechar
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default function ForecastEmbalagensModal(props: Props) {
  return (
    <Modal isOpen onClose={props.onFechar} title="Embalagens do item" size="wide">
      <Corpo {...props} />
    </Modal>
  );
}
