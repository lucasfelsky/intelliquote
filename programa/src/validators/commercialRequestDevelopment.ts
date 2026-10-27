import { z } from 'zod';

// Solicitacao de desenvolvimento (item novo sem catalogo). Os anexos entram em outro commit.

const MAX_DB_INT = 2147483647;

/** Vinculo do item novo ao catalogo, feito pela Comex. */
export const commercialRequestLinkCatalogSchema = z.object({
  catalogItemId: z
    .number({ error: 'Item de catalogo invalido.' })
    .int('Item de catalogo invalido.')
    .positive('Item de catalogo invalido.')
    .max(MAX_DB_INT, 'Item de catalogo invalido.'),
});

export type CommercialRequestLinkCatalogInput = z.infer<typeof commercialRequestLinkCatalogSchema>;
