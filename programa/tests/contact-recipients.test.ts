import { describe, expect, it } from 'vitest';
import { mergeCc, resolveContactRecipients } from '../src/utils/contactRecipients';

const c1 = { id: 1, name: 'Principal', email: 'Principal@Acme.com' };
const c2 = { id: 2, name: 'Segundo', email: 'Segundo@Acme.com' };
const c3 = { id: 3, name: 'Terceiro', email: 'terceiro@acme.com' };

describe('resolveContactRecipients', () => {
  it('1 contato: vai no to e contactCc fica vazio', () => {
    const result = resolveContactRecipients([c1]);
    expect(result?.to.id).toBe(1);
    expect(result?.contactCc).toEqual([]);
  });

  it('3 contatos: principal no to, demais no contactCc na ordem recebida', () => {
    const result = resolveContactRecipients([c1, c2, c3]);
    expect(result?.to.id).toBe(1);
    expect(result?.contactCc.map((c) => c.id)).toEqual([2, 3]);
  });

  it('to mantem a caixa original; contactCc vai em lowercase', () => {
    const result = resolveContactRecipients([c1, c2]);
    expect(result?.to.email).toBe('Principal@Acme.com');
    expect(result?.contactCc[0].email).toBe('segundo@acme.com');
  });

  it('0 contatos devolve null', () => {
    expect(resolveContactRecipients([])).toBeNull();
  });

  it('so contatos invalidos, vazios ou com espacos devolve null', () => {
    expect(
      resolveContactRecipients([
        { id: 1, name: 'A', email: '' },
        { id: 2, name: 'B', email: '   ' },
        { id: 3, name: 'C', email: 'sem-arroba' },
        { id: 4, name: 'D', email: 'a b@acme.com' },
      ]),
    ).toBeNull();
  });

  it('e-mail com espacos nas pontas e aproveitado (trim)', () => {
    const result = resolveContactRecipients([{ id: 1, name: 'A', email: '  a@acme.com  ' }]);
    expect(result?.to.email).toBe('a@acme.com');
  });

  it('e-mail duplicado com caixa diferente aparece 1x', () => {
    const result = resolveContactRecipients([
      c1,
      { id: 5, name: 'Dup', email: 'PRINCIPAL@acme.com' },
      c2,
      { id: 6, name: 'Dup2', email: 'segundo@ACME.com' },
    ]);
    expect(result?.to.id).toBe(1);
    expect(result?.contactCc.map((c) => c.id)).toEqual([2]);
  });

  it('principal invalido: promove o proximo', () => {
    const result = resolveContactRecipients([{ id: 1, name: 'Ruim', email: 'invalido' }, c2, c3]);
    expect(result?.to.id).toBe(2);
    expect(result?.contactCc.map((c) => c.id)).toEqual([3]);
  });

  it('principal comercial (blockedEmails): promove o proximo e o comercial nao entra no cc', () => {
    const result = resolveContactRecipients([c1, c2, c3], {
      blockedEmails: new Set(['principal@acme.com']),
    });
    expect(result?.to.id).toBe(2);
    expect(result?.contactCc.map((c) => c.id)).toEqual([3]);
  });

  it('todos comerciais devolve null', () => {
    expect(
      resolveContactRecipients([c1], { blockedEmails: new Set(['principal@acme.com']) }),
    ).toBeNull();
  });

  it('preferredContactId valido vira to mesmo nao sendo o primeiro', () => {
    const result = resolveContactRecipients([c1, c2, c3], { preferredContactId: 3 });
    expect(result?.to.id).toBe(3);
    expect(result?.contactCc.map((c) => c.id)).toEqual([1, 2]);
  });

  it('preferredContactId inexistente cai na ordem recebida', () => {
    const result = resolveContactRecipients([c1, c2], { preferredContactId: 99 });
    expect(result?.to.id).toBe(1);
  });

  it('preferredContactId invalido (e-mail ruim) cai na ordem recebida', () => {
    const result = resolveContactRecipients(
      [c1, { id: 7, name: 'Ruim', email: 'invalido' }, c2],
      { preferredContactId: 7 },
    );
    expect(result?.to.id).toBe(1);
    expect(result?.contactCc.map((c) => c.id)).toEqual([2]);
  });

  it('preferredContactId bloqueado (comercial) cai na ordem recebida', () => {
    const result = resolveContactRecipients([c1, c2], {
      preferredContactId: 2,
      blockedEmails: new Set(['segundo@acme.com']),
    });
    expect(result?.to.id).toBe(1);
    expect(result?.contactCc).toEqual([]);
  });
});

describe('mergeCc', () => {
  it('nunca repete o to (caixa diferente)', () => {
    expect(mergeCc('Joao@Acme.com', [{ email: 'joao@acme.com' }, { email: 'x@acme.com' }])).toEqual([
      { email: 'x@acme.com', name: '' },
    ]);
  });

  it('dedupe entre listas mantem a primeira ocorrencia e o nome', () => {
    expect(
      mergeCc(
        'to@acme.com',
        [{ email: 'A@acme.com', name: 'Contato A' }],
        [{ email: 'a@ACME.com' }, { email: 'b@acme.com' }],
      ),
    ).toEqual([
      { email: 'a@acme.com', name: 'Contato A' },
      { email: 'b@acme.com', name: '' },
    ]);
  });

  it('descarta vazio e invalido, faz trim e lowercase', () => {
    expect(
      mergeCc('to@acme.com', [
        { email: '' },
        { email: '   ' },
        { email: 'nao-e-email' },
        { email: '  Ok@Acme.com ' },
      ]),
    ).toEqual([{ email: 'ok@acme.com', name: '' }]);
  });

  it('sem listas devolve vazio', () => {
    expect(mergeCc('to@acme.com')).toEqual([]);
  });
});
