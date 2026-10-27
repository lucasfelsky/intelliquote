import { describe, expect, it } from 'vitest';
import {
  avisoTruncamento,
  casarItem,
  casarSolicitacoes,
  dataBrDaSolicitacao,
  indexarProdutosPorCatalogo,
  kgDaSolicitacao,
  preenchimentoDoItem,
  resumoDoPreenchimento,
  type ProdutoComCatalogo,
  type SolicitacaoCasada,
  type SolicitacaoParaDemanda,
} from './forecastDemandaSolicitacao';

// Dados 100% sinteticos.
const PRODUTOS: ProdutoComCatalogo[] = [
  { id: 5, name: 'PRODUTO 001', isActive: true, codes: [{ code: 'C0001', catalogItemId: 101 }, { code: 'C0002', catalogItemId: 101 }] },
  { id: 6, name: 'PRODUTO 002', isActive: true, codes: [{ code: 'C0003', catalogItemId: 102 }] },
  { id: 7, name: 'PRODUTO 003', isActive: true, codes: [{ code: 'C0004', catalogItemId: 103 }] },
  { id: 8, name: 'PRODUTO 004', isActive: true, codes: [{ code: 'C0005', catalogItemId: 103 }] },
  { id: 9, name: 'PRODUTO 005 INATIVO', isActive: false, codes: [{ code: 'C0006', catalogItemId: 104 }] },
  { id: 10, name: 'PRODUTO 006', isActive: true, codes: [{ code: 'C0007', catalogItemId: null }, { code: 'C0008' }] },
];

const indice = indexarProdutosPorCatalogo(PRODUTOS);
const item = (catalogItemId: number, quantity: number, unit: string, id = 1) => ({
  id,
  catalogItemId,
  commercialName: `ITEM CATALOGO ${catalogItemId}`,
  quantity,
  unit,
});

function solicitacao(
  id: number,
  status: SolicitacaoParaDemanda['status'],
  createdAt: string,
  customerName: string | null,
  items: SolicitacaoParaDemanda['items'] = [item(101, 10, 'KG')],
): SolicitacaoParaDemanda {
  return { id, status, customerName, createdAt, items };
}

describe('kgDaSolicitacao', () => {
  it('U1: KG direto; a unidade e normalizada (trim e maiusculas)', () => {
    expect(kgDaSolicitacao(1600, 'KG')).toEqual({ unidade: 'KG', kg: 1600, pedeKg: false });
    expect(kgDaSolicitacao(1600, ' kg ')).toEqual({ unidade: 'KG', kg: 1600, pedeKg: false });
    expect(kgDaSolicitacao(3, 'ton')).toEqual({ unidade: 'TON', kg: 3000, pedeKg: false });
  });

  it('U2: TON x 1000', () => {
    expect(kgDaSolicitacao(3, 'TON').kg).toBe(3000);
  });

  it('U3: UN, M3, L, BOX e unidade desconhecida pedem o kg', () => {
    for (const u of ['UN', 'M3', 'L', 'BOX', 'GAL']) {
      expect(kgDaSolicitacao(20, u)).toEqual({ unidade: u, kg: null, pedeKg: true });
    }
  });
});

