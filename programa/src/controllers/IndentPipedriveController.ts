import type { Request, Response } from 'express';
import { IndentIntegrationConfigService, NOT_CONFIGURED_MESSAGE } from '../services/IndentIntegrationConfigService';
import { IndentPipedriveSyncService, type SweepSummary } from '../services/IndentPipedriveSyncService';
import { handleControllerError } from '../utils/http';
import { indentIntegrationConfigSchema, indentPipedriveOptionsQuerySchema } from '../validators/indentPipedrive';

// Integracao Pipedrive do IQ Indent (PR 5a.2). O IQ so LE o Pipedrive; aqui so ha estado, opcoes ao vivo, configuracao e o
// botao "Sincronizar agora". Autoria vem SEMPRE do usuario logado.

const MANUAL_BUDGET_MS = 50_000;

const SYNC_FAILURES: Record<string, { status: number; message: string }> = {
  not_configured: { status: 409, message: NOT_CONFIGURED_MESSAGE },
  in_progress: { status: 409, message: 'Sincronização em andamento. Tente de novo em instantes.' },
  rate_limited: { status: 429, message: 'Limite de chamadas do Pipedrive atingido. Tente de novo em alguns minutos.' },
  budget_low: { status: 429, message: 'O orçamento diário de chamadas do Pipedrive está quase no fim. Tente de novo amanhã.' },
  config_mismatch: { status: 409, message: 'Funil ou coluna não conferem com o Pipedrive. Revise a configuração da integração.' },
  auth_failed: {
    status: 502,
    message: 'Falha de autenticação no Pipedrive. O token pode ter sido trocado ou revogado. Avise o administrador.',
  },
  error: { status: 502, message: 'O Pipedrive não respondeu como esperado. Tente de novo em alguns minutos.' },
};

function syncPayload(summary: SweepSummary) {
  return {
    outcome: summary.outcome,
    processed: summary.processed,
    created: summary.created,
    errors: summary.errors + summary.skipped,
    missed: summary.missed,
    durationMs: summary.durationMs,
  };
}

export class IndentPipedriveController {
  static async status(_req: Request, res: Response): Promise<Response> {
    try {
      return res.status(200).json(await IndentIntegrationConfigService.getStatus());
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async options(req: Request, res: Response): Promise<Response> {
    try {
      const query = indentPipedriveOptionsQuerySchema.parse(req.query);
      return res.status(200).json(await IndentIntegrationConfigService.getLiveOptions(query.pipelineId));
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async updateConfig(req: Request, res: Response): Promise<Response> {
    try {
      const input = indentIntegrationConfigSchema.parse(req.body);
      const user = req.user ? { id: req.user.id, name: req.user.name } : null;

      if (!user) {
        return res.status(401).json({ message: 'Utilizador nao autenticado.' });
      }

      return res.status(200).json(await IndentIntegrationConfigService.update(input, user));
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async sync(_req: Request, res: Response): Promise<Response> {
    try {
      const summary = await IndentPipedriveSyncService.runSweep({ source: 'MANUAL', budgetMs: MANUAL_BUDGET_MS });
      const failure = SYNC_FAILURES[summary.outcome];

      if (failure) {
        return res.status(failure.status).json({ message: failure.message, outcome: summary.outcome });
      }

      return res.status(200).json(syncPayload(summary));
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }
}
