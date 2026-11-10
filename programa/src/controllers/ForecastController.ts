import { Request, Response } from 'express';
import { ForecastDbcorpService } from '../services/ForecastDbcorpService';
import { ForecastDecisaoCompraService } from '../services/ForecastDecisaoCompraService';
import { ForecastRascunhoCotacaoService } from '../services/ForecastRascunhoCotacaoService';
import { ForecastDemandaComercialService } from '../services/ForecastDemandaComercialService';
import { ForecastGrupoEquivalenciaService } from '../services/ForecastGrupoEquivalenciaService';
import { ForecastImportService } from '../services/ForecastImportService';
import { ForecastMesesAtipicosService } from '../services/ForecastMesesAtipicosService';
import { ForecastOcasioesService } from '../services/ForecastOcasioesService';
import { ForecastProductCadastroService } from '../services/ForecastProductCadastroService';
import { ForecastProductService } from '../services/ForecastProductService';
import { ForecastSnapshotService } from '../services/ForecastSnapshotService';
import { ForecastSobDemandaService } from '../services/ForecastSobDemandaService';
import { ForecastSourceService } from '../services/ForecastSourceService';
import { ForecastUltimoPrecoService } from '../services/ForecastUltimoPrecoService';
import { handleControllerError, HttpError, parseId } from '../utils/http';
import {
  forecastDbcorpConfirmSchema,
  forecastDemandaComercialCreateSchema,
  forecastDemandaComercialPatchSchema,
  forecastDemandaComercialQuerySchema,
  forecastDbcorpPreviewSchema,
  forecastCandidatosCotacaoQuerySchema,
  forecastDecisaoPutSchema,
  forecastRascunhoCotacaoPutSchema,
  forecastEmbalagensPatchSchema,
  forecastGrupoEquivalenciaCreateSchema,
  forecastGrupoEquivalenciaPatchSchema,
  forecastMesesAtipicosPutSchema,
  forecastOcasiaoCreateSchema,
  forecastOcasiaoPatchSchema,
  forecastOcasioesQuerySchema,
  forecastProductCodeAddSchema,
  forecastProductCreateSchema,
  forecastProductReativarSchema,
  forecastRelatorioXlsxQuerySchema,
  forecastSnapshotDeleteSchema,
  forecastSnapshotQuerySchema,
  forecastSobDemandaPatchSchema,
  forecastSourcePatchSchema,
  forecastWorkbookConfirmSchema,
  forecastWorkbookPreviewSchema,
} from '../validators/forecast';

function sendError(res: Response, error: unknown): Response {
  const handled = handleControllerError(error);
  return res.status(handled.status).json({ message: handled.message });
}

// O rascunho e do usuario logado: sem usuario na requisicao nao ha rascunho (requireAuth ja barra antes).
function rascunhoUserId(req: Request): number {
  const userId = req.user?.id;
  if (typeof userId !== 'number') {
    throw new HttpError(401, 'Sessao invalida.');
  }
  return userId;
}

export class ForecastController {
  static async previewWorkbook(req: Request, res: Response): Promise<Response> {
    try {
      const input = forecastWorkbookPreviewSchema.parse(req.body);
      const data = await ForecastImportService.preview(input);
      return res.status(200).json({ data });
    } catch (error) {
      return sendError(res, error);
    }
  }

  static async confirmWorkbook(req: Request, res: Response): Promise<Response> {
    try {
      const input = forecastWorkbookConfirmSchema.parse(req.body);
      const data = await ForecastImportService.confirm(input, req.user?.id ?? null);
      return res.status(201).json({ data });
    } catch (error) {
      return sendError(res, error);
    }
  }

  static async previewDbcorp(req: Request, res: Response): Promise<Response> {
    try {
      const input = forecastDbcorpPreviewSchema.parse(req.body);
      const data = await ForecastDbcorpService.preview(input);
      return res.status(200).json({ data });
    } catch (error) {
      return sendError(res, error);
    }
  }

