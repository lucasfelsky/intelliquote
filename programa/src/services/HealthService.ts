import { prisma } from '../lib/prisma';

type HealthStatus = 'ok' | 'error';

interface HealthPayload {
  status: HealthStatus;
  service: string;
  environment: string;
  timestamp: string;
  uptimeSeconds: number;
  checks?: {
    database: HealthStatus;
  };
}

export class HealthService {
  static getLiveness(): HealthPayload {
    return {
      status: 'ok',
      service: 'IntelliQuote API',
      environment: process.env.NODE_ENV ?? 'development',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
    };
  }

  static async getReadiness(): Promise<HealthPayload> {
    try {
      await prisma.$queryRaw`SELECT 1`;

      return {
        ...HealthService.getLiveness(),
        checks: {
          database: 'ok',
        },
      };
    } catch (_error) {
      return {
        ...HealthService.getLiveness(),
        status: 'error',
        checks: {
          database: 'error',
        },
      };
    }
  }
}
