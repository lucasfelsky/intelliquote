import { logger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { itemDaListaDeCompra } from '../utils/forecastDecisaoCompra';
import { estadoDoPrecoFechado, motivoDoPrecoBloqueado } from '../utils/forecastPrecoFechado';
import { HttpError } from '../utils/http';
import { dbDateToKey, todayKeyInSaoPaulo } from '../utils/supplierDocumentDates';
import type { ForecastPoPrecoFechadoInput } from '../validators/forecast';
import { ForecastPurchaseOrderService, type ReferenciaDecisao } from './ForecastPurchaseOrderService';
import { ForecastSnapshotService, type FrozenProduct } from './ForecastSnapshotService';
import { loadSupplierEmailRecipients, sendPurchaseOrderEmail } from './PurchaseOrderEmailService';

export interface UsuarioDoEnvio {
  id?: number;
  name?: string;
  email?: string;
}

export interface EnvioPoDireta {
  purchaseOrderId: number;
  /** `true` quando a mesma `chaveEnvio` ja estava enviada: nada foi enviado nem somado de novo. */
  jaEnviada: boolean;
  /** `pendente` = o e-mail saiu mas o registro na decisao falhou (a PO fica 'enviando' e precisa de conferencia). */
  registro: 'ok' | 'pendente';
  /** Qtd. final da decisao depois da soma, quando ha decisao. */
  qtdFinalKg: number | null;
  statusDaDecisao: string | null;
  fornecedor: string;
  para: string;
  copia: string[];
}

const naoFazParte = () => new HttpError(400, 'O produto não faz parte desta quinzena.');

// Envio da PO direta (item de PRECO FECHADO, sem cotacao) pelo Relatorio de compras do Forecast. A ordem importa:
// valida tudo ANTES de reservar; reserva a PO ('enviando') ANTES do e-mail; so a PO 'enviada' soma na Qtd. final.
// O preco vem do CADASTRO atual do produto (nunca do corpo) e a flag de preco fechado e revalidada aqui: a quinzena congela so o selo.
export class ForecastPoDiretaService {
  // Tudo que o item precisa para receber uma PO direta, sem efeito colateral: quinzena viva, produto na quinzena, produto ativo
  // com a flag de preco fechado do CADASTRO atual, fonte ligada a fornecedor ativo e contato de e-mail. Usada pelo envio e
  // pela lista de destinatarios do modal (que assim ja avisa o bloqueio antes de o usuario preencher o formulario).
  private static async elegibilidade(snapshotId: number, productId: number) {
    const snapshot = await prisma.forecastSnapshot.findFirst({
      where: { id: snapshotId, deletedAt: null },
      select: { id: true, products: true },
    });
    if (!snapshot) throw new HttpError(404, 'Quinzena não encontrada.');
    if (!(snapshot.products as unknown as FrozenProduct[]).some((p) => p.productId === productId)) throw naoFazParte();

    const product = await prisma.forecastProduct.findUnique({
      where: { id: productId },
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
    if (!product) throw naoFazParte();
    if (!product.isActive) throw new HttpError(409, 'O produto está inativo no cadastro do Forecast.');
    if (!product.fixedPriceFlag) {
      throw new HttpError(409, 'O item não é de preço fechado. Use “Cotar” para pedir cotação.');
    }
    // So se envia PO com o preco COMPLETO (valor, moeda, incoterm e validade) e dentro da validade (dia da validade ainda vale).
    const validoAte = product.fixedPriceValidUntil === null ? null : dbDateToKey(product.fixedPriceValidUntil);
    const estadoDoPreco = estadoDoPrecoFechado(
      {
        valorPorKg: product.fixedPrice === null ? null : Number(product.fixedPrice),
        moeda: product.fixedPriceCurrency,
        incoterm: product.fixedPriceIncoterm,
        validoAte,
      },
      todayKeyInSaoPaulo(new Date()),
    );
    const motivoDoPreco = motivoDoPrecoBloqueado(estadoDoPreco, validoAte);
    if (motivoDoPreco) throw new HttpError(409, motivoDoPreco);

    const supplierId = product.source?.supplierId ?? null;
    if (supplierId === null) {
      throw new HttpError(409, 'A fonte deste item não está ligada a um fornecedor do IntelliQuote. Ligue em Fontes do Forecast.');
    }
    const supplier = await prisma.supplier.findFirst({ where: { id: supplierId, deletedAt: null }, select: { id: true, name: true } });
    if (!supplier) throw new HttpError(409, 'O fornecedor ligado à fonte deste item não existe mais.');
    const recipients = await loadSupplierEmailRecipients(supplier.id);
    if (!recipients) {
      throw new HttpError(409, 'O fornecedor não tem contato com e-mail para receber a PO.');
    }
    return { product, supplier, recipients };
  }

  /** Quem recebe a PO direta (Para/Cc), a MESMA lista que o envio usa. Admin e comprador (rota). So leitura. */
  static async destinatarios(snapshotId: number, productId: number) {
    const { supplier, recipients } = await ForecastPoDiretaService.elegibilidade(snapshotId, productId);
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
    const { productId, quantidadeKg, chaveEnvio, ...payload } = input;
    const userId = user?.id ?? null;

    const { product, supplier, recipients } = await ForecastPoDiretaService.elegibilidade(snapshotId, productId);

    // Mesma referencia do PUT da decisao: so item da lista de compra desta quinzena (e o que o relatorio mostra).
    const relatorio = await ForecastSnapshotService.getRelatorioCompras(snapshotId);
    const item = itemDaListaDeCompra(relatorio, productId);
    if (!item) throw new HttpError(400, 'O item não está na lista de compra desta quinzena.');
    const referencia: ReferenciaDecisao = { sugeridaKg: item.quantidadeFinal, demandaKg: item.demanda, manual: false };

    const reserva = await ForecastPurchaseOrderService.reservar({
      snapshotId,
      productId,
      supplierId: supplier.id,
      supplierName: supplier.name,
      quantityKg: quantidadeKg,
      unitPrice: product.fixedPrice === null ? null : Number(product.fixedPrice),
      currency: product.fixedPriceCurrency,
      incoterm: product.fixedPriceIncoterm,
      requestKey: chaveEnvio,
      userId,
    });

    const copia = recipients.cc.map((c) => c.email);
    if (reserva.jaExistia) {
      if (reserva.status === 'enviada') {
        const decisao = await prisma.forecastPurchaseDecision.findUnique({
          where: { snapshotId_productId: { snapshotId, productId } },
          select: { finalKg: true, status: true },
        });
        return {
          purchaseOrderId: reserva.id,
          jaEnviada: true,
          registro: 'ok',
          qtdFinalKg: decisao?.finalKg == null ? null : Number(decisao.finalKg),
          statusDaDecisao: decisao?.status ?? null,
          fornecedor: supplier.name,
          para: recipients.to.email,
          copia,
        };
      }
      if (reserva.status === 'enviando') {
        throw new HttpError(409, 'Este envio ainda está em andamento. Aguarde e confira o status do item.');
      }
      throw new HttpError(409, 'Este envio falhou. Abra o envio de novo para tentar outra vez.');
    }

    try {
      await sendPurchaseOrderEmail({
        payload: payload,
        quoteRequest: null,
        produtoSemCotacao: product.name,
        recipient: { name: recipients.to.name, email: recipients.to.email },
        cc: recipients.cc,
        user,
        templateVars: {
          forecastPurchaseOrderId: reserva.id,
          snapshotId,
          productId,
          supplierId: supplier.id,
          supplierContactId: recipients.to.id,
          ccSupplierContactIds: recipients.contactCc.map((c) => c.id),
        },
        related: { type: 'forecast_purchase_order', id: String(reserva.id) },
        audit: { entityType: 'forecast_purchase_order', entityId: reserva.id, metadata: { via: 'po-direta' } },
      });
    } catch (error) {
      // HttpError = recusado antes de enviar (PDF, forwarder) ou envio que falhou: nada saiu, a PO deixa de valer.
      // Qualquer outro erro pode ter acontecido DEPOIS do e-mail sair: nao marca falha (evita reenvio em dobro).
      if (error instanceof HttpError) {
        await ForecastPurchaseOrderService.falhar(reserva.id, userId, `http_${error.status}`).catch((e: unknown) =>
          logger.error({ purchaseOrderId: reserva.id, reason: e instanceof Error ? e.message : String(e) }, 'Falha ao marcar a PO direta como falhou.'),
        );
        throw error;
      }
      logger.error(
        { purchaseOrderId: reserva.id, reason: error instanceof Error ? error.message : String(error) },
        'Erro inesperado no envio da PO direta; a PO segue em envio (o e-mail pode ter saido).',
      );
      throw new HttpError(500, 'Não foi possível confirmar o envio da PO. Confira a caixa de saída antes de tentar de novo.');
    }

    // E-mail ja saiu: registrar (soma na Qtd. final e status) com 1 nova tentativa; se ainda falhar, devolve `pendente` (nunca 5xx).
    let concluida: Awaited<ReturnType<typeof ForecastPurchaseOrderService.concluir>> | null = null;
    for (let tentativa = 1; tentativa <= 2 && concluida === null; tentativa += 1) {
      try {
        concluida = await ForecastPurchaseOrderService.concluir(reserva.id, userId, referencia);
      } catch (error) {
        logger.error(
          { purchaseOrderId: reserva.id, tentativa, reason: error instanceof Error ? error.message : String(error) },
          'Falha ao registrar a PO direta enviada; e-mail ja enviado.',
        );
      }
    }

    return {
      purchaseOrderId: reserva.id,
      jaEnviada: false,
      registro: concluida === null ? 'pendente' : 'ok',
      qtdFinalKg: concluida?.finalKg ?? null,
      statusDaDecisao: concluida?.status ?? null,
      fornecedor: supplier.name,
      para: recipients.to.email,
      copia,
    };
  }
}
