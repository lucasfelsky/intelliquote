import { api } from '@/api/client';

export interface ForwarderContact {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
}

export interface Forwarder {
  id: number;
  companyName: string;
  address: string | null;
  website: string | null;
  notes: string | null;
  isActive: boolean;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
  contacts: ForwarderContact[];
}

export interface ForwarderContactInput {
  /** Presente = atualiza o contato existente; ausente = cria. */
  id?: number;
  name: string;
  email?: string | null;
  phone?: string | null;
}

export interface ForwarderInput {
  companyName: string;
  address?: string | null;
  website?: string | null;
  notes?: string | null;
  isActive?: boolean;
  isDefault?: boolean;
  contacts: ForwarderContactInput[];
}

export function listForwarders(params?: { active?: boolean }): Promise<Forwarder[]> {
  const query =
    params?.active === undefined ? undefined : { active: params.active ? 'true' : 'false' };
  return api.get<Forwarder[]>('/v1/forwarders', query);
}

export function createForwarder(input: ForwarderInput): Promise<Forwarder> {
  return api.post<Forwarder>('/v1/forwarders', input as unknown as Record<string, unknown>);
}

export function updateForwarder(id: number, input: Partial<ForwarderInput>): Promise<Forwarder> {
  return api.put<Forwarder>(`/v1/forwarders/${id}`, input as unknown as Record<string, unknown>);
}

export function deleteForwarder(id: number): Promise<{ id: number }> {
  return api.del<{ id: number }>(`/v1/forwarders/${id}`);
}

// Texto que PREENCHE o campo "Contato do despachante" do envio da PO (continua editavel).
// Uma linha por item: empresa, endereco e um contato por linha ("nome · e-mail · telefone",
// omitindo partes vazias). `notes` (uso interno) e `website` ficam de fora.
export function formatForwarderInfo(forwarder: Forwarder): string {
  const lines: string[] = [forwarder.companyName.trim()];
  const address = forwarder.address?.trim();
  if (address) lines.push(address);
  for (const contact of forwarder.contacts) {
    const parts = [contact.name, contact.email, contact.phone]
      .map((part) => (part ?? '').trim())
      .filter((part) => part.length > 0);
    if (parts.length > 0) lines.push(parts.join(' · '));
  }
  return lines.join('\n');
}