  static async confirmDbcorp(req: Request, res: Response): Promise<Response> {
    try {
      const input = forecastDbcorpConfirmSchema.parse(req.body);
      const data = await ForecastDbcorpService.confirm(input, req.user?.id ?? null);
      return res.status(201).json({ data });
    } catch (error) {
      return sendError(res, error);
    }
  }

  static async listSources(_req: Request, res: Response): Promise<Response> {
    try {
      const data = await ForecastSourceService.list();
      return res.status(200).json({ data });
    } catch (error) {
      return sendError(res, error);
    }
  }

  static async getPrazoReal(_req: Request, res: Response): Promise<Response> {
    try {
      const data = await ForecastSourceService.prazoReal();
      return res.status(200).json({ data });
    } catch (error) {
      return sendError(res, error);
    }
  }

  static async patchSource(req: Request, res: Response): Promise<Response> {
    try {
      const id = parseId(req.params.id);
      if (id === null) {
        throw new HttpError(400, 'Fonte invalida.');
      }
      const input = forecastSourcePatchSchema.parse(req.body);
      const data = await ForecastSourceService.patch(id, input, req.user?.id ?? null);
      return res.status(200).json({ data });
    } catch (error) {
      return sendError(res, error);
    }
  }

  static async listProducts(_req: Request, res: Response): Promise<Response> {
    try {
      const data = await ForecastProductService.list();
      return res.status(200).json({ data });
    } catch (error) {
      return sendError(res, error);
    }
  }

  static async getEmbalagens(req: Request, res: Response): Promise<Response> {
    try {
      const id = parseId(req.params.id);
      if (id === null) {
        throw new HttpError(400, 'Produto invalido.');
      }
      const data = await ForecastProductService.getEmbalagens(id);
      return res.status(200).json({ data });
    } catch (error) {
      return sendError(res, error);
    }
  }

  static async getUltimoPreco(req: Request, res: Response): Promise<Response> {
    try {
      const id = parseId(req.params.id);
      if (id === null) {
        throw new HttpError(400, 'Produto invalido.');
      }
      const data = await ForecastUltimoPrecoService.doProduto(id);
      return res.status(200).json({ data });
    } catch (error) {
      return sendError(res, error);
    }
  }

  static async patchEmbalagens(req: Request, res: Response): Promise<Response> {
    try {
      const id = parseId(req.params.id);
      if (id === null) {
        throw new HttpError(400, 'Produto invalido.');
      }
      const input = forecastEmbalagensPatchSchema.parse(req.body);
      const data = await ForecastProductService.patchEmbalagens(id, input, req.user?.id ?? null);
      return res.status(200).json({ data });
    } catch (error) {
      return sendError(res, error);
    }
  }

  static async patchSobDemanda(req: Request, res: Response): Promise<Response> {
    try {
      const id = parseId(req.params.id);
      if (id === null) {
        throw new HttpError(400, 'Produto invalido.');
      }
      const input = forecastSobDemandaPatchSchema.parse(req.body);
      const data = await ForecastSobDemandaService.patch(id, input, req.user?.id ?? null);
      return res.status(200).json({ data });
    } catch (error) {
      return sendError(res, error);
    }
  }

  static async putMesesAtipicos(req: Request, res: Response): Promise<Response> {
    try {
      const id = parseId(req.params.id);
      if (id === null) {
        throw new HttpError(400, 'Produto invalido.');
      }
      const input = forecastMesesAtipicosPutSchema.parse(req.body);
      const data = await ForecastMesesAtipicosService.substituir(id, input, req.user?.id ?? null);
      return res.status(200).json({ data });
    } catch (error) {
      return sendError(res, error);
    }
  }

  static async listSnapshots(_req: Request, res: Response): Promise<Response> {
    try {
      const data = await ForecastSnapshotService.list();
      return res.status(200).json({ data });
    } catch (error) {
      return sendError(res, error);
    }
  }

