import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  catalogForecastKeys,
  listCatalogoSemForecast,
  TEXTO_SEM_FORECAST,
  type CatalogoSemForecastItem,
} from '@/services/catalogForecast';
import ItemVincularForecastModal from './ItemVincularForecastModal';

interface Props {
  /** Mensagem de sucesso/erro da tela (mesmo banner do restante da pagina). */
  onConcluido: (mensagem: string) => void;
}

/** Painel "Catalogo sem Forecast": itens ativos com codigo DBCorp fora do Forecast, com acao "Vincular". */
export default function ItensSemForecast({ onConcluido }: Props) {
  const [escolhido, setEscolhido] = useState<CatalogoSemForecastItem | null>(null);
  const query = useQuery({
    queryKey: catalogForecastKeys.semForecast,
    queryFn: listCatalogoSemForecast,
    staleTime: 30_000,
  });
  const itens = query.data ?? [];
  // Backend antigo (rota inexistente = 400/404) ou lista vazia: nada a mostrar.
  if (query.isError || itens.length === 0) return null;

  return (
    <section className="card" aria-label="Catálogo sem Forecast">
      <details>
        <summary>
          Catálogo sem Forecast: {itens.length} {itens.length === 1 ? 'item' : 'itens'} com código DBCorp fora do Forecast
        </summary>
        <p className="fcc-dica">{TEXTO_SEM_FORECAST}</p>
        <ul className="itens-sem-forecast">
          {itens.map((item) => (
            <li key={item.id} className="itens-sem-forecast__linha">
              <span>
                {item.commercialName} · DBCorp <strong>{item.dbcorpCode}</strong>
              </span>
              <button type="button" className="ghost-button ghost-button--sm" onClick={() => setEscolhido(item)}>
                Vincular ao Forecast
              </button>
            </li>
          ))}
        </ul>
      </details>
      {escolhido && (
        <ItemVincularForecastModal
          item={escolhido}
          modo="vincular"
          onFechar={() => setEscolhido(null)}
          onConcluido={(mensagem) => {
            setEscolhido(null);
            onConcluido(mensagem);
          }}
        />
      )}
    </section>
  );
}
