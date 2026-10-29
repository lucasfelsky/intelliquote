import BrandMark from '@/components/BrandMark';

/**
 * Carregando sessao (board AcessoEstados, quadro C): tela cheia antes de qualquer rota.
 * O conteiner reusa `.spinner--fullscreen` (so o leiaute de tela cheia, sem anel); o anel e o `.spinner` filho.
 */
export default function LoadingShell() {
  return (
    <div className="spinner--fullscreen loading-shell" role="status" aria-label="Carregando">
      <BrandMark tone="light" size={56} />
      <span className="spinner loading-shell__spinner" aria-hidden="true" />
    </div>
  );
}
