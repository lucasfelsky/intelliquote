import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import type {
  ForecastGrupoEquivalenciaCreateInput,
  ForecastGrupoEquivalenciaPatchInput,
} from '../validators/forecast';
import { normalizeProductName } from '../utils/forecastWorkbook';
import { HttpError } from '../utils/http';
import { AuditLogService } from './AuditLogService';

type Db = Prisma.TransactionClient | typeof prisma;

const ENTITY_TYPE = 'forecast_equivalence_group';

const COM_MEMBROS = {
  members: {
    select: { id: true, name: true, isActive: true, purchaseOnDemand: true, source: { select: { name: true } } },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
  },
} satisfies Prisma.ForecastEquivalenceGroupInclude;

type GrupoComMembros = Prisma.ForecastEquivalenceGroupGetPayload<{ include: typeof COM_MEMBROS }>;

export interface ForecastGrupoEquivalenciaData {
  id: number;
  nome: string;
  observacao: string | null;
  /** Produto pelo qual a compra sai; nulo = o membro de maior media na quinzena. */
  principalProdutoId: number | null;
  membros: Array<{
    id: number;
    nome: string;
    fonte: string | null;
    ativo: boolean;
    /** Marca de compra sob demanda do membro (dentro do grupo ela e ignorada; so a do principal vale). */
    sobDemanda: boolean;
  }>;
}

function paraDados(g: GrupoComMembros): ForecastGrupoEquivalenciaData {
  return {
    id: g.id,
    nome: g.name,
    observacao: g.notes,
    principalProdutoId: g.principalProductId,
    membros: g.members.map((m) => ({
      id: m.id,
      nome: m.name,
      fonte: m.source?.name ?? null,
      ativo: m.isActive,
      sobDemanda: m.purchaseOnDemand,
    })),
  };
}

/** Grupo do produto no cadastro ATUAL (o relatorio le daqui; nada e congelado na quinzena). */
export interface GrupoDoProduto {
  id: number;
  nome: string;
  principalProductId: number | null;
}

const NOME_DUPLICADO = 'Já existe um grupo de equivalência com esse nome.';

// Produtos que vao ENTRAR no grupo (membros que ja estao nele nao passam por aqui): existem, estao ativos e nao estao em OUTRO grupo. Falha com mensagem clara (400/409)
// antes de gravar; a gravacao ainda confere por `updateMany` (corrida entre dois grupos).
async function conferirProdutos(tx: Db, ids: number[], grupoId: number | null): Promise<void> {
  const produtos = await tx.forecastProduct.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, isActive: true, equivalenceGroupId: true, equivalenceGroup: { select: { name: true } } },
  });
  const porId = new Map(produtos.map((p) => [p.id, p]));
  for (const id of ids) {
    const p = porId.get(id);
    if (!p) throw new HttpError(400, 'Algum produto escolhido não existe mais no cadastro do Forecast.');
    if (p.equivalenceGroupId !== null && p.equivalenceGroupId !== grupoId) {
      throw new HttpError(409, `O produto ${p.name} já está no grupo ${p.equivalenceGroup?.name ?? ''}.`.trim());
    }
    if (!p.isActive) {
      throw new HttpError(400, `O produto ${p.name} está inativo: reative-o no cadastro do Forecast antes de agrupar.`);
    }
  }
}

