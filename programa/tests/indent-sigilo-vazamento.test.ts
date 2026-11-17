import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/prisma', async () => (await import('./helpers/indentRoutesMock')).createIndentPrismaModule());
vi.mock('../src/mailer/MailerService', async (original) =>
  (await import('./helpers/indentEnvioFixtures')).createMailerModule(await original<Record<string, unknown>>()),
);
import '../src/app'; // carrega o app na coleta, fora do timeout do 1o teste (o helper importa tarde)

import { buildClientTerms, findClientLeak, hasForbiddenBuyerPhrase } from '../src/utils/indentExposure';
import { call, loginAs, quoteItemRow, tx } from './helpers/indentRoutesMock';
import {
  activeToken,
  draftQuote,
  envioClient,
  envioSupplier,
  expectNothingSent,
  mailerMock,
  outroCliente,
  resetEnvioMocks,
  sendBody,
  sentMails,
  sentWithTokens,
} from './helpers/indentEnvioFixtures';

// Sigilo do cliente final no envio do IQ Indent (PR 4a), com NOMES FICTICIOS (repo publico): o e-mail (HTML, texto e assunto)
// de um fornecedor SEM parceria nunca cita o cliente nem frases como "buyer". Usuario logado: id 7.
// (A parte do portal publico entra no 4a-2.)

beforeEach(resetEnvioMocks);

const FORBIDDEN = /\b(buyer|purchaser|on behalf of|our customer|comprador|nosso cliente)\b/i;

function expectNoClientIn(mail: Record<string, unknown>, client: { name: string; cnpj: string }) {
  const terms = buildClientTerms(client);
  const fields = { subject: String(mail.subject), html: String(mail.html), text: String(mail.text) };

  // A checagem usa o mesmo normalizador do backend (acento, caixa e pontuacao).
  expect(findClientLeak(fields, terms)).toBeNull();
  expect(hasForbiddenBuyerPhrase(fields.html)).toBe(false);
  expect(fields.html).not.toMatch(FORBIDDEN);
  expect(fields.text).not.toMatch(FORBIDDEN);
  expect(fields.subject).not.toMatch(FORBIDDEN);
  expect(fields.html).not.toContain('End customer');
  expect(fields.text).not.toContain('End customer');
}

// Item livre com o nome dado (sem produto): o nome do item vem da descricao.
function quoteWithItem(name: string, overrides: Record<string, unknown> = {}) {
  const base = quoteItemRow(201, 21);
  return draftQuote({
    items: [{ ...base, requestItem: { ...base.requestItem, productId: null, product: null, description: name } }],
    ...overrides,
  });
}

