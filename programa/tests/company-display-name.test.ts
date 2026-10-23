import { describe, expect, it, vi } from 'vitest';

// O service importa o prisma real; aqui so testamos a funcao pura.
vi.mock('../src/lib/prisma', () => ({ prisma: {} }));

import { companyDisplayName } from '../src/services/CompanyProfileService';

const RAZAO = 'SQ QUIMICA IMPORTADORA E DISTRIBUIDORA DE PRODUTOS QUIMICOS LTDA';

describe('companyDisplayName', () => {
  it('usa o nome fantasia quando preenchido', () => {
    expect(companyDisplayName({ companyName: RAZAO, tradeName: 'SQ QUIMICA' })).toBe('SQ QUIMICA');
  });

  it('aplica trim no nome fantasia', () => {
    expect(companyDisplayName({ companyName: RAZAO, tradeName: '  SQ QUIMICA  ' })).toBe(
      'SQ QUIMICA',
    );
  });

  it('cai na razao social quando tradeName e null', () => {
    expect(companyDisplayName({ companyName: RAZAO, tradeName: null })).toBe(RAZAO);
  });

  it('cai na razao social quando tradeName esta ausente', () => {
    expect(companyDisplayName({ companyName: RAZAO })).toBe(RAZAO);
    expect(companyDisplayName({ companyName: RAZAO, tradeName: undefined })).toBe(RAZAO);
  });

  it('cai na razao social quando tradeName e vazio ou so espacos', () => {
    expect(companyDisplayName({ companyName: RAZAO, tradeName: '' })).toBe(RAZAO);
    expect(companyDisplayName({ companyName: RAZAO, tradeName: '   ' })).toBe(RAZAO);
  });
});