function ehNomeDuplicado(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

// Grupos de equivalencia (PR 6b): produtos que sao o MESMO material tem o estoque avaliado somado no relatorio de compras.
// O AuditLog guarda so ids (produtos e principal) e contagens: nunca nome de produto nem de grupo.
export class ForecastGrupoEquivalenciaService {
  static async list(db: Db = prisma): Promise<ForecastGrupoEquivalenciaData[]> {
    const rows = await db.forecastEquivalenceGroup.findMany({
      include: COM_MEMBROS,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    return rows.map(paraDados);
  }

  // Grupo de cada produto informado (1 consulta). O gateway so precisa trocar este provedor.
  static async gruposDosProdutos(productIds: number[], db: Db = prisma): Promise<Map<number, GrupoDoProduto>> {
    const ids = [...new Set(productIds)];
    if (ids.length === 0) return new Map();
    const rows = await db.forecastProduct.findMany({
      where: { id: { in: ids }, equivalenceGroupId: { not: null } },
      select: { id: true, equivalenceGroup: { select: { id: true, name: true, principalProductId: true } } },
    });
    return new Map(
      rows.flatMap((r) =>
        r.equivalenceGroup
          ? [[r.id, { id: r.equivalenceGroup.id, nome: r.equivalenceGroup.name, principalProductId: r.equivalenceGroup.principalProductId }] as const]
          : [],
      ),
    );
  }

  static async create(
    input: ForecastGrupoEquivalenciaCreateInput,
    userId: number | null,
  ): Promise<ForecastGrupoEquivalenciaData> {
    try {
      return await prisma.$transaction(async (tx) => {
        await conferirProdutos(tx, input.produtoIds, null);
        const criado = await tx.forecastEquivalenceGroup.create({
          data: {
            name: input.nome,
            normalizedName: normalizeProductName(input.nome),
            notes: input.observacao ?? null,
            principalProductId: input.principalProdutoId ?? null,
            createdById: userId,
          },
        });
        const gravados = await tx.forecastProduct.updateMany({
          where: { id: { in: input.produtoIds }, equivalenceGroupId: null, isActive: true },
          data: { equivalenceGroupId: criado.id },
        });
        // Outro grupo pegou um dos produtos no meio do caminho: desfaz tudo (a transacao reverte).
        if (gravados.count !== input.produtoIds.length) {
          throw new HttpError(409, 'Algum produto escolhido acabou de entrar em outro grupo. Atualize a lista e tente de novo.');
        }
        await AuditLogService.log(
          {
            entityType: ENTITY_TYPE,
            entityId: criado.id,
            action: 'create',
            performedById: userId,
            metadata: { produtoIds: input.produtoIds, principalProdutoId: input.principalProdutoId ?? null },
          },
          tx,
        );
        return paraDados(
          await tx.forecastEquivalenceGroup.findUniqueOrThrow({ where: { id: criado.id }, include: COM_MEMBROS }),
        );
      });
    } catch (error) {
      if (ehNomeDuplicado(error)) throw new HttpError(409, NOME_DUPLICADO);
      throw error;
    }
  }

  static async patch(
    id: number,
    input: ForecastGrupoEquivalenciaPatchInput,
    userId: number | null,
  ): Promise<ForecastGrupoEquivalenciaData> {
    try {
      return await prisma.$transaction(async (tx) => {
        const atual = await tx.forecastEquivalenceGroup.findUnique({ where: { id }, include: COM_MEMBROS });
        if (!atual) throw new HttpError(404, 'Grupo nao encontrado.');

        const idsAtuais = atual.members.map((m) => m.id);
        const idsNovos = input.produtoIds ?? idsAtuais;
        const entrando = idsNovos.filter((p) => !idsAtuais.includes(p));
        const saindo = idsAtuais.filter((p) => !idsNovos.includes(p));
        if (entrando.length > 0) await conferirProdutos(tx, entrando, id);

        // Principal: o enviado (pode limpar com null); sem envio, o atual enquanto continuar membro.
        let principal = input.principalProdutoId !== undefined ? input.principalProdutoId : atual.principalProductId;
        if (principal !== null && !idsNovos.includes(principal)) {
          if (input.principalProdutoId !== undefined) {
            throw new HttpError(400, 'O produto principal precisa ser um dos produtos do grupo.');
          }
          principal = null;
        }

        const nome = input.nome ?? atual.name;
        const observacao = input.observacao !== undefined ? input.observacao : atual.notes;
        const camposAlterados: string[] = [];
        if (nome !== atual.name) camposAlterados.push('nome');
        if (observacao !== atual.notes) camposAlterados.push('observacao');
        if (principal !== atual.principalProductId) camposAlterados.push('principalProdutoId');
        if (entrando.length > 0 || saindo.length > 0) camposAlterados.push('produtoIds');

        if (camposAlterados.length > 0) {
          await tx.forecastEquivalenceGroup.update({
            where: { id },
            data: {
              name: nome,
              normalizedName: normalizeProductName(nome),
              notes: observacao,
              principalProductId: principal,
            },
          });
          if (saindo.length > 0) {
            await tx.forecastProduct.updateMany({
              where: { id: { in: saindo }, equivalenceGroupId: id },
              data: { equivalenceGroupId: null },
            });
          }
          if (entrando.length > 0) {
            const gravados = await tx.forecastProduct.updateMany({
              where: { id: { in: entrando }, equivalenceGroupId: null, isActive: true },
              data: { equivalenceGroupId: id },
            });
            if (gravados.count !== entrando.length) {
              throw new HttpError(409, 'Algum produto escolhido acabou de entrar em outro grupo. Atualize a lista e tente de novo.');
            }
          }
          await AuditLogService.log(
            {
              entityType: ENTITY_TYPE,
              entityId: id,
              action: 'update',
              performedById: userId,
              metadata: { produtoIds: idsNovos, principalProdutoId: principal, camposAlterados },
            },
            tx,
          );
        }
        return paraDados(await tx.forecastEquivalenceGroup.findUniqueOrThrow({ where: { id }, include: COM_MEMBROS }));
      });
    } catch (error) {
      if (ehNomeDuplicado(error)) throw new HttpError(409, NOME_DUPLICADO);
      throw error;
    }
  }

  // Desfazer o grupo: DELETE (os membros voltam a avulsos pela FK SetNull); o AuditLog guarda os ids de antes.
  static async remove(id: number, userId: number | null): Promise<{ id: number }> {
    return prisma.$transaction(async (tx) => {
      const atual = await tx.forecastEquivalenceGroup.findUnique({
        where: { id },
        select: { id: true, principalProductId: true, members: { select: { id: true } } },
      });
      if (!atual) throw new HttpError(404, 'Grupo nao encontrado.');
      await tx.forecastEquivalenceGroup.delete({ where: { id } });
      await AuditLogService.log(
        {
          entityType: ENTITY_TYPE,
          entityId: id,
          action: 'delete',
          performedById: userId,
          beforeData: { produtoIds: atual.members.map((m) => m.id), principalProdutoId: atual.principalProductId },
          metadata: { produtos: atual.members.length },
        },
        tx,
      );
      return { id };
    });
  }
}