describe('sigilo do cliente no envio', () => {
  it('nome do cliente sem parceria -> 400 em showClientName', async () => {
    const cookie = await loginAs('comprador');

    const res = await call('post', '/quotes/100/send', cookie, sendBody({ showClientName: true }));

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Este fornecedor não tem parceria firmada: o nome do cliente não pode ser exibido.');
    expect(res.body.path).toBe('showClientName');
    expectNothingSent();
  });

  it('porto que identifica o cliente -> 400, com ou sem parceria', async () => {
    const cookie = await loginAs('comprador');
    const destinationPort = 'Terminal Industria Quimica Vale do Itajai';

    for (const hasPartnership of [false, true]) {
      tx.indentSupplier.findUnique.mockResolvedValue(envioSupplier({ hasPartnership }));
      const res = await call('post', '/quotes/100/send', cookie, sendBody({ destinationPort }));
      expect(res.status, String(hasPartnership)).toBe(400);
      expect(res.body.message).toBe('O porto de destino identifica o cliente. Informe só o porto.');
      expect(res.body.path).toBe('destinationPort');
    }
    expectNothingSent();
  });

  it('mensagem com o cliente ou frase proibida: barrada sem parceria, livre com parceria', async () => {
    const cookie = await loginAs('comprador');
    const literal =
      'A mensagem cita o cliente ou diz que a SQ é a compradora. Remova antes de enviar: este fornecedor não tem parceria firmada.';

    for (const message of ['This is for Industria Quimica Vale do Itajai Ltda', 'We are the buyer of this lot', 'Somos a compradora']) {
      const res = await call('post', '/quotes/100/send', cookie, sendBody({ message }));
      expect(res.status, message).toBe(400);
      expect(res.body.message).toBe(literal);
      expect(res.body.path).toBe('message');
    }
    expectNothingSent();

    tx.indentSupplier.findUnique.mockResolvedValue(envioSupplier({ hasPartnership: true }));
    const ok = await call('post', '/quotes/100/send', cookie, sendBody({ message: 'This is for Industria Quimica Vale do Itajai Ltda' }));
    expect(ok.status).toBe(200);
  });

  it('sentinela: item com o nome do cliente -> 422 com a CHAVE do campo, sem o valor, e nada enviado', async () => {
    const cookie = await loginAs('comprador');
    tx.indentQuote.findUnique.mockResolvedValue(quoteWithItem('Acido citrico (Industria Quimica Vale do Itajai)'));
    const warned: string[] = [];
    const spy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => void warned.push(args.map(String).join(' ')));

    const res = await call('post', '/quotes/100/send', cookie, sendBody());
    spy.mockRestore();

    expect(res.status).toBe(422);
    expect(res.body.message).toBe(
      'O conteúdo do e-mail identifica o cliente (campo: subject). Revise o item ou o porto antes de enviar.',
    );
    expect(res.body.message).not.toContain('Vale');
    expect(warned.join('\n')).toContain('"field":"subject"');
    expect(warned.join('\n')).not.toContain('Vale do Itajai');
    expectNothingSent();
  });

  it('com parceria o item pode citar o cliente (sentinela so vale sem parceria)', async () => {
    const cookie = await loginAs('comprador');
    tx.indentSupplier.findUnique.mockResolvedValue(envioSupplier({ hasPartnership: true }));
    tx.indentQuote.findUnique.mockResolvedValue(quoteWithItem('Acido citrico (Industria Quimica Vale do Itajai)'));

    expect((await call('post', '/quotes/100/send', cookie, sendBody())).status).toBe(200);
  });

  it('parceria + showClientName: o nome do cliente entra no e-mail e o token guarda showClientName', async () => {
    const cookie = await loginAs('comprador');
    tx.indentSupplier.findUnique.mockResolvedValue(envioSupplier({ hasPartnership: true }));

    const res = await call('post', '/quotes/100/send', cookie, sendBody({ showClientName: true }));

    expect(res.status).toBe(200);
    expect(tx.indentPortalToken.create.mock.calls[0][0].data.showClientName).toBe(true);
    expect(String(sentMails()[0].html)).toContain(envioClient.name);
    expect(tx.indentMailLog.create.mock.calls[0][0].data).toMatchObject({ hasPartnership: true, showClientName: true });
  });
});

