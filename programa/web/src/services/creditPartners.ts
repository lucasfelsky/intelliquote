import { api } from '@/api/client';

export interface CreditPartnerContact {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  position: string | null;
  isPrimary: boolean;
}

export interface CreditPartner {
  id: number;
  name: string;
  taxId: string | null;
  website: string | null;
  country: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  contacts: CreditPartnerContact[];
}

export interface CreditPartnerContactInput {
  /** Presente = atualiza o contato existente; ausente = cria. */
  id?: number;
  name: string;
  email: string;
  phone?: string | null;
  position?: string | null;
  isPrimary?: boolean;
}

export interface CreditPartnerInput {
  name: string;
  taxId?: string | null;
  website?: string | null;
  country?: string | null;
  notes?: string | null;
  isActive?: boolean;
  contacts: CreditPartnerContactInput[];
}

export function listCreditPartners(params?: { active?: boolean }): Promise<CreditPartner[]> {
  const query =
    params?.active === undefined ? undefined : { active: params.active ? 'true' : 'false' };
  return api.get<CreditPartner[]>('/v1/credit-partners', query);
}

export function createCreditPartner(input: CreditPartnerInput): Promise<CreditPartner> {
  return api.post<CreditPartner>('/v1/credit-partners', input as unknown as Record<string, unknown>);
}

export function updateCreditPartner(
  id: number,
  input: Partial<CreditPartnerInput>,
): Promise<CreditPartner> {
  return api.put<CreditPartner>(
    `/v1/credit-partners/${id}`,
    input as unknown as Record<string, unknown>,
  );
}

export function deleteCreditPartner(id: number): Promise<{ id: number }> {
  return api.del<{ id: number }>(`/v1/credit-partners/${id}`);
}
