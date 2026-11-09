import { Icon } from '@/components/icons';

/** Seta que recolhe/expande a tabela de uma faixa, fonte ou secao do relatorio (refino visual). No papel nada some. */
export function AlternarGrupo({ aberto, aoAlternar, nome }: { aberto: boolean; aoAlternar: () => void; nome: string }) {
  return (
    <button
      type="button"
      className="fcr-grupo__alternar"
      aria-expanded={aberto}
      aria-label={`${aberto ? 'Recolher' : 'Expandir'} ${nome}`}
      onClick={aoAlternar}
    >
      <Icon name={aberto ? 'chevron-down' : 'chevron-right'} size={16} />
    </button>
  );
}
