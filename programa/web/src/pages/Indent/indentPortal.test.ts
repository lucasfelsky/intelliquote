import { describe, expect, it } from 'vitest';
import type { IndentPortalState } from '@/services/indentEnvio';
import {
  EMAIL_RE,
  formatarDataBr,
  formatarTamanho,
  linkVencido,
  mensagemSentinela,
  parseEmailList,
  resumoEnvio,
  rotuloCampoSentinela,
  tituloToastEnvio,
} from './indentPortal';

// Helpers puros do envio e da secao Portal (PR 4b). Dados sinteticos.

describe('parseEmailList', () => {
  it('quebra em virgula, ponto e virgula e espaco; minusculas; sem duplicados (ordem mantida)', () => {
    expect(parseEmailList('A@X.COM, a@x.com ; b@y.com')).toEqual({ emails: ['a@x.com', 'b@y.com'] });
    expect(parseEmailList('  c@x.test\nd@x.test\te@x.test ')).toEqual({ emails: ['c@x.test', 'd@x.test', 'e@x.test'] });
  });

  it('vazio ou so separadores = lista vazia', () => {
    expect(parseEmailList('')).toEqual({ emails: [] });
    expect(parseEmailList(' ,; \n')).toEqual({ emails: [] });
  });

  it('e-mail invalido = erro literal do backend', () => {
    expect(parseEmailList('a@x.test, sem-arroba')).toEqual({ erro: 'Há um e-mail inválido na lista.' });
    expect(parseEmailList('a@x')).toEqual({ erro: 'Há um e-mail inválido na lista.' });
  });

  it('10 passam; 11 distintos = erro de maximo; 11 com repeticao que dedupa para 10 passa', () => {
    const dez = Array.from({ length: 10 }, (_, i) => `u${i}@x.test`);
    expect(parseEmailList(dez.join(', '))).toEqual({ emails: dez });
    expect(parseEmailList([...dez, 'u10@x.test'].join(', '))).toEqual({ erro: 'Informe no máximo 10 e-mails.' });
    expect(parseEmailList([...dez, 'U0@x.test'].join(', '))).toEqual({ emails: dez });
  });

  it('invalido tem precedencia sobre maximo', () => {
    const muitos = Array.from({ length: 11 }, (_, i) => `u${i}@x.test`);
    expect(parseEmailList([...muitos, 'ruim'].join(','))).toEqual({ erro: 'Há um e-mail inválido na lista.' });
  });

  it('EMAIL_RE: o mesmo criterio do mock', () => {
    expect(EMAIL_RE.test('a@b.co')).toBe(true);
    expect(EMAIL_RE.test('a b@c.co')).toBe(false);
    expect(EMAIL_RE.test('a@b')).toBe(false);
  });
});

describe('sentinela', () => {
  it('rotulos das chaves do backend (5 tipos + desconhecida)', () => {
    expect(rotuloCampoSentinela('subject')).toBe('assunto');
    expect(rotuloCampoSentinela('firstItemName')).toBe('nome do item 1');
    expect(rotuloCampoSentinela('items[0].name')).toBe('nome do item 1');
    expect(rotuloCampoSentinela('items[1].cas')).toBe('CAS do item 2');
    expect(rotuloCampoSentinela('destinationPort')).toBe('porto de destino');
    expect(rotuloCampoSentinela('message')).toBe('mensagem');
    expect(rotuloCampoSentinela('attachments[0].fileName')).toBe('nome do anexo 1');
    expect(rotuloCampoSentinela('algo[9].novo')).toBe('algo[9].novo');
  });

  it('mensagemSentinela troca so o "(campo: X)"; sem o padrao devolve a mensagem', () => {
    expect(mensagemSentinela('O conteúdo do e-mail identifica o cliente (campo: items[0].name). Revise o item ou o porto antes de enviar.')).toBe(
      'O conteúdo do e-mail identifica o cliente (campo: nome do item 1). Revise o item ou o porto antes de enviar.',
    );
    expect(mensagemSentinela('Outra coisa.')).toBe('Outra coisa.');
  });
});

