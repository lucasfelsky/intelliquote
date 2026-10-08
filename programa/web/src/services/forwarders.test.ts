import { describe, expect, it } from 'vitest';
import { formatForwarderInfo, type Forwarder } from './forwarders';

function forwarder(overrides: Partial<Forwarder> = {}): Forwarder {
  return {
    id: 1,
    companyName: 'Global Cargo',
    address: null,
    website: null,
    notes: null,
    isActive: true,
    isDefault: false,
    createdAt: '2026-10-08T12:00:00.000Z',
    updatedAt: '2026-10-08T12:00:00.000Z',
    contacts: [],
    ...overrides,
  };
}

describe('formatForwarderInfo', () => {
  it('so a empresa quando nao ha endereco nem contatos', () => {
    expect(formatForwarderInfo(forwarder())).toBe('Global Cargo');
  });

  it('empresa + endereco', () => {
    expect(formatForwarderInfo(forwarder({ address: 'Rua A, 10 - Santos/SP' }))).toBe(
      'Global Cargo\nRua A, 10 - Santos/SP',
    );
  });

  it('contato so com nome omite as partes vazias', () => {
    const text = formatForwarderInfo(
      forwarder({ contacts: [{ id: 1, name: 'Maria', email: null, phone: null }] }),
    );
    expect(text).toBe('Global Cargo\nMaria');
  });

  it('contato com nome, e-mail e telefone usa " · " e uma linha por contato', () => {
    const text = formatForwarderInfo(
      forwarder({
        address: 'Rua A',
        contacts: [
          { id: 1, name: 'Maria', email: 'maria@x.com', phone: '+55 11 9999' },
          { id: 2, name: 'Beto', email: 'beto@x.com', phone: null },
        ],
      }),
    );
    expect(text).toBe(
      'Global Cargo\nRua A\nMaria · maria@x.com · +55 11 9999\nBeto · beto@x.com',
    );
  });

  it('notes e website nao aparecem no texto', () => {
    const text = formatForwarderInfo(
      forwarder({ notes: 'Nota interna secreta', website: 'https://global.example.com' }),
    );
    expect(text).not.toContain('secreta');
    expect(text).not.toContain('global.example.com');
  });
});
