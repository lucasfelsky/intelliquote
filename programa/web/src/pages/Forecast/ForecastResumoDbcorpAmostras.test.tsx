import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ForecastDbcorpSummary } from '@/services/forecast';
import ForecastResumoDbcorp from './ForecastResumoDbcorp';

// Resumo da importacao DBCorp com as amostras ignoradas (codigos de prefixo AM + digito). Dados 100% sinteticos.
function rel(over: Record<string, unknown> = {}) {
  return {
    fileName: 'arquivo-teste.xlsx',
    lidas: 10,
    usadas: 8,
    ignoradas: { 'sem codigo': 2 },
    total: 1000,
    avisos: [],
    erros: [],
    totalCasado: 900,
    codigosSemProduto: 1,
    ...over,
  };
}

const SEM_LINHAS = { linhas: 0, kg: 0 };

const pendente = {
  codigo: 'TST0901',
  situacao: 'sem_cadastro',
  produtoInativo: null,
  vendasMes: 20,
  vendasAtual: 0,
  vendasAnual: 1200,
  vendas3Meses: 50,
  vendasAnteriores: 30,
  programacao: 0,
  chegadas: 80,
  comprasEmAberto: 80,
  saldo: 0,
};

const REGRA = { mesesVenda: ['2026-10', '2026-11', '2026-12'], historicoAusente: [], compras: 'fup_em_aberto' };

function pendentesDoResumo(over: Record<string, unknown> = {}) {
  return {
    itens: [pendente],
    totalItens: 1,
    omitidos: 0,
    soSaldo: { codigos: 0, kg: 0 },
    semVendaRecente: { codigos: 0, vendasAnual: 0 },
    regra: REGRA,
    ...over,
  };
}

function resumoDbcorp(pendentes: Record<string, unknown>, over: Record<string, unknown> = {}): ForecastDbcorpSummary {
  return {
    label: '12-2',
    baseDate: '2026-12-15',
    half: 2,
    meses: {
      consumo: ['06', '07', '08', '09', '10', '11', '12 (ATUAL)'],
      chegada: ['12', '01', '02', '03', '04'],
      programacao: ['12', '01', '02', '03'],
    },
    produtos: { total: 3 },
    historico: {
      meses: [
        { yearMonth: '2026-10', linhas: 4 },
        { yearMonth: '2026-11', linhas: 5 },
      ],
      ausentes: [],
      mesAnterior: { yearMonth: '2026-11', linhas: 5, novas: 1, alteradas: 2, removidas: 3 },
    },
    relatorios: {
      saldo: rel({
        porDeposito: [{ deposito: 'DEPÓSITO A', incluido: true, linhas: 4, saldo: 1000 }],
        outrasEmpresas: [],
      }),
      vendasMes: rel({ empresas: ['EMPRESA X'] }),
      vendasAtual: rel({ empresas: ['EMPRESA X'] }),
      vendasAnual: rel({ empresas: ['EMPRESA X'] }),
      programacao: rel({
        porStatus: [{ status: 'Pendente', incluido: true, linhas: 3, qtd: 600 }],
        foraDaJanela: { antes: 0, depois: 0 },
      }),
      fup: rel({
        porStatus: [{ status: 'STATUS A', incluido: true, linhas: 5, kg: 8000 }],
        estimadasPorEtd: { linhas: 1, kg: 500 },
        vencidasNoMesBase: SEM_LINHAS,
        semData: { linhas: 0, kg: 0, porStatus: [] },
        depoisDaJanela: SEM_LINHAS,
      }),
    },
    pendentes,
    avisos: [],
    erros: [],
    ...over,
  } as unknown as ForecastDbcorpSummary;
}

const TITULO_PENDENTES = /^Pendentes de cadastro \(/;

describe('ForecastResumoDbcorp - amostras ignoradas', () => {
  it('com pendentes: a nota aparece no bloco e o titulo segue com o total de pendentes', () => {
    const { container } = render(
      <ForecastResumoDbcorp
        resumo={resumoDbcorp(pendentesDoResumo({ amostrasIgnoradas: { codigos: 2, prefixos: ['AM'] } }))}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Pendentes de cadastro (1)' })).toBeTruthy();
    const nota = screen.getByText('Amostras ignoradas (prefixo AM): 2 códigos');
    expect(nota.className).toBe('fcp-nota');
    expect(container.querySelectorAll('[style]')).toHaveLength(0);
  });

  it('so amostras (totalItens 0): bloco minimo "Pendentes de cadastro (0)" com a nota, sem tabela', () => {
    const { container } = render(
      <ForecastResumoDbcorp
        resumo={resumoDbcorp(
          pendentesDoResumo({ itens: [], totalItens: 0, amostrasIgnoradas: { codigos: 3, prefixos: ['AM'] } }),
        )}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Pendentes de cadastro (0)' })).toBeTruthy();
    expect(screen.getByText('Amostras ignoradas (prefixo AM): 3 códigos')).toBeTruthy();
    expect(screen.queryByRole('table', { name: /pendentes de cadastro/i })).toBeNull();
    expect(screen.queryByText(/Entra na quinzena/)).toBeNull();
    expect(container.querySelectorAll('[style]')).toHaveLength(0);
  });

  it('totalItens 0 e amostras 0: sem bloco de pendentes', () => {
    render(
      <ForecastResumoDbcorp
        resumo={resumoDbcorp(
          pendentesDoResumo({ itens: [], totalItens: 0, amostrasIgnoradas: { codigos: 0, prefixos: ['AM'] } }),
        )}
      />,
    );
    expect(screen.queryByRole('heading', { name: TITULO_PENDENTES })).toBeNull();
    expect(screen.queryByText(/Amostras ignoradas/)).toBeNull();
  });

  it('campo ausente (backend antigo): sem nota, com e sem pendentes', () => {
    const comPendentes = render(<ForecastResumoDbcorp resumo={resumoDbcorp(pendentesDoResumo())} />);
    expect(screen.getByRole('heading', { name: 'Pendentes de cadastro (1)' })).toBeTruthy();
    expect(screen.queryByText(/Amostras ignoradas/)).toBeNull();
    expect(comPendentes.container.querySelectorAll('[style]')).toHaveLength(0);
    comPendentes.unmount();

    const vazio = render(<ForecastResumoDbcorp resumo={resumoDbcorp(pendentesDoResumo({ itens: [], totalItens: 0 }))} />);
    expect(screen.queryByRole('heading', { name: TITULO_PENDENTES })).toBeNull();
    expect(screen.queryByText(/Amostras ignoradas/)).toBeNull();
    expect(vazio.container.querySelectorAll('[style]')).toHaveLength(0);
  });
});
