import { useEffect, useState } from 'react';
import { Icon } from '@/components/icons';
import { termoDeBusca } from '../busca';

export const ATRASO_DA_BUSCA_MS = 180;

interface BuscaProps {
  // Termo de busca ja normalizado ('' = sem busca). So sobe depois de 180 ms sem digitar.
  onTermo: (termo: string) => void;
  // "N capitulos encontrados" (vazio sem busca ou sem resultado). Fica numa regiao aria-live="polite".
  status: string;
}

// O texto digitado fica AQUI: cada tecla re-renderiza so o campo; a pagina (e os 17 capitulos) so muda quando o termo efetivo muda.
export default function Busca({ onTermo, status }: BuscaProps) {
  const [entrada, setEntrada] = useState('');
  useEffect(() => {
    const espera = window.setTimeout(() => onTermo(termoDeBusca(entrada)), ATRASO_DA_BUSCA_MS);
    return () => window.clearTimeout(espera);
  }, [entrada, onTermo]);

  return (
    <div className="page-header__actions manual-busca" role="search">
      <div className="manual-busca__campo">
        <Icon name="search" size={16} className="manual-busca__icone" />
        <label className="sr-only" htmlFor="manual-busca">
          Buscar no manual
        </label>
        <input
          id="manual-busca"
          type="search"
          className="input manual-busca__input"
          placeholder="Buscar no manual (ex.: lembrete, alçada, DG)"
          autoComplete="off"
          value={entrada}
          onChange={(e) => setEntrada(e.target.value)}
        />
      </div>
      <p className="manual-busca__status" aria-live="polite">
        {status}
      </p>
    </div>
  );
}
