import { logger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { itemDaListaDeCompra } from '../utils/forecastDecisaoCompra';
import { estadoDoPrecoFechado, motivoDoPrecoBloqueado } from '../utils/forecastPrecoFechado';
import { HttpError } from '../utils/http';
import { dbDateToKey, todayKeyInSaoPaulo } from '../utils/supplierDocumentDates';
import type { ForecastPoPrecoFechadoInput } from '../validators/forecast';
import {
  ForecastPurchaseOrderService,
  type PoConcluida,
  type ReferenciaDecisao,
  type ReservaPoInput,
} from './ForecastPurchaseOrderService';
import { ForecastSnapshotService, type FrozenProduct } from './ForecastSnapshotService';
import { loadSupplierEmailRecipients, sendPurchaseOrderEmail } from './PurchaseOrderEmailService';

export interface UsuarioDoEnvio {
  id?: number;
  name?: string;
  email?: string;
}

export interface ItemEnviadoPoDireta {
  productId: number;
  purchaseOrderId: number;
  /** Qtd. final da decisao do item depois da soma, quando ha decisao. */
  qtdFinalKg: number | null;
  statusDaDecisao: string | null;
}

export interface EnvioPoDireta {
  /** Primeira PO do envio (um envio de varios itens tem uma PO por item; ver `itens`). */
  purchaseOrderId: number;
  purchaseOrderIds: number[];
  /** `true` quando a mesma `chaveEnvio` ja estava enviada: nada foi enviado nem somado de novo. */
  jaEnviada: boolean;
  /** `pendente` = o e-mail saiu mas o registro de algum item na decisao falhou (a PO fica 'enviando' e precisa de conferencia). */
  registro: 'ok' | 'pendente';
  /** Do primeiro item (compatibilidade com o envio de um item so). */
  qtdFinalKg: number | null;
  statusDaDecisao: string | null;
  itens: ItemEnviadoPoDireta[];
  fornecedor: string;
  para: string;
  copia: string[];
}

const naoFazParte = () => new HttpError(400, 'O produto não faz parte desta quinzena.');
const ASSUNTO_NOMES_MAX = 150;

// Envio da PO direta (itens de PRECO FECHADO, sem cotacao) pelo Relatorio de compras do Forecast. Um envio = um e-mail e um PDF para
// os itens escolhidos, todos do MESMO fornecedor; cada item vira uma PO (`ForecastPurchaseOrder`) e soma na Qtd. final do proprio item.
// A ordem importa: valida tudo ANTES de reservar; reserva as POs ('enviando') ANTES do e-mail; so a PO 'enviada' soma na Qtd. final.
// O preco vem do CADASTRO atual do produto (nunca do corpo) e a flag de preco fechado e revalidada aqui: a quinzena congela so o selo.
export class ForecastPoDiretaService {
  // Tudo que os itens precisam para receber uma PO direta, sem efeito colateral: quinzena viva, produtos na quinzena, produtos ativos
  // com a flag de preco fechado do CADASTRO atual e o preco completo e valido, fonte ligada a fornecedor ativo (o MESMO fornecedor
  // para todos) e contato de e-mail. Usada pelo envio e pela lista de destinatarios do modal (que assim ja avisa o bloqueio antes
  // de o usuario preencher o formulario). Com varios itens a mensagem diz de qual item vem o motivo.
  private static async elegibilidade(snapshotId: number, productIds: number[]) {
    if (productIds.length === 0) throw new HttpError(400, 'Escolha ao menos um item para a PO.');
    const snapshot = await prisma.forecastSnapshot.findFirst({
      where: { id: snapshotId, deletedAt: null },
      select: { id: true, products: true },
    });
    if (!snapshot) throw new HttpError(404, 'Quinzena não encontrada.');
    const naQuinzena = new Set((snapshot.products as unknown as FrozenProduct[]).map((p) => p.productId));
    if (productIds.some((id) => !naQuinzena.has(id))) throw naoFazParte();

    const linhas = await prisma.forecastProduct.findMany({
      where: { id: { in: productIds } },
      select: {
        id: true,
        name: true,
        isActive: true,
        fixedPriceFlag: true,
        fixedPrice: true,
        fixedPriceCurrency: true,
        fixedPriceIncoterm: true,
        fixedPriceValidUntil: true,
        source: { select: { name: true, supplierId: true } },
      },
    });
    const porId = new Map(linhas.map((l) => [l.id, l] as const));
    const varios = productIds.length > 1;
    const hoje = todayKeyInSaoPaulo(new Date());
    const recusa = (nome: string, mensagem: string) => new HttpError(409, varios ? `${nome}: ${mensagem}` : mensagem);

    const products = productIds.map((id) => {
      const product = porId.get(id);
      if (!product) throw naoFazParte();
      if (!product.isActive) throw recusa(product.name, 'O produto está inativo no cadastro do Forecast.');
      if (!product.fixedPriceFlag) throw recusa(product.name, 'O item não é de preço fechado. Use “Cotar” para pedir cotação.');
      // So se envia PO com o preco COMPLETO (valor, moeda, incoterm e validade) e dentro da validade (dia da validade ainda vale).
      const validoAte = product.fixedPriceValidUntil === null ? null : dbDateToKey(product.fixedPriceValidUntil);
      const estado = estadoDoPrecoFechado(
        {
          valorPorKg: product.fixedPrice === null ? null : Number(product.fixedPrice),
          moeda: product.fixedPriceCurrency,
          incoterm: product.fixedPriceIncoterm,
          validoAte,
        },
        hoje,
      );
      const motivo = motivoDoPrecoBloqueado(estado, validoAte);
      if (motivo) throw recusa(product.name, motivo);
      if ((product.source?.supplierId ?? null) === null) {
        throw recusa(product.name, 'A fonte deste item não está ligada a um fornecedor do IntelliQuote. Ligue em Fontes do Forecast.');
      }
      return product;
    });

    const supplierIds = [...new Set(products.map((p) => p.source?.supplierId as number))];
    const fornecedores = await prisma.supplier.findMany({ where: { id: { in: supplierIds }, deletedAt: null }, select: { id: true, name: true } });
    if (fornecedores.length !== supplierIds.length) {
      throw new HttpError(409, 'O fornecedor ligado à fonte do item não existe mais.');
    }
    if (supplierIds.length > 1) {
      const nomes = fornecedores.map((f) => f.name).sort((a, b) => a.localeCompare(b, 'pt-BR')).join(', ');
      throw new HttpError(409, `Os itens escolhidos são de fornecedores diferentes (${nomes}). A PO é por fornecedor: envie uma PO para cada um.`);
    }
    const supplier = fornecedores[0] as { id: number; name: string };
    const recipients = await loadSupplierEmailRecipients(supplier.id);
    if (!recipients) {
      throw new HttpError(409, 'O fornecedor não tem contato com e-mail para receber a PO.');
    }
    return { products, supplier, recipients };
  }

  /** Quem recebe a PO direta (Para/Cc), a MESMA lista que o envio usa. Admin e comprador (rota). So leitura. */
  static async destinatarios(snapshotId: number, productIds: number[]) {
    const { supplier, recipients } = await ForecastPoDiretaService.elegibilidade(snapshotId, productIds);
    return {
      fornecedor: supplier.name,
      to: { name: recipients.to.name, email: recipients.to.email },
      contactCc: recipients.contactCc.map((c) => ({ name: c.name, email: c.email })),
      comexCc: recipients.comexCc.map((c) => c.email),
      cc: recipients.cc.map((c) => c.email),
    };
  }

  static async enviar(
    snapshotId: number,
    input: ForecastPoPrecoFechadoInput,
    user: UsuarioDoEnvio | null,
  ): Promise<EnvioPoDireta> {
    const { itens, chaveEnvio, ...payload } = input;
    const userId = user?.id ?? null;
    const productIds = itens.map((i) => i.productId);
    const varios = productIds.length > 1;

    const { products, supplier, recipients } = await ForecastPoDiretaService.elegibilidade(snapshotId, productIds);

    // Mesma referencia do PUT da decisao: so item da lista de compra desta quinzena (e o que o relatorio mostra).
    const relatorio = await ForecastSnapshotService.getRelatorioCompras(snapshotId);
    const referencias = new Map<number, ReferenciaDecisao>();
    for (const product of products) {
      const item = itemDaListaDeCompra(relatorio, product.id);
      if (!item) {
        throw new HttpError(400, varios ? `${product.name}: o item não está na lista de compra desta quinzena.` : 'O item não está na lista de compra desta quinzena.');
      }
      referencias.set(product.id, { sugeridaKg: item.quantidadeFinal, demandaKg: item.demanda, manual: false });
    }

    // Um item: a chave do envio e a da PO. Varios: uma chave por PO, derivada (`<chave>-<produto>`), para o mesmo envio repetido
    // reconhecer a lista inteira.
    const reservas: ReservaPoInput[] = products.map((product, indice) => ({
      snapshotId,
      productId: product.id,
      supplierId: supplier.id,
      supplierName: supplier.name,
      quantityKg: (itens[indice] as { quantidadeKg: number }).quantidadeKg,
      unitPrice: product.fixedPrice === null ? null : Number(product.fixedPrice),
      currency: product.fixedPriceCurrency,
      incoterm: product.fixedPriceIncoterm,
      requestKey: varios ? `${chaveEnvio}-${product.id}` : chaveEnvio,
      userId,
    }));
    const reserva = await ForecastPurchaseOrderService.reservarLote(reservas);
    const poIds = reserva.pos.map((p) => p.id);
    const primeira = poIds[0] as number;

    const copia = recipients.cc.map((c) => c.email);
    const base = { fornecedor: supplier.name, para: recipients.to.email, copia };

    if (reserva.jaExistia) {
      const status = reserva.pos.map((p) => p.status);
      if (status.every((s) => s === 'enviada')) {
        const decisoes = await prisma.forecastPurchaseDecision.findMany({
          where: { snapshotId, productId: { in: productIds } },
          select: { productId: true, finalKg: true, status: true },
        });
        const porProduto = new Map(decisoes.map((d) => [d.productId, d] as const));
        const itensEnviados = reserva.pos.map((po) => {
          const d = porProduto.get(po.productId);
          return {
            productId: po.productId,
            purchaseOrderId: po.id,
            qtdFinalKg: d?.finalKg == null ? null : Number(d.finalKg),
            statusDaDecisao: d?.status ?? null,
          };
        });
        return {
          ...base,
          purchaseOrderId: primeira,
          purchaseOrderIds: poIds,
          jaEnviada: true,
          registro: 'ok',
          qtdFinalKg: itensEnviados[0]?.qtdFinalKg ?? null,
          statusDaDecisao: itensEnviados[0]?.statusDaDecisao ?? null,
          itens: itensEnviados,
        };
      }
      if (status.some((s) => s === 'enviando')) {
        throw new HttpError(409, 'Este envio ainda está em andamento. Aguarde e confira o status dos itens.');
      }
      throw new HttpError(409, 'Este envio falhou. Abra o envio de novo para tentar outra vez.');
    }

    const nomes = products.map((p) => p.name).join(', ');
    try {
      await sendPurchaseOrderEmail({
        payload,
        quoteRequest: null,
        produtoSemCotacao: nomes.length > ASSUNTO_NOMES_MAX ? `${nomes.slice(0, ASSUNTO_NOMES_MAX - 1)}…` : nomes,
        recipient: { name: recipients.to.name, email: recipients.to.email },
        cc: recipients.cc,
        user,
        templateVars: {
          forecastPurchaseOrderId: primeira,
          forecastPurchaseOrderIds: poIds,
          snapshotId,
          productIds,
          supplierId: supplier.id,
          supplierContactId: recipients.to.id,
          ccSupplierContactIds: recipients.contactCc.map((c) => c.id),
        },
        related: { type: 'forecast_purchase_order', id: String(primeira) },
        audit: {
          entityType: 'forecast_purchase_order',
          entityId: primeira,
          metadata: { via: 'po-direta', purchaseOrderIds: poIds, itensNaPo: poIds.length },
        },
      });
    } catch (error) {
      // HttpError = recusado antes de enviar (PDF, forwarder) ou envio que falhou: nada saiu, as POs deixam de valer.
      // Qualquer outro erro pode ter acontecido DEPOIS do e-mail sair: nao marca falha (evita reenvio em dobro).
      if (error instanceof HttpError) {
        for (const id of poIds) {
          await ForecastPurchaseOrderService.falhar(id, userId, `http_${error.status}`).catch((e: unknown) =>
            logger.error({ purchaseOrderId: id, reason: e instanceof Error ? e.message : String(e) }, 'Falha ao marcar a PO direta como falhou.'),
          );
        }
        throw error;
      }
      logger.error(
        { purchaseOrderIds: poIds, reason: error instanceof Error ? error.message : String(error) },
        'Erro inesperado no envio da PO direta; as POs seguem em envio (o e-mail pode ter saido).',
      );
      throw new HttpError(500, 'Não foi possível confirmar o envio da PO. Confira a caixa de saída antes de tentar de novo.');
    }

    // E-mail ja saiu: registrar (soma na Qtd. final e status) cada item, com 1 nova tentativa; se algum ainda falhar, devolve
    // `pendente` (nunca 5xx). Cada PO tem a sua transacao: um item que falha nao desfaz os outros.
    const resultados: Array<{ po: { id: number; productId: number }; concluida: PoConcluida | null }> = [];
    for (const po of reserva.pos) {
      let concluida: PoConcluida | null = null;
      for (let tentativa = 1; tentativa <= 2 && concluida === null; tentativa += 1) {
        try {
          concluida = await ForecastPurchaseOrderService.concluir(po.id, userId, referencias.get(po.productId) ?? null);
        } catch (error) {
          logger.error(
            { purchaseOrderId: po.id, tentativa, reason: error instanceof Error ? error.message : String(error) },
            'Falha ao registrar a PO direta enviada; e-mail ja enviado.',
          );
        }
      }
      resultados.push({ po, concluida });
    }

    const itensEnviados: ItemEnviadoPoDireta[] = resultados.map(({ po, concluida }) => ({
      productId: po.productId,
      purchaseOrderId: po.id,
      qtdFinalKg: concluida?.finalKg ?? null,
      statusDaDecisao: concluida?.status ?? null,
    }));
    return {
      ...base,
      purchaseOrderId: primeira,
      purchaseOrderIds: poIds,
      jaEnviada: false,
      registro: resultados.some((r) => r.concluida === null) ? 'pendente' : 'ok',
      qtdFinalKg: itensEnviados[0]?.qtdFinalKg ?? null,
      statusDaDecisao: itensEnviados[0]?.statusDaDecisao ?? null,
      itens: itensEnviados,
    };
  }
}
