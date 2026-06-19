import { randomUUID } from 'crypto';

export function buildRequestCode(now = new Date()): string {
  const datePart = now.toISOString().slice(0, 10).replace(/-/g, '');
  const suffix = randomUUID().slice(0, 6).toUpperCase();

  return `QR-${datePart}-${suffix}`;
}
