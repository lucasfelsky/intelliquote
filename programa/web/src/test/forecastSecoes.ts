import { fireEvent, screen } from '@testing-library/react';

/**
 * As secoes do fim do Relatorio (Sob demanda, Demanda do comercial, Cobertos por grupo, Sem consumo) abrem recolhidas
 * (refino visual). Expande todas as que estiverem fechadas, para os testes lerem as tabelas.
 */
export function expandirSecoes(): void {
  for (const botao of screen.queryAllByRole('button', { name: /^Expandir a seção / })) fireEvent.click(botao);
}
