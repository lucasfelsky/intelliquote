import { Icon } from '@/components/icons';
import type { ForecastItemRelatorio } from '@/services/forecast';
import { moedaBr, type PrecoFechadoDoItem } from '@/services/forecastPrecoFechado';
import { useCriarCotacao } from './ForecastCriarCotacao';
import { dataBr } from './forecastPainel';

// Preco fechado na linha do Relatorio de compras. Todo perfil ve o SELO (vem da planilha, congelado na quinzena); quem edita
// (admin/comprador, via o provedor da cotacao) ve tambem o valor, os termos e o estado do cadastro atual.

function textoDoTermo(p: PrecoFechadoDoItem): string {
  return `${p.incoterm ?? ''} · válido até ${dataBr(p.validoAte)}`.replace(/^ · /, '');
}

/** Selo na celula Item. Sem `precoFixo` na linha nao mostra nada. */
export function SeloPrecoFechado({ item }: { item: ForecastItemRelatorio }) {
  const ctx = useCriarCotacao();
  if (item.precoFixo !== true) return null;
  const preco = ctx && item.productId != null ? ctx.precoFechado(item.productId) : undefined;
  if (!preco) {
    return (
      <span className="badge badge--info" title="Item de preço fechado (coluna AV da planilha)">
        Preço fechado
      </span>
    );
  }
  if (preco.estado === 'sem_valor') {
    return (
      <span className="badge badge--warning" title="A planilha marca o preço fechado, mas o preço ainda não foi cadastrado.">
        Preço fechado sem valor
      </span>
    );
  }
  if (preco.estado === 'vencido') {
    return (
      <span className="badge badge--danger" title={`O preço fechado venceu em ${dataBr(preco.validoAte)}.`}>
        Preço fechado vencido
      </span>
    );
  }
  return (
    <span className="badge badge--info" title={textoDoTermo(preco)}>
      Preço fechado · <span className="fcr-mono">{moedaBr(preco.valorPorKg as number, preco.moeda)}/kg</span>
    </span>
  );
}

/** Linha "Preco fechado" do painel Detalhes (so para quem edita): termos atuais e o botao de cadastro. */
export function PrecoFechadoNoDetalhe({ item }: { item: ForecastItemRelatorio }) {
  const ctx = useCriarCotacao();
  if (!ctx || item.precoFixo !== true || item.productId == null) return null;
  const preco = ctx.precoFechado(item.productId);
  const estado = preco?.estado;
  const rotuloBotao = estado === 'sem_valor' ? 'Definir preço' : estado === 'vencido' ? 'Atualizar preço' : 'Editar preço';
  return (
    <div className={estado === 'ok' ? 'fcr-dec fcr-dec--tem' : 'fcr-dec'}>
      <span className="fcr-dci" aria-hidden="true">
        <Icon name="dollar" size={16} />
      </span>
      <div className="fcr-dec__corpo">
        <div className="fcr-det__rotulo">Preço fechado</div>
        <div className="fcr-det__valor">
          {!preco && <span className="fcr-fraco">Carregando o cadastro do preço…</span>}
          {estado === 'sem_valor' && (
            <>
              <span className="badge badge--warning">Sem valor</span>
              <span className="fcr-fraco">Marcado na planilha (coluna AV). Falta cadastrar o preço.</span>
            </>
          )}
          {preco && estado !== 'sem_valor' && (
            <>
              <b className="fcr-mono">{moedaBr(preco.valorPorKg as number, preco.moeda)}/kg</b>
              <span>{preco.incoterm}</span>
              {estado === 'vencido' ? (
                <span className="badge badge--danger">Venceu em {dataBr(preco.validoAte)}</span>
              ) : (
                <span className="fcr-fraco">válido até {dataBr(preco.validoAte)}</span>
              )}
            </>
          )}
        </div>
      </div>
      {preco && (
        <button
          type="button"
          className="ghost-button ghost-button--sm"
          aria-label={`${rotuloBotao} de ${item.item}`}
          aria-haspopup="dialog"
          onClick={(e) => ctx.abrirPreco(item, e.currentTarget)}
        >
          {rotuloBotao}
        </button>
      )}
    </div>
  );
}
