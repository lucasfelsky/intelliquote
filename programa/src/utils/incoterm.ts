import { Incoterm } from '@prisma/client';

export function formatIncoterms(incoterms: Incoterm[]): string {
  return incoterms.join(' / ');
}