  static async getSnapshot(req: Request, res: Response): Promise<Response> {
    try {
      const id = parseId(req.params.id);
      if (id === null) {
        throw new HttpError(400, 'Quinzena invalida.');
      }
      const query = forecastSnapshotQuerySchema.parse({
        hoje: typeof req.query.hoje === 'string' ? req.query.hoje : undefined,
      });
      const data = await ForecastSnapshotService.getCalculated(id, query.hoje);
      return res.status(200).json({ data });
    } catch (error) {
      return sendError(res, error);
    }
  }

  static async deleteSnapshot(req: Request, res: Response): Promise<Response> {
    try {
      const id = parseId(req.params.id);
      if (id === null) {
        throw new HttpError(400, 'Quinzena invalida.');
      }
      forecastSnapshotDeleteSchema.parse(req.body ?? {});
      const data = await ForecastSnapshotService.excluir(id, req.user?.id ?? null);
      return res.status(200).json({ data });
    } catch (error) {
      return sendError(res, error);
    }
  }

  static async getPendentes(req: Request, res: Response): Promise<Response> {
    try {
      const id = parseId(req.params.id);
      if (id === null) {
        throw new HttpError(400, 'Quinzena invalida.');
      }
      const data = await ForecastSnapshotService.getPendentes(id);
      return res.status(200).json({ data });
    } catch (error) {
      return sendError(res, error);
    }
  }

  static async createProduct(req: Request, res: Response): Promise<Response> {
    try {
      const input = forecastProductCreateSchema.parse(req.body);
      const data = await ForecastProductCadastroService.create(input, req.user?.id ?? null);
      return res.status(201).json({ data });
    } catch (error) {
      return sendError(res, error);
    }
  }

  static async addProductCode(req: Request, res: Response): Promise<Response> {
    try {
      const id = parseId(req.params.id);
      if (id === null) {
        throw new HttpError(400, 'Produto invalido.');
      }
      const input = forecastProductCodeAddSchema.parse(req.body);
      const data = await ForecastProductCadastroService.addCode(id, input, req.user?.id ?? null);
      return res.status(201).json({ data });
    } catch (error) {
      return sendError(res, error);
    }
  }

  static async reativarProduto(req: Request, res: Response): Promise<Response> {
    try {
      const id = parseId(req.params.id);
      if (id === null) {
        throw new HttpError(400, 'Produto inválido.');
      }
      forecastProductReativarSchema.parse(req.body ?? {});
      const data = await ForecastProductCadastroService.reativar(id, req.user?.id ?? null);
      return res.status(200).json({ data });
    } catch (error) {
      return sendError(res, error);
    }
  }

  static async getRelatorioCompras(req: Request, res: Response): Promise<Response> {
    try {
      const id = parseId(req.params.id);
      if (id === null) {
        throw new HttpError(400, 'Quinzena invalida.');
      }
      const query = forecastSnapshotQuerySchema.parse({
        hoje: typeof req.query.hoje === 'string' ? req.query.hoje : undefined,
      });
      const data = await ForecastSnapshotService.getRelatorioCompras(id, query.hoje);
      return res.status(200).json({ data });
    } catch (error) {
      return sendError(res, error);
    }
  }

  // Candidatos a cotacao (E3): itens da quinzena fora da lista de compra, com demanda, por fonte.
  static async getCandidatosCotacao(req: Request, res: Response): Promise<Response> {
    try {
      const id = parseId(req.params.id);
      if (id === null) {
        throw new HttpError(400, 'Quinzena invalida.');
      }
      if (Array.isArray(req.query.fonte) || Array.isArray(req.query.hoje)) {
        throw new HttpError(400, 'Informe cada parametro uma unica vez (fonte e hoje).');
      }
      const query = forecastCandidatosCotacaoQuerySchema.parse({
        hoje: typeof req.query.hoje === 'string' ? req.query.hoje : undefined,
        fonte: typeof req.query.fonte === 'string' ? req.query.fonte : undefined,
      });
      const data = await ForecastSnapshotService.getCandidatosCotacao(id, query.fonte ?? null, query.hoje);
      return res.status(200).json({ data });
    } catch (error) {
      return sendError(res, error);
    }
  }