describe('resumoEnvio', () => {
  it('sent e queued entregam; suppressed e failed viram falha com motivo', () => {
    expect(
      resumoEnvio([
        { email: 'a@x.test', status: 'sent' },
        { email: 'b@x.test', status: 'queued' },
        { email: 'c@sqquimica.com', status: 'suppressed' },
        { email: 'd@x.test', status: 'failed', error: 'caixa cheia' },
        { email: 'e@x.test', status: 'failed' },
      ]),
    ).toEqual({
      entregues: ['a@x.test', 'b@x.test'],
      falhas: [
        { email: 'c@sqquimica.com', motivo: 'endereço interno bloqueado (não enviado)' },
        { email: 'd@x.test', motivo: 'caixa cheia' },
        { email: 'e@x.test', motivo: 'falha no envio' },
      ],
    });
  });
});

describe('tituloToastEnvio', () => {
  it('singular, plural e sufixo "(sem parceria)"', () => {
    expect(tituloToastEnvio('275/26', 'Wei Zhang Trading', 1, false)).toBe('Cotação 275/26 enviada para Wei Zhang Trading (1 destinatário)');
    expect(tituloToastEnvio('R2 - 275/26', 'Wei Zhang Trading', 2, false)).toBe('Cotação R2 - 275/26 enviada para Wei Zhang Trading (2 destinatários)');
    expect(tituloToastEnvio('275/26', 'Wei Zhang Trading', 2, true)).toBe('Cotação 275/26 enviada para Wei Zhang Trading (2 destinatários) (sem parceria)');
  });
});

describe('linkVencido', () => {
  const agora = new Date('2026-11-20T12:00:00.000Z');
  const estado = (extra: Partial<IndentPortalState>): IndentPortalState => ({
    state: 'AGUARDANDO',
    lastSentAt: null,
    recipients: [],
    lastAccessAt: null,
    expiresAt: '2026-11-26T18:40:00.000Z',
    canResend: true,
    mails: [],
    response: null,
    attachments: [],
    ...extra,
  });

  it('AGUARDANDO: validade futura = nao vence; passada ou nula = vence', () => {
    expect(linkVencido(estado({}), agora)).toBe(false);
    expect(linkVencido(estado({ expiresAt: '2026-11-19T18:40:00.000Z' }), agora)).toBe(true);
    expect(linkVencido(estado({ expiresAt: null }), agora)).toBe(true);
  });

  it('outros estados nunca sao "vencido"', () => {
    for (const state of ['NAO_ENVIADO', 'MARCADA_SEM_EMAIL', 'RESPONDIDO'] as const) {
      expect(linkVencido(estado({ state, expiresAt: null }), agora)).toBe(false);
    }
  });
});

describe('formatarDataBr / formatarTamanho', () => {
  it('data em Sao Paulo, nunca UTC: 02:30Z do dia 27 ainda e dia 26 em BRT', () => {
    expect(formatarDataBr('2026-11-27T02:30:00.000Z')).toBe('26/11/2026');
    expect(formatarDataBr('2026-11-27T03:00:00.000Z')).toBe('27/11/2026');
  });

  it('vazio ou invalido = "—"', () => {
    expect(formatarDataBr(null)).toBe('—');
    expect(formatarDataBr('')).toBe('—');
    expect(formatarDataBr('lixo')).toBe('—');
  });

  it('tamanhos', () => {
    expect(formatarTamanho(512)).toBe('512 B');
    expect(formatarTamanho(870400)).toBe('850 KB');
    expect(formatarTamanho(1258291)).toBe('1,2 MB');
    expect(formatarTamanho(10 * 1024 * 1024)).toBe('10,0 MB');
    expect(formatarTamanho(1048575)).toBe('1,0 MB');
  });
});
