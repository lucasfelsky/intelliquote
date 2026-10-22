import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ForecastPrazosEstimativa } from '@/services/forecast';
import ForecastPrazosPorFonte from './ForecastPrazosPorFonte';
import { rascunhoInicial, type CampoPrazo, type RascunhoPrazos } from './forecastPrazosChegada';

afterEach(cleanup);

// Dados 100% sinteticos.
const zero = { linhas: 0, kg: 0 };
function prazos(over: Partial<ForecastPrazosEstimativa> = {}): ForecastPrazosEstimativa {
  return {
    padrao: { prontidaoDias: 35, etdDias: 35 },
    fontes: [
      {
        sourceId: 1,
        nome: 'FONTE 001',
        salvo: { prontidaoDias: null, etdDias: null },
        usado: { prontidaoDias: 35, etdDias: 35 },
        prontidao: { linhas: 2, kg: 1500 },
        etd: { linhas: 1, kg: 400 },
      },
      {
        sourceId: 2,
        nome: 'FONTE 002',
        salvo: { prontidaoDias: 50, etdDias: 20 },
        usado: { prontidaoDias: 50, etdDias: 20 },
        prontidao: zero,
        etd: { linhas: 3, kg: 100 },
      },
    ],
    semFonte: { prontidao: { linhas: 1, kg: 90 }, etd: zero },
    padroesAlterados: 0,
    ...over,
  };
}

function Harness({
  inicial = prazos(),
  rascunhoInicialTeste,
  onRecalcular = vi.fn(),
  ocupado = false,
  recalculos = 0,
}: {
  inicial?: ForecastPrazosEstimativa;
  rascunhoInicialTeste?: RascunhoPrazos;
  onRecalcular?: () => void;
  ocupado?: boolean;
  recalculos?: number;
}) {
  const [rascunho, setRascunho] = useState<RascunhoPrazos>(rascunhoInicialTeste ?? rascunhoInicial(inicial));
  const mudar = (id: number, campo: CampoPrazo, texto: string) =>
    setRascunho((r) => ({ ...r, [id]: { prontidao: '', etd: '', ...r[id], [campo]: texto } }));
  return (
    <ForecastPrazosPorFonte
      prazos={inicial}
      rascunho={rascunho}
      onMudar={mudar}
      onRecalcular={onRecalcular}
      ocupado={ocupado}
      recalculos={recalculos}
    />
  );
}

const campo = (nome: string) => screen.getByLabelText(nome) as HTMLInputElement;
const recalcular = () => screen.getByRole('button', { name: 'Recalcular pré-visualização' }) as HTMLButtonElement;

