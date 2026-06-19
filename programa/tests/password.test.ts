import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../src/utils/password';

describe('password utils', () => {
  it('gera hash e valida a mesma senha', async () => {
    const passwordHash = await hashPassword('SenhaSegura123!');

    expect(passwordHash).not.toBe('SenhaSegura123!');
    await expect(verifyPassword('SenhaSegura123!', passwordHash)).resolves.toBe(
      true,
    );
  });

  it('rejeita senha incorreta', async () => {
    const passwordHash = await hashPassword('SenhaSegura123!');

    await expect(verifyPassword('SenhaErrada', passwordHash)).resolves.toBe(
      false,
    );
  });
});
