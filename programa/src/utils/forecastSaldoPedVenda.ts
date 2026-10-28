// D7 (Forecast preditivo, decidido pelo Lucas em 2026-10-27): coletor puro do "Saldo Ped. Venda" do relatorio SALDO
// (DBCorp DS9004). Soma por codigo e guarda so o que for > 0. E so um sinal de demanda reprimida/censura para a P3 do
// preditivo: nenhum calculo, relatorio, XLSX, painel ou pendente le este valor. Sem I/O, sem exceljs, sem prisma.
import type { Bruto } from './forecastXlsx';
import { normalizeProductCode } from './forecastWorkbook';
import { round6 } from './forecastDbcorpRegras';
import type { Lancamento } from './forecastTypes';

export interface ColetorSaldoPedVenda {
  adicionar(codigo: string, bruto: Bruto): void;
  linhas(): Lancamento[];
}

export function coletorSaldoPedVenda(): ColetorSaldoPedVenda {
  const porCodigo = new Map<string, number>();
  return {
    adicionar(codigo, bruto) {
      const chave = normalizeProductCode(codigo);
      if (!chave) return;
      // Vazio = 0. Numero finito >= 0 soma; negativo, nao finito, texto ou data e descartado em silencio.
      if (bruto === null || (typeof bruto === 'string' && bruto.trim() === '')) return;
      if (typeof bruto !== 'number' || !Number.isFinite(bruto) || bruto < 0) return;
      porCodigo.set(chave, (porCodigo.get(chave) ?? 0) + bruto);
    },
    linhas() {
      const saida: Lancamento[] = [];
      for (const [codigo, soma] of porCodigo) {
        const qtd = round6(soma);
        if (qtd > 0) saida.push({ codigo, qtd });
      }
      return saida.sort((a, b) => (a.codigo < b.codigo ? -1 : a.codigo > b.codigo ? 1 : 0));
    },
  };
}