describe('ForecastPrazosPorFonte', () => {
  it('mostra a tabela por fonte com o usado nos campos, o salvo ao lado e a linha "Sem fonte" so de leitura', () => {
    render(<Harness />);
    expect(screen.getByRole('heading', { name: 'Prazo das chegadas estimadas, por fonte' })).toBeTruthy();
    expect(
      screen.getByText(/Chegadas sem ETA usam a data do FUP \+ o prazo da fonte e ficam marcadas ESTIMADA\. Ao confirmar, o prazo usado vira o padrão da fonte nas próximas importações\./),
    ).toBeTruthy();

    const tabela = screen.getByRole('table', { name: 'Prazo das chegadas estimadas do FUP, por fonte' });
    const linhas = within(tabela).getAllByRole('row');
    expect(linhas).toHaveLength(4); // cabecalho + 2 fontes + Sem fonte
    const f1 = within(linhas[1]!);
    expect(f1.getByRole('rowheader').textContent).toBe('FONTE 001');
    expect(f1.getByText('2 linhas · 1.500 kg')).toBeTruthy();
    expect(f1.getByText('1 linha · 400 kg')).toBeTruthy();
    expect(campo('Dias da DATA PRONTIDÃO até a chegada - FONTE 001').value).toBe('35');
    expect(campo('Dias do ETD até a chegada - FONTE 001').value).toBe('35');
    expect(f1.getByText('—', { selector: 'td' })).toBeTruthy(); // padrao salvo: nada

    const f2 = within(linhas[2]!);
    expect(screen.queryByLabelText('Dias da DATA PRONTIDÃO até a chegada - FONTE 002')).toBeNull(); // sem linhas por prontidão
    expect(campo('Dias do ETD até a chegada - FONTE 002').value).toBe('20');
    expect(f2.getByText('prontidão 50 · ETD 20 dias')).toBeTruthy();

    // Sem fonte: leitura, com o padrao; nenhum campo editavel.
    const semFonte = within(linhas[3]!);
    expect(semFonte.getByRole('rowheader').textContent).toBe('Sem fonte no cadastro');
    expect(semFonte.getByText('35 (padrão)')).toBeTruthy();
    expect(semFonte.queryAllByRole('textbox')).toHaveLength(0);
  });

  it('o campo de um criterio sem linhas estimadas vira traco (nao editavel)', () => {
    render(<Harness />);
    // FONTE 002 nao tem linha por prontidao; FONTE 001 tem as duas.
    expect(screen.queryByLabelText('Dias da DATA PRONTIDÃO até a chegada - FONTE 002')).toBeNull();
    expect(screen.getByLabelText('Dias do ETD até a chegada - FONTE 002')).toBeTruthy();
  });

  it('sem edicao o botao Recalcular fica desabilitado e nao ha aviso', () => {
    render(<Harness />);
    expect(recalcular().disabled).toBe(true);
    expect(screen.queryByText(/Você editou prazos/)).toBeNull();
  });

  it('editar habilita Recalcular e avisa que o Confirmar espera o recalculo; o clique chama onRecalcular', () => {
    const onRecalcular = vi.fn();
    render(<Harness onRecalcular={onRecalcular} />);
    fireEvent.change(campo('Dias da DATA PRONTIDÃO até a chegada - FONTE 001'), { target: { value: '60' } });
    expect(screen.getByText('Você editou prazos: recalcule a pré-visualização antes de confirmar.')).toBeTruthy();
    expect(recalcular().disabled).toBe(false);
    fireEvent.click(recalcular());
    expect(onRecalcular).toHaveBeenCalledTimes(1);
  });

  it('valor invalido: mensagem no campo (aria-invalid) e Recalcular desabilitado', () => {
    render(<Harness />);
    const dias = campo('Dias do ETD até a chegada - FONTE 001');
    for (const [texto, mensagem] of [
      ['', 'Informe os dias.'],
      ['-3', 'Use um número inteiro de dias, sem sinal nem decimais.'],
      ['12,5', 'Use um número inteiro de dias, sem sinal nem decimais.'],
      ['366', 'No máximo 365 dias.'],
    ] as const) {
      fireEvent.change(dias, { target: { value: texto } });
      expect(dias.getAttribute('aria-invalid'), texto).toBe('true');
      expect(screen.getByText(mensagem), texto).toBeTruthy();
      expect(dias.getAttribute('aria-describedby')).toBeTruthy();
      expect(recalcular().disabled, texto).toBe(true);
    }
    expect(screen.getByText('Corrija os dias destacados para recalcular.')).toBeTruthy();
    fireEvent.change(dias, { target: { value: '0' } }); // 0 vale
    expect(dias.getAttribute('aria-invalid')).toBeNull();
    expect(recalcular().disabled).toBe(false);
  });

  it('ocupado trava os campos e o botao', () => {
    render(<Harness ocupado />);
    expect(campo('Dias do ETD até a chegada - FONTE 001').closest('fieldset')?.disabled).toBe(true);
    expect(recalcular().disabled).toBe(true);
  });

  it('padroesAlterados do servidor vira o aviso (singular/plural)', () => {
    const { unmount } = render(<Harness inicial={prazos({ padroesAlterados: 1 })} />);
    expect(screen.getByText('Ao confirmar, 1 fonte terá o padrão salvo alterado.')).toBeTruthy();
    unmount();
    render(<Harness inicial={prazos({ padroesAlterados: 2 })} />);
    expect(screen.getByText('Ao confirmar, 2 fontes terão o padrão salvo alterado.')).toBeTruthy();
  });

  it('depois do recalculo: mensagem de retorno recebe o foco; sumiu ao editar de novo', () => {
    const { rerender } = render(<Harness recalculos={0} />);
    expect(screen.queryByText(/Pré-visualização recalculada/)).toBeNull();
    rerender(<Harness recalculos={1} />);
    const retorno = screen.getByText('Pré-visualização recalculada com os prazos informados.');
    expect(document.activeElement).toBe(retorno);
    fireEvent.change(campo('Dias do ETD até a chegada - FONTE 001'), { target: { value: '40' } });
    expect(screen.queryByText(/Pré-visualização recalculada/)).toBeNull();
  });

  it('sem fonte nenhuma e sem "Sem fonte": diz que nada precisou de estimativa', () => {
    render(
      <Harness
        inicial={prazos({ fontes: [], semFonte: { prontidao: zero, etd: zero } })}
        rascunhoInicialTeste={{}}
      />,
    );
    expect(screen.getByText('Nenhuma chegada do FUP precisou de estimativa.')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });
});
