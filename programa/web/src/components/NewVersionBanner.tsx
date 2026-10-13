import { useState } from 'react';
import { useNewVersionCheck } from './useNewVersionCheck';

interface NewVersionBannerProps {
  // Injetaveis para teste; em producao vem do build e do window.
  currentBuildId?: string;
  pollMs?: number;
  reload?: () => void;
}

// Aviso de deploy novo: a aba aberta antes do deploy segue com o JS antigo (ex.: tela que so
// atualiza depois do F5). Nao recarrega sozinho para nao perder formulario em edicao.
export default function NewVersionBanner({
  currentBuildId,
  pollMs,
  reload = () => window.location.reload(),
}: NewVersionBannerProps) {
  const available = useNewVersionCheck(currentBuildId, pollMs);
  const [dismissed, setDismissed] = useState(false);
  const visible = available && !dismissed;

  // Regiao viva sempre montada: o leitor de tela anuncia quando o aviso aparece.
  return (
    <div className="toast-container" role="status" aria-live="polite">
      {visible && (
        <div className="toast new-version-toast">
          <span className="new-version-toast__text">
            Há uma nova versão do IntelliQuote. Salve o que estiver editando e recarregue a página.
          </span>
          <div className="new-version-toast__actions">
            <button type="button" className="new-version-toast__later" onClick={() => setDismissed(true)}>
              Depois
            </button>
            <button type="button" className="new-version-toast__reload" onClick={reload}>
              Recarregar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
