import { Icon } from '@/components/icons';

interface BuscaProps {
  valor: string;
  onChange: (valor: string) => void;
  // "N capitulos encontrados" (vazio sem busca ou sem resultado). Fica numa regiao aria-live="polite".
  status: string;
}

export default function Busca({ valor, onChange, status }: BuscaProps) {
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
          value={valor}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
      <p className="manual-busca__status" aria-live="polite">
        {status}
      </p>
    </div>
  );
}