describe('casarItem', () => {
  it('U4: limite de 10.000.000 kg (KG e TON); acima bloqueia com o texto exato', () => {
    expect(casarItem(item(101, 10_000_000, 'KG'), indice).bloqueio).toBeNull();
    expect(casarItem(item(101, 10_000, 'TON'), indice).bloqueio).toBeNull();
    const texto = 'A quantidade convertida passa de 10.000.000 kg, o limite da demanda.';
    expect(casarItem(item(101, 10_000_001, 'KG'), indice).bloqueio).toEqual({ motivo: 'acima-do-maximo', texto });
    const ton = casarItem(item(101, 10_001, 'TON'), indice);
    expect(ton.bloqueio).toEqual({ motivo: 'acima-do-maximo', texto });
    expect(ton.kg).toBe(10_001_000);
  });

  it('U5: catalogItem em 1 produto ativo casa, com o 1o codigo daquele catalogItem', () => {
    const r = casarItem(item(101, 1600, 'KG'), indice);
    expect(r.bloqueio).toBeNull();
    expect(r.produto).toEqual({ id: 5, name: 'PRODUTO 001', codigo: 'C0001' });
    expect(r.kg).toBe(1600);
    expect(r.pedeKg).toBe(false);
  });

  it('U6: dois codigos do MESMO produto com o mesmo catalogItem nao sao ambiguidade', () => {
    expect(indice.get(101)).toHaveLength(1);
    expect(casarItem(item(101, 1, 'KG'), indice).bloqueio).toBeNull();
  });

  it('U7: dois produtos ativos -> ambiguo, com os nomes ordenados no texto', () => {
    const r = casarItem(item(103, 5, 'KG'), indice);
    expect(r.produto).toBeNull();
    expect(r.bloqueio?.motivo).toBe('ambiguo');
    expect(r.bloqueio?.texto).toBe(
      'Item ligado a mais de um produto do Forecast (PRODUTO 003, PRODUTO 004): escolha o produto na lista à mão.',
    );
  });

  it('U8: 1 ativo + 1 inativo com o mesmo catalogItem usa o ativo', () => {
    const produtos: ProdutoComCatalogo[] = [
      { id: 1, name: 'PRODUTO 001', isActive: false, codes: [{ code: 'C0001', catalogItemId: 101 }] },
      { id: 2, name: 'PRODUTO 002', isActive: true, codes: [{ code: 'C0002', catalogItemId: 101 }] },
    ];
    const r = casarItem(item(101, 5, 'KG'), indexarProdutosPorCatalogo(produtos));
    expect(r.bloqueio).toBeNull();
    expect(r.produto).toEqual({ id: 2, name: 'PRODUTO 002', codigo: 'C0002' });
  });

  it('U9: so inativo -> produto-inativo; nenhum -> sem-produto; catalogItemId nulo/ausente fora do indice', () => {
    const inativo = casarItem(item(104, 7, 'KG'), indice);
    expect(inativo.bloqueio).toEqual({
      motivo: 'produto-inativo',
      texto: 'O produto do Forecast deste item está inativo: reative-o no cadastro antes de lançar.',
    });
    expect(inativo.produto).toBeNull();
    const nenhum = casarItem(item(105, 10, 'KG'), indice);
    expect(nenhum.bloqueio).toEqual({
      motivo: 'sem-produto',
      texto: 'Sem produto do Forecast para este item do catálogo.',
    });
    expect([...indice.keys()].sort()).toEqual([101, 102, 103, 104]);
  });
});

describe('casarSolicitacoes', () => {
  it('U10: descarta fulfilled/rejected, tira repetidas, ordena por data desc e id desc, e normaliza o cliente', () => {
    const lista = [
      solicitacao(10, 'pending', '2026-10-18T12:00:00.000Z', '   '),
      solicitacao(12, 'quoting', '2026-10-19T12:00:00.000Z', ' CLIENTE SINTETICO A '),
      solicitacao(13, 'fulfilled', '2026-10-25T12:00:00.000Z', 'CLIENTE SINTETICO B'),
      solicitacao(14, 'rejected', '2026-10-25T12:00:00.000Z', null),
      solicitacao(11, 'pending', '2026-10-19T12:00:00.000Z', null),
      solicitacao(12, 'pending', '2026-10-19T12:00:00.000Z', 'OUTRO CLIENTE'),
    ];
    const r = casarSolicitacoes(lista, PRODUTOS);
    expect(r.map((s) => s.id)).toEqual([12, 11, 10]);
    const [a, b, c] = r;
    expect(a).toMatchObject({ status: 'quoting', statusTexto: 'Em cotação', cliente: 'CLIENTE SINTETICO A' });
    expect(b).toMatchObject({ status: 'pending', statusTexto: 'Pendente', cliente: null });
    expect(c?.cliente).toBeNull();
    expect(a?.criadaEm).toBe('19/10/2026');
    expect(a?.itens[0]?.produto?.id).toBe(5);
  });
});