describe('e-mail sem parceria: nenhum termo do cliente, nenhuma frase proibida, nenhum "End customer"', () => {
  for (const client of [envioClient, outroCliente]) {
    describe(client.name, () => {
      beforeEach(() => {
        tx.indentClient.findUnique.mockResolvedValue(client);
      });

      it('novo pedido', async () => {
        const cookie = await loginAs('comprador');

        const res = await call('post', '/quotes/100/send', cookie, sendBody({ message: 'Please send your best offer.' }));

        expect(res.status).toBe(200);
        expectNoClientIn(sentMails()[0], client);
      });

      it('revisao R2', async () => {
        const cookie = await loginAs('comprador');
        tx.indentQuote.findUnique.mockResolvedValue(draftQuote({ revision: 2, baseQuoteId: 99 }));

        const res = await call('post', '/quotes/100/send', cookie, sendBody());

        expect(res.status).toBe(200);
        expectNoClientIn(sentMails()[0], client);
      });

      it('reenvio', async () => {
        const cookie = await loginAs('comprador');
        tx.indentQuote.findUnique.mockResolvedValue(sentWithTokens());
        tx.indentPortalToken.findMany.mockResolvedValue([activeToken(11, 'wei@acme.test')]);

        const res = await call('post', '/quotes/100/resend', cookie, {});

        expect(res.status).toBe(200);
        expectNoClientIn(sentMails()[0], client);
      });
    });
  }

  it('reenvio com a parceria desligada depois do envio: o nome do cliente some, mesmo se o envio original o mostrava', async () => {
    const cookie = await loginAs('comprador');
    tx.indentQuote.findUnique.mockResolvedValue(sentWithTokens());
    tx.indentPortalToken.findMany.mockResolvedValue([activeToken(11, 'wei@acme.test', { showClientName: true })]);
    tx.indentSupplier.findUnique.mockResolvedValue(envioSupplier({ hasPartnership: false }));

    const res = await call('post', '/quotes/100/resend', cookie, {});

    expect(res.status).toBe(200);
    expect(tx.indentPortalToken.create.mock.calls[0][0].data.showClientName).toBe(false);
    expectNoClientIn(sentMails()[0], envioClient);
  });

  it('reenvio: mensagem do envio original que passou a citar o cliente (parceria caiu) -> 422 e nada enviado', async () => {
    const cookie = await loginAs('comprador');
    tx.indentQuote.findUnique.mockResolvedValue(sentWithTokens());
    tx.indentPortalToken.findMany.mockResolvedValue([
      activeToken(11, 'wei@acme.test', { message: 'For Industria Quimica Vale do Itajai Ltda', showClientName: true }),
    ]);

    const res = await call('post', '/quotes/100/resend', cookie, {});

    expect(res.status).toBe(422);
    expect(mailerMock.sendAndLog).not.toHaveBeenCalled();
    expect(tx.indentPortalToken.create).not.toHaveBeenCalled();
  });
});

describe('contraprovas: o cliente aparece so quando deve', () => {
  it('parceiro COM a opcao: o nome do cliente aparece (HTML e texto)', async () => {
    const cookie = await loginAs('comprador');
    tx.indentSupplier.findUnique.mockResolvedValue(envioSupplier({ hasPartnership: true }));

    const res = await call('post', '/quotes/100/send', cookie, sendBody({ showClientName: true }));

    expect(res.status).toBe(200);
    expect(String(sentMails()[0].html)).toContain('End customer');
    expect(String(sentMails()[0].html)).toContain(envioClient.name);
    expect(String(sentMails()[0].text)).toContain(`End customer: ${envioClient.name}`);
  });

  it('parceiro SEM a opcao: o nome do cliente nao aparece', async () => {
    const cookie = await loginAs('comprador');
    tx.indentSupplier.findUnique.mockResolvedValue(envioSupplier({ hasPartnership: true }));

    const res = await call('post', '/quotes/100/send', cookie, sendBody({ showClientName: false }));

    expect(res.status).toBe(200);
    expect(String(sentMails()[0].html)).not.toContain(envioClient.name);
    expect(String(sentMails()[0].html)).not.toContain('End customer');
  });

  it('sem parceria, o nome do cliente no item -> 422 e nada enviado', async () => {
    const cookie = await loginAs('comprador');
    tx.indentQuote.findUnique.mockResolvedValue(quoteWithItem('Citric acid for Industria Quimica Vale do Itajai Ltda'));

    const res = await call('post', '/quotes/100/send', cookie, sendBody());

    expect(res.status).toBe(422);
    expectNothingSent();
  });

  it('o HTML escapa a mensagem do fornecedor sem parceria (sem tag solta)', async () => {
    const cookie = await loginAs('comprador');

    const res = await call('post', '/quotes/100/send', cookie, sendBody({ message: '<b>Bold</b> & "quotes"' }));

    expect(res.status).toBe(200);
    expect(String(sentMails()[0].html)).toContain('&lt;b&gt;Bold&lt;/b&gt; &amp; &quot;quotes&quot;');
  });
});
