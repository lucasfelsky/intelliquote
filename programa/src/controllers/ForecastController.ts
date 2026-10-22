import { Request, Response } from 'express';
import { ForecastDbcorpService } from '../services/ForecastDbcorpService';
import { ForecastImportService } from '../services/ForecastImportService';
import { ForecastProductService } from '../services/ForecastProductService';
import { ForecastSnapshotService } from '../services/ForecastSnapshotService';
import { ForecastSourceService } from '../services/ForecastSourceService';
import { handleControllerError, HttpError, parseId } from '../utils/http';
import {
  forecastDbcorpConfirmSchema,
  forecastDbcorpPreviewSchema,
  forecastEmbalagensPatchSchema,
  forecastSnapshotQuerySchema,
  forecastSourcePatchSchema,
  forecastWorkbookConfirmSchema,
  forecastWorkbookPreviewSchema,
} from '../validators/forecast';

function sendError(res: Response, error: unknown): Response {
  const handled = handleControllerError(error);
  return res.status(handled.status).json({ message: handled.message });
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

  static async getRelatorioComprasXlsx(req: Request, res: Response): Promise<Response> {
    try {
      const id = parseId(req.params.id);
      if (id === null) {
        throw new HttpError(400, 'Quinzena invalida.');
      }
      const query = forecastSnapshotQuerySchema.parse({
        hoje: typeof req.query.hoje === 'string' ? req.query.hoje : undefined,
      });
      const data = await ForecastSnapshotService.getRelatorioComprasXlsx(id, query.hoje);
      return res.status(200).json({ data });
    } catch (error) {
      return sendError(res, error);
    }
  }
}