describe('preenchimentoDoItem', () => {
  const unica = (s: SolicitacaoParaDemanda): SolicitacaoCasada => {
    const [primeira] = casarSolicitacoes([s], PRODUTOS);
    if (!primeira) throw new Error('fixture invalida');
    return primeira;
  };
  const usar = (s: SolicitacaoCasada, i: number) => {
    const it = s.itens[i];
    if (!it) throw new Error('item inexistente');
    return preenchimentoDoItem(s, it);
  };
  const s12 = unica(
    solicitacao(12, 'quoting', '2026-10-19T12:00:00.000Z', 'CLIENTE SINTETICO A', [item(101, 1600, 'KG', 1), item(102, 3, 'TON', 2)]),
  );
  const s11 = unica(
    solicitacao(11, 'pending', '2026-10-19T12:00:00.000Z', null, [item(101, 20, 'BOX', 3), item(103, 5, 'KG', 4)]),
  );

  it('U11: KG preenche produto, busca, kg, cliente e numero; BOX deixa o kg vazio; bloqueado devolve null', () => {
    expect(usar(s12, 0)).toMatchObject({
      solicitacaoId: 12,
      productId: 5,
      busca: 'C0001',
      kgTexto: '1600',
      cliente: 'CLIENTE SINTETICO A',
      solicitacao: '12',
      pedeKg: false,
      kg: 1600,
    });
    expect(usar(s12, 1)?.kgTexto).toBe('3000');
    expect(usar(s11, 0)).toMatchObject({
      productId: 5,
      kgTexto: '',
      pedeKg: true,
      quantidadeTexto: '20 BOX',
      cliente: '',
      solicitacao: '11',
      kg: null,
    });
    expect(usar(s11, 1)).toBeNull();
  });

  it('U13: o resumo traz o kg em pt-BR ou o que a Solicitacao pede', () => {
    const kg = usar(s12, 0);
    const box = usar(s11, 0);
    expect(kg && resumoDoPreenchimento(kg)).toBe(
      'Solicitação nº 12 aplicada: produto, quantidade (1.600 kg), cliente e número preenchidos. Informe a data de necessidade e o motivo.',
    );
    expect(box && resumoDoPreenchimento(box)).toBe(
      'Solicitação nº 11 aplicada: a Solicitação pede 20 BOX. Informe a quantidade em kg, a data de necessidade e o motivo.',
    );
  });
});

describe('avisoTruncamento', () => {
  it('U12: sem truncamento -> null; so pendentes; os dois status', () => {
    expect(
      avisoTruncamento({ pending: { mostradas: 3, total: 3 }, quoting: { mostradas: 0, total: 0 } }),
    ).toBeNull();
    expect(
      avisoTruncamento({ pending: { mostradas: 100, total: 134 }, quoting: { mostradas: 5, total: 5 } }),
    ).toBe('Mostrando 100 de 134 Solicitações pendentes (as mais recentes). As demais estão no módulo Solicitações.');
    expect(
      avisoTruncamento({ pending: { mostradas: 100, total: 134 }, quoting: { mostradas: 100, total: 120 } }),
    ).toBe(
      'Mostrando 100 de 134 Solicitações pendentes e 100 de 120 Solicitações em cotação (as mais recentes). As demais estão no módulo Solicitações.',
    );
  });
});

describe('dataBrDaSolicitacao', () => {
  it('U14: data em Brasilia (nunca UTC) e texto invalido vira "—"', () => {
    expect(dataBrDaSolicitacao('2026-10-20T02:30:00.000Z')).toBe('19/10/2026');
    expect(dataBrDaSolicitacao('2026-10-20T12:00:00.000Z')).toBe('20/10/2026');
    expect(dataBrDaSolicitacao('x')).toBe('—');
  });
});
