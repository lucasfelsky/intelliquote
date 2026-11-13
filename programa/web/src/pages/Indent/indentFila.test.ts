import { describe, expect, it } from 'vitest';
import { ApiError } from '@/api/client';
import {
  filaFrase,
  filaRotulo,
  formatarDataHora,
  formatarKg,
  mensagemDoErro,
  parseQuantidadePtBr,
  primeiraPalavra,
  rotuloRegra,
  statusRotulo,
} from './indentFila';

describe('indentFila', () => {
  it('filaRotulo: hoje/1 dia neutros, 2 no limite, 3+ atrasada, null sem rotulo', () => {
    expect(filaRotulo(0)).toEqual({ texto: 'hoje', classe: 'badge badge--muted' });
    expect(filaRotulo(1)).toEqual({ texto: '1 dia', classe: 'badge badge--muted' });
    expect(filaRotulo(2)).toEqual({ texto: '2 dias · no limite', classe: 'badge badge--warning' });
    expect(filaRotulo(3)).toEqual({ texto: '3 dias · atrasada', classe: 'badge badge--danger' });
    expect(filaRotulo(null)).toBeNull();
  });

  it('filaFrase do subtitulo do detalhe', () => {
    expect(filaFrase(0)).toBe('chegou hoje à fila');
    expect(filaFrase(1)).toBe('na fila há 1 dia');
    expect(filaFrase(4)).toBe('na fila há 4 dias');
    expect(filaFrase(null)).toBeNull();
  });

  it('statusRotulo: cliente pendente sobrepoe a NOVA', () => {
    expect(statusRotulo('NOVA', false).rotulo).toBe('Nova');
    expect(statusRotulo('NOVA', true)).toEqual({ rotulo: 'Cliente pendente', classe: 'badge badge--dot badge--warning' });
    expect(statusRotulo('COTACAO', false).rotulo).toBe('Em cotação');
    expect(statusRotulo('RESPONDIDA', false).classe).toContain('badge--success');
    expect(statusRotulo('CONVERTIDA', false).rotulo).toBe('Convertida');
    expect(statusRotulo('PERDIDA', false).classe).toContain('badge--muted');
  });

  it('rotuloRegra', () => {
    expect(rotuloRegra('APROVADOS')).toBe('Só aprovados');
    expect(rotuloRegra('BLOQUEIO')).toBe('Bloqueios');
    expect(rotuloRegra('LIVRE')).toBeNull();
  });

  it('formatarDataHora usa o fuso de Sao Paulo (dd/mm hh:mm)', () => {
    expect(formatarDataHora('2026-11-12T15:05:00.000Z')).toBe('12/11 12:05');
    // 01:30 UTC ainda e a noite anterior em Sao Paulo.
    expect(formatarDataHora('2026-11-13T01:30:00.000Z')).toBe('12/11 22:30');
    expect(formatarDataHora('2026-11-13T03:00:00.000Z')).toBe('13/11 00:00');
    expect(formatarDataHora(new Date('2026-11-12T15:05:00.000Z'))).toBe('12/11 12:05');
    expect(formatarDataHora(null)).toBe('—');
    expect(formatarDataHora('lixo')).toBe('—');
  });

  it('formatarKg segue o padrao pt-BR', () => {
    expect(formatarKg(25000)).toBe('25.000');
    expect(formatarKg(1.5)).toBe('1,5');
  });

  it('parseQuantidadePtBr aceita pt-BR e recusa texto', () => {
    expect(parseQuantidadePtBr('25.000')).toBe(25000);
    expect(parseQuantidadePtBr('25000')).toBe(25000);
    expect(parseQuantidadePtBr('1,5')).toBe(1.5);
    expect(parseQuantidadePtBr('1.234,56')).toBe(1234.56);
    expect(parseQuantidadePtBr(' 0,5 ')).toBe(0.5);
    expect(parseQuantidadePtBr('1.5')).toBe(1.5);
    expect(parseQuantidadePtBr('')).toBeNull();
    expect(parseQuantidadePtBr('abc')).toBeNull();
    expect(parseQuantidadePtBr('1,2,3')).toBeNull();
    expect(parseQuantidadePtBr('12.34.567')).toBeNull();
    // Sem heuristica "menos de 1000 vira tonelada".
    expect(parseQuantidadePtBr('25')).toBe(25);
  });

  it('primeiraPalavra', () => {
    expect(primeiraPalavra('Acme Chemicals Co.')).toBe('Acme');
    expect(primeiraPalavra('Solo')).toBe('Solo');
  });

  it('mensagemDoErro prefere o message do corpo da API', () => {
    expect(mensagemDoErro(new ApiError(409, { message: 'As cotações desta solicitação já foram geradas.' }))).toBe(
      'As cotações desta solicitação já foram geradas.',
    );
    expect(mensagemDoErro(new ApiError(500, null, 'falhou'))).toBe('falhou');
    expect(mensagemDoErro(new Error('rede'))).toBe('rede');
    expect(mensagemDoErro('x')).toBe('Erro desconhecido.');
  });
});