  static async listDemandasComerciais(req: Request, res: Response): Promise<Response> {
    try {
      const query = forecastDemandaComercialQuerySchema.parse({
        status: typeof req.query.status === 'string' ? req.query.status : undefined,
        productId: typeof req.query.productId === 'string' ? Number(req.query.productId) : undefined,
      });
      const data = await ForecastDemandaComercialService.list(query);
      return res.status(200).json({ data });
    } catch (error) {
      return sendError(res, error);
    }
  }

  static async createDemandaComercial(req: Request, res: Response): Promise<Response> {
    try {
      const input = forecastDemandaComercialCreateSchema.parse(req.body);
      const data = await ForecastDemandaComercialService.create(input, req.user?.id ?? null);
      return res.status(201).json({ data });
    } catch (error) {
      return sendError(res, error);
    }
  }

  static async patchDemandaComercial(req: Request, res: Response): Promise<Response> {
    try {
      const id = parseId(req.params.id);
      if (id === null) {
        throw new HttpError(400, 'Demanda invalida.');
      }
      const input = forecastDemandaComercialPatchSchema.parse(req.body);
      const data = await ForecastDemandaComercialService.patch(id, input, req.user?.id ?? null);
      return res.status(200).json({ data });
    } catch (error) {
      return sendError(res, error);
    }
  }

  static async listGruposEquivalencia(_req: Request, res: Response): Promise<Response> {
    try {
      const data = await ForecastGrupoEquivalenciaService.list();
      return res.status(200).json({ data });
    } catch (error) {
      return sendError(res, error);
    }
  }

  static async createGrupoEquivalencia(req: Request, res: Response): Promise<Response> {
    try {
      const input = forecastGrupoEquivalenciaCreateSchema.parse(req.body);
      const data = await ForecastGrupoEquivalenciaService.create(input, req.user?.id ?? null);
      return res.status(201).json({ data });
    } catch (error) {
      return sendError(res, error);
    }
  }

  static async patchGrupoEquivalencia(req: Request, res: Response): Promise<Response> {
    try {
      const id = parseId(req.params.id);
      if (id === null) {
        throw new HttpError(400, 'Grupo invalido.');
      }
      const input = forecastGrupoEquivalenciaPatchSchema.parse(req.body);
      const data = await ForecastGrupoEquivalenciaService.patch(id, input, req.user?.id ?? null);
      return res.status(200).json({ data });
    } catch (error) {
      return sendError(res, error);
    }
  }

  static async deleteGrupoEquivalencia(req: Request, res: Response): Promise<Response> {
    try {
      const id = parseId(req.params.id);
      if (id === null) {
        throw new HttpError(400, 'Grupo invalido.');
      }
      const data = await ForecastGrupoEquivalenciaService.remove(id, req.user?.id ?? null);
      return res.status(200).json({ data });
    } catch (error) {
      return sendError(res, error);
    }
  }

  static async listDecisoes(req: Request, res: Response): Promise<Response> {
    try {
      const id = parseId(req.params.id);
      if (id === null) {
        throw new HttpError(400, 'Quinzena invalida.');
      }
      const data = await ForecastDecisaoCompraService.listar(id);
      return res.status(200).json({ data });
    } catch (error) {
      return sendError(res, error);
    }
  }

  static async putDecisao(req: Request, res: Response): Promise<Response> {
    try {
      const id = parseId(req.params.id);
      if (id === null) {
        throw new HttpError(400, 'Quinzena invalida.');
      }
      const productId = parseId(req.params.productId);
      if (productId === null) {
        throw new HttpError(400, 'Produto inválido.');
      }
      const input = forecastDecisaoPutSchema.parse(req.body);
      const data = await ForecastDecisaoCompraService.gravar(id, productId, input, req.user?.id ?? null);
      return res.status(200).json({ data });
    } catch (error) {
      return sendError(res, error);
    }
  }

