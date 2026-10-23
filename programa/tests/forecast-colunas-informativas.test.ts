import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { calcular, valorDaColuna } from '../src/utils/forecastEngine';
import { montarRelatorioCompras, type LinhaParaRelatorio } from '../src/utils/forecastRelatorioCompras';
import { COLUNAS_CONFERIDAS, type ColunaConferida, type Quinzena } from '../src/utils/forecastTypes';
import { COLUNAS_DO_CALCULO, COLUNAS_INFORMATIVAS } from '../web/src/pages/Forecast/forecastPainel';

// Prova, no motor, da afirmacao do selo de conferencia ("so colunas informativas divergem: a demanda, a
// projecao e o relatorio de compras nao usam esses valores"). Repo PUBLICO: so a fixture anonimizada.
// Nota sobre AA (meses de estoque): nao tem entrada propria, e so (U + chegadas) / Q e nao e lida por AN nem
// pela projecao em calcularLinha. A perturbacao abaixo nao a altera: a garantia para AA vem da leitura do codigo.
const fixture = JSON.parse(
  readFileSync(resolve(__dirname, 'fixtures', 'forecast', 'quinzena-10-2.anon.json'), 'utf8'),
) as Quinzena;

const HOJE = '2026-10-20';

// Muda SO as entradas que alimentam as colunas informativas: clientes ativos (AS), margem (AR), vendas anuais (S)
// e os 3 meses mais antigos do historico (R). Nao toca em estoque, vendas do mes, chegadas, programacoes nem lead time.
function perturbar(q: Quinzena): Quinzena {
  const copia = structuredClone(q);
  copia.entradas.clientesAtivos = [...copia.entradas.clientesAtivos, ...copia.entradas.clientesAtivos];
  copia.entradas.margem = copia.entradas.margem.map((m) => ({ ...m, margem: 0.123 }));
  copia.entradas.vendasAnual = copia.entradas.vendasAnual.map((v) => ({ ...v, qtd: v.qtd * 2 + 7 }));
  for (const p of copia.produtos) {
    for (const i of [0, 1, 2]) p.historico[i] += 1000;
  }
  return copia;
}

function linhasParaRelatorio(q: Quinzena, quinzena: 1 | 2) {
  const calculadas = calcular(q, { hoje: HOJE, quinzena });
  const produtoPorLinha = new Map(q.produtos.map((p) => [p.linha, p]));
  const linhas: LinhaParaRelatorio[] = calculadas.map((c) => {
    const p = produtoPorLinha.get(c.linha)!;
    return {
      ...c,
      n: p.n,
      item: p.item,
      codigos: p.codigos.filter((x) => x !== ''),
      fonte: p.fonte,
      status: p.status,
    };
  });
  return { calculadas, linhas };
}

describe('colunas informativas do selo de conferencia', () => {
  it('particao: informativas + do calculo = colunas conferidas, sem intersecao', () => {
    const informativas: readonly string[] = COLUNAS_INFORMATIVAS;
    const doCalculo: readonly string[] = COLUNAS_DO_CALCULO;
    expect([...informativas, ...doCalculo].sort()).toEqual([...COLUNAS_CONFERIDAS].sort());
    expect(informativas.filter((c) => doCalculo.includes(c))).toEqual([]);
  });

  for (const quinzena of [2, 1] as const) {
    describe(`quinzena ${quinzena} (hoje ${HOJE})`, () => {
      const base = linhasParaRelatorio(fixture, quinzena);
      const perturbada = linhasParaRelatorio(perturbar(fixture), quinzena);

      it('as colunas do calculo e AP ficam identicas ao perturbar as entradas informativas', () => {
        expect(perturbada.calculadas).toHaveLength(base.calculadas.length);
        base.calculadas.forEach((antes, i) => {
          const depois = perturbada.calculadas[i];
          for (const col of COLUNAS_DO_CALCULO) {
            expect(valorDaColuna(depois, col as ColunaConferida), `linha ${antes.linha} coluna ${col}`).toEqual(
              valorDaColuna(antes, col as ColunaConferida),
            );
          }
          expect(depois.AP, `linha ${antes.linha} AP`).toEqual(antes.AP);
        });
      });

      it('o relatorio de compras (inclusive a secao sem consumo) fica identico', () => {
        const q = (linhas: LinhaParaRelatorio[]) =>
          montarRelatorioCompras(
            { id: 7, label: fixture.id, baseDate: fixture.dataBase, half: 2, origin: 'planilha', hoje: HOJE, linhas },
            [],
          );
        expect(q(perturbada.linhas)).toEqual(q(base.linhas));
      });

      it('a perturbacao nao e vazia: muda R, S, AR e AS em varias linhas', () => {
        for (const col of ['R', 'S', 'AR', 'AS'] as const) {
          const mudou = base.calculadas.filter(
            (antes, i) => valorDaColuna(perturbada.calculadas[i], col) !== valorDaColuna(antes, col),
          ).length;
          expect(mudou, col).toBeGreaterThan(0);
        }
      });
    });
  }
});