  // Rascunho da cotacao do Forecast (E5): privado do usuario logado (sem login nao chega aqui: requireAuth).
  static async getRascunhoCotacao(req: Request, res: Response): Promise<Response> {
    try {
      const id = parseId(req.params.id);
      if (id === null) {
        throw new HttpError(400, 'Quinzena invalida.');
      }
      const data = await ForecastRascunhoCotacaoService.obter(id, rascunhoUserId(req));
      return res.status(200).json({ data });
    } catch (error) {
      return sendError(res, error);
    }
  }

  static async putRascunhoCotacao(req: Request, res: Response): Promise<Response> {
    try {
      const id = parseId(req.params.id);
      if (id === null) {
        throw new HttpError(400, 'Quinzena invalida.');
      }
      const input = forecastRascunhoCotacaoPutSchema.parse(req.body);
      const data = await ForecastRascunhoCotacaoService.gravar(id, rascunhoUserId(req), input);
      return res.status(200).json({ data });
    } catch (error) {
      return sendError(res, error);
    }
  }

  static async deleteRascunhoCotacao(req: Request, res: Response): Promise<Response> {
    try {
      const id = parseId(req.params.id);
      if (id === null) {
        throw new HttpError(400, 'Quinzena invalida.');
      }
      const data = await ForecastRascunhoCotacaoService.apagar(id, rascunhoUserId(req));
      return res.status(200).json({ data });
    } catch (error) {
      return sendError(res, error);
    }
  }

  static async getRelatorioComprasXlsx(req: Request, res: Response): Promise<Response> {
    try {
      const id = parseId(req.params.id);
      if (id === null) {
        throw new HttpError(400, 'Quinzena invalida.');
      }
      const query = forecastRelatorioXlsxQuerySchema.parse({
        hoje: typeof req.query.hoje === 'string' ? req.query.hoje : undefined,
        layout: typeof req.query.layout === 'string' ? req.query.layout : undefined,
      });
      const data =
        query.layout === 'macro'
          ? await ForecastSnapshotService.getRelatorioComprasXlsxMacro(id, query.hoje)
          : await ForecastSnapshotService.getRelatorioComprasXlsx(id, query.hoje);
      return res.status(200).json({ data });
    } catch (error) {
      return sendError(res, error);
    }
  }

  static async listOcasioes(req: Request, res: Response): Promise<Response> {
    try {
      const str = (valor: unknown) => (typeof valor === 'string' ? valor : undefined);
      const query = forecastOcasioesQuerySchema.parse({
        de: str(req.query.de),
        ate: str(req.query.ate),
        scopeType: str(req.query.scopeType),
        countryCode: str(req.query.countryCode),
        sourceId: typeof req.query.sourceId === 'string' ? Number(req.query.sourceId) : undefined,
        ativa: str(req.query.ativa),
      });
      const data = await ForecastOcasioesService.list(query);
      return res.status(200).json({ data });
    } catch (error) {
      return sendError(res, error);
    }
  }

  static async createOcasiao(req: Request, res: Response): Promise<Response> {
    try {
      const input = forecastOcasiaoCreateSchema.parse(req.body);
      const data = await ForecastOcasioesService.create(input, req.user?.id ?? null);
      return res.status(201).json({ data });
    } catch (error) {
      return sendError(res, error);
    }
  }

  static async patchOcasiao(req: Request, res: Response): Promise<Response> {
    try {
      const id = parseId(req.params.id);
      if (id === null) {
        throw new HttpError(400, 'Ocasião inválida.');
      }
      const input = forecastOcasiaoPatchSchema.parse(req.body);
      const data = await ForecastOcasioesService.patch(id, input, req.user?.id ?? null);
      return res.status(200).json({ data });
    } catch (error) {
      return sendError(res, error);
    }
  }

  static async deleteOcasiao(req: Request, res: Response): Promise<Response> {
    try {
      const id = parseId(req.params.id);
      if (id === null) {
        throw new HttpError(400, 'Ocasião inválida.');
      }
      const data = await ForecastOcasioesService.remove(id, req.user?.id ?? null);
      return res.status(200).json({ data });
    } catch (error) {
      return sendError(res, error);
    }
  }
}
