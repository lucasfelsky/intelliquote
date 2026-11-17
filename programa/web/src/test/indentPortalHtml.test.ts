// Executa o HTML e o JS REAIS de public/indent-portal.* no jsdom (fetch mockado) e confere: telas, formulario, validacao no cliente,
// payload do POST, erros do servidor, token fora da URL e texto escapado (XSS). Anexos em indentPortalAnexos.test.ts; regras puras em indentPortalLogica.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TOKEN, API, XSS, PACKAGING, PAYMENT, dayKey, Json, makeView, makeSent, Reply, installFetch, mountPage, loaded, app, el, text, state, h1, type, fillOffer, submit, posts, ok, chooseFiles } from './indentPortalPage.helpers';

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('abertura: pedido novo', () => {
  it('parceiro: Requested by / End customer, destino, base de preco, validade e itens; fetch sem token fora da URL', async () => {
    const mock = installFetch(() => ok(makeView({ message: 'Please quote by Friday.' })));
    mountPage();
    await loaded();

    expect(state()).toBe('open');
    expect(app().hasAttribute('aria-busy')).toBe(false);
    expect(document.title).toBe('SQ Quimica · Indent request');
    expect(h1()).toBe('Indent request');
    expect(document.querySelector('.p-num small')?.textContent).toBe('Request no.');
    expect(document.querySelector('.p-num b')?.textContent).toBe('275/26');
    const meta = [...document.querySelectorAll('.p-meta > div')].map((row) => `${row.querySelector('dt')?.textContent}=${row.querySelector('dd')?.textContent}`);

    expect(meta).toEqual([
      'Requested by=SQ Quimica',
      'End customer=Industria Quimica Vale do Itajai Ltda',
      'Destination=Itajai',
      'Price basis=FOB origin and CFR Itajai',
      'Link expires=26 Nov 2030',
    ]);
    expect([...document.querySelectorAll('.p-tbl tbody tr')].map((tr) => tr.textContent)).toEqual(['Citric acid anhydrous77-92-925,000 kg', 'Sodium tripolyphosphate (STPP)7758-29-410,000 kg']);
    expect(document.querySelector('.p-banner.amber')?.textContent).toContain('Message from SQ Quimica');
    expect(document.querySelector('.p-banner.amber')?.textContent).toContain('Please quote by Friday.');
    expect(el('submit').textContent).toBe('Submit offer');
    expect(document.querySelector('label[for="cfr0"]')?.textContent).toBe('CFR Itajai price per kg');
    expect(document.querySelector('#cfr0-h')?.textContent).toBe('Including ocean freight to Itajai');
    expect(el('files').getAttribute('accept')).toBe('.pdf,application/pdf');
    expect([...document.querySelectorAll('.p-step')].map((step) => step.className)).toEqual(['p-step done', 'p-step on', 'p-step']);
    expect(mock).toHaveBeenCalledTimes(1);
    const [url, init] = mock.mock.calls[0] as unknown as [string, RequestInit];

    expect(url).toBe(API);
    expect(init).toMatchObject({ method: 'GET', cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
    expect(Object.keys(init.headers as Record<string, string>).map((key) => key.toLowerCase())).not.toContain('accept');
  });

  it('sem parceria: Request type no lugar do cliente; nenhum dado de cliente no DOM', async () => {
    installFetch(() => ok(makeView({ endCustomer: null })));
    mountPage();
    await loaded();

    expect(text()).toContain('Request type');
    expect(text()).not.toContain('End customer');
    expect(text()).not.toMatch(/Industria|Vale do Itajai/);
  });

  it('os rotulos de todos os campos existem e apontam para o controle certo', async () => {
    installFetch(() => ok(makeView({ manufacturerRequired: true })));
    mountPage();
    await loaded();

    for (const id of ['pkg0', 'fob0', 'cfr0', 'pkg1', 'fob1', 'cfr1', 'cur', 'lead', 'pay', 'valid', 'maker', 'notes', 'files']) {
      const control = el(id);

      expect(control, id).not.toBeNull();
      expect(document.querySelector(`label[for="${id}"]`) ?? document.getElementById('files-t'), id).not.toBeNull();
    }
    expect(el('maker').getAttribute('aria-required')).toBe('true');
    expect(el('valid').getAttribute('min')).toBe(dayKey(0));
    expect(el('valid').getAttribute('max')).toBe(dayKey(365));
    expect(el('lead').getAttribute('inputmode')).toBe('numeric');
    expect(el('fob0').getAttribute('inputmode')).toBe('decimal');
    expect(el('notes').getAttribute('maxlength')).toBe('2000');
    expect(document.querySelectorAll('#pkg0 option')).toHaveLength(PACKAGING.length + 1);
  });

  it('total ao vivo: linha e total somam CFR x quantidade; a moeda muda as unidades', async () => {
    installFetch(() => ok(makeView()));
    mountPage();
    await loaded();

    expect(el('tot').textContent).toBe('—');
    type('cfr0', '0,795');
    expect(el('line0').textContent).toBe('US$ 19,875.00');
    type('cfr1', '1.015');
    expect(el('tot').textContent).toBe('US$ 30,025.00');
    type('cur', 'EUR');
    expect(el('tot').textContent).toBe('€ 30,025.00');
    expect(document.querySelector('.p-item [data-slot="cur"]')?.textContent).toBe('EUR/kg');
    type('valid', '2030-11-30');
    expect(el('sv').textContent).toBe('30 Nov 2030');
  });
});

describe('revisao e enviado', () => {
  it('revisao: oferta anterior preenchida, embalagem fora da lista vazia, titulo, rotulo e banner', async () => {
    const previous = {
      currency: 'USD',
      productionLeadTimeDays: 20,
      paymentTerms: PAYMENT[1],
      validUntil: '2030-11-30',
      manufacturer: 'Own production, Shandong',
      items: [
        { quoteItemId: 201, packaging: '25 kg bag', fobPricePerKg: '0.7200', cfrPricePerKg: '0.7950' },
        { quoteItemId: 202, packaging: '40 kg bag', fobPricePerKg: '0.9400', cfrPricePerKg: '1.0150' },
      ],
    };
    installFetch(() => ok(makeView({ state: 'revision', revision: 2, processRef: 'R2 - 275/26', previousOffer: previous, message: 'Could you improve the CFR price for STPP?' })));
    mountPage();
    await loaded();

    expect(state()).toBe('revision');
    expect(h1()).toBe('Price update requested');
    expect(document.querySelector('.p-num small')?.textContent).toBe('Revision of request');
    expect(document.querySelector('.p-num b')?.textContent).toBe('R2 - 275/26');
    expect(el('pkg0').value).toBe('25 kg bag');
    expect(el('pkg1').value).toBe('');
    expect(el('fob0').value).toBe('0.720');
    expect(el('cfr1').value).toBe('1.015');
    expect(el('lead').value).toBe('20');
    expect(el('pay').value).toBe(PAYMENT[1]);
    expect(el('valid').value).toBe('2030-11-30');
    expect(el('maker').value).toBe('Own production, Shandong');
    expect(document.querySelector('.p-banner.amber')?.textContent).toContain('SQ Quimica asked you to review your prices');
    expect(document.querySelector('.p-banner.amber')?.textContent).toContain('Message from SQ Quimica: "Could you improve the CFR price for STPP?"');
    expect(document.querySelector('.p-banner.amber')?.textContent).toContain('Your previous offer is filled in below.');
    expect(el('submit').textContent).toBe('Send updated offer');
    expect(el('tot').textContent).toBe('US$ 30,025.00');
  });

  it('enviado: resumo, "Received on ... revision N", sem formulario; "Edit and send again" abre a edicao com a resposta preenchida', async () => {
    installFetch(() => ok(makeSent({ revision: 2, processRef: 'R2 - 275/26', attachments: [{ id: 1, fileName: 'coa.pdf', fileSize: 100, createdAt: '2026-11-12T18:00:00.000Z' }] })));
    mountPage();
    await loaded();

    expect(state()).toBe('sent');
    expect(document.title).toBe('SQ Quimica · Offer received');
    expect(h1()).toBe('Offer received');
    expect(document.querySelectorAll('.p-step.done')).toHaveLength(3);
    expect(text()).toContain('Your offer was sent');
    expect(text()).toContain('Received on 12 Nov 2026, 15:42 · revision 2. We will contact you if we need anything else.');
    expect(document.querySelector('form')).toBeNull();
    expect([...document.querySelectorAll('.p-tbl tbody tr')].map((tr) => tr.textContent)).toEqual(['Citric acid anhydrous25 kg bag25,000 kg0.7200.795', 'Sodium tripolyphosphate (STPP)50 kg bag10,000 kg0.9401.015']);
    const list = [...document.querySelectorAll('.p-list li')].map((li) => li.textContent);

    expect(list).toEqual([
      'Estimated total, CFR ItajaiUS$ 30,025.00',
      'Production lead time20 days',
      'Payment termsT/T 60 days after B/L date',
      'Valid until30 Nov 2030',
      'ManufacturerOwn production, Shandong',
      'Documentscoa.pdf',
      'NotesPrices ex-works.',
    ]);

    el<HTMLButtonElement>('edit').click();

    expect(state()).toBe('edit');
    expect(document.activeElement?.className).toContain('p-h1');
    expect(document.querySelector('.p-banner.amber')?.textContent).toContain('You are updating the offer you sent on 12 Nov 2026, 15:42');
    expect(document.querySelector('.p-banner.amber')?.textContent).toContain('Sending again replaces the previous offer; both stay on record.');
    expect(el('fob1').value).toBe('0.940');
    expect(el('notes').value).toBe('Prices ex-works.');
    expect(el('submit').textContent).toBe('Send updated offer');
    expect(document.querySelectorAll('#filelist li')).toHaveLength(1);
  });

  it('enviado: o total do resumo usa a moeda da RESPOSTA (EUR), nao a da cotacao', async () => {
    installFetch(() => ok(makeSent({ response: { ...(makeSent().response as Json), currency: 'EUR' } })));
    mountPage();
    await loaded();

    expect(document.querySelector('.p-list li b')?.textContent).toBe('€ 30,025.00');
  });

  it('resposta registrada manualmente: sem notas e sem versao, valores ausentes viram travessao', async () => {
    const manual = { via: 'manual', version: null, submittedAt: '2026-11-12T18:42:00.000Z', currency: 'USD', productionLeadTimeDays: null, paymentTerms: null, validUntil: null, manufacturer: null, notes: null, items: [{ quoteItemId: 201, packaging: null, fobPricePerKg: '0.7200', cfrPricePerKg: null }] };
    installFetch(() => ok(makeSent({ response: manual })));
    mountPage();
    await loaded();

    expect(text()).not.toContain('Notes');
    expect(document.querySelectorAll('.p-tbl tbody tr')[0]?.textContent).toBe('Citric acid anhydrous—25,000 kg0.720—');
    expect(document.querySelectorAll('.p-tbl tbody tr')[1]?.textContent).toBe('Sodium tripolyphosphate (STPP)—10,000 kg——');
  });
});

describe('envio da oferta', () => {
  it('payload EXATO (virgula vira ponto, textos aparados, null para vazio), monta o enviado SEM novo GET e mostra o total', async () => {
    const mock = installFetch((method) => (method === 'POST' ? ok({ version: 1, submittedAt: '2026-11-12T18:42:00.000Z', revised: false, unchanged: false }, 201) : ok(makeView())));
    mountPage();
    await loaded();
    fillOffer({ notes: '   ' });
    submit();
    await vi.waitFor(() => expect(state()).toBe('sent'));

    const [url, init] = posts(mock)[0] as unknown as [string, RequestInit];

    expect(url).toBe(`${API}/respond`);
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({
      currency: 'USD',
      productionLeadTimeDays: 20,
      paymentTerms: PAYMENT[1],
      validUntil: dayKey(30),
      manufacturer: 'Own production, Shandong',
      notes: null,
      items: [
        { quoteItemId: 201, packaging: '25 kg bag', fobPricePerKg: '0.720', cfrPricePerKg: '0.795' },
        { quoteItemId: 202, packaging: '50 kg bag', fobPricePerKg: '0.94', cfrPricePerKg: '1.0150' },
      ],
    });
    expect(mock).toHaveBeenCalledTimes(2);
    expect(text()).toContain('Received on 12 Nov 2026, 15:42.');
    expect(text()).toContain('US$ 30,025.00');
    expect(document.activeElement?.className).toContain('p-h1');
    expect(document.querySelector('.p-banner.ok')).toBeNull();
  });

  it('"unchanged: true" mostra o banner de nada mudou e mantem a versao', async () => {
    installFetch((method) => (method === 'POST' ? ok({ version: 3, submittedAt: '2026-11-12T18:42:00.000Z', revised: true, unchanged: true }) : ok(makeSent())));
    mountPage();
    await loaded();
    el<HTMLButtonElement>('edit').click();
    type('valid', dayKey(40));
    submit();
    await vi.waitFor(() => expect(state()).toBe('sent'));

    expect(document.querySelector('.p-banner.ok')?.textContent).toContain('No changes were detected');
    expect(document.querySelector('.p-banner.ok')?.textContent).toContain('Your previous offer stays on record.');
  });

  it('botao fica desabilitado com aria-busy e "Sending..." enquanto espera; clique duplo nao envia 2x', async () => {
    let release: (reply: Reply) => void = () => undefined;
    const mock = installFetch((method) => (method === 'POST' ? new Promise<Reply>((resolve) => { release = resolve; }) : ok(makeView())));
    mountPage();
    await loaded();
    fillOffer();
    submit();
    submit();

    expect(el<HTMLButtonElement>('submit').disabled).toBe(true);
    expect(el('submit').getAttribute('aria-busy')).toBe('true');
    expect(el('submit').textContent).toBe('Sending…');
    expect(posts(mock)).toHaveLength(1);
    release(ok({ version: 1, submittedAt: '2026-11-12T18:42:00.000Z' }, 201));
    await vi.waitFor(() => expect(state()).toBe('sent'));
  });
});

describe('Enter nos campos (D144)', () => {
  it('Enter em campo de preco/numero NAO envia; textarea e botao seguem normais; so o botao envia (1 POST)', async () => {
    const mock = installFetch((method) => (method === 'POST' ? ok({ version: 1, submittedAt: '2026-11-12T18:42:00.000Z' }, 201) : ok(makeView())));
    mountPage();
    await loaded();
    fillOffer();
    const enter = (id: string) => {
      const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
      el(id).dispatchEvent(event);
      return event.defaultPrevented;
    };

    expect(['fob0', 'cfr1', 'lead', 'valid', 'maker'].map(enter)).toEqual([true, true, true, true, true]);
    expect([enter('notes'), enter('submit'), enter('files')]).toEqual([false, false, false]);
    expect(posts(mock)).toHaveLength(0);
    submit();
    await vi.waitFor(() => expect(state()).toBe('sent'));

    expect(posts(mock)).toHaveLength(1);
  });
});

describe('validacao no cliente', () => {
  it('formulario vazio: um erro por campo, aria-invalid, aria-describedby com ajuda + erro, banner role=alert e foco no primeiro; nenhum POST', async () => {
    const mock = installFetch(() => ok(makeView({ manufacturerRequired: true })));
    mountPage();
    await loaded();
    submit();

    const expected: Record<string, string> = {
      pkg0: 'Choose the packaging.',
      fob0: 'Enter the FOB price.',
      cfr0: 'Enter the CFR price.',
      pkg1: 'Choose the packaging.',
      fob1: 'Enter the FOB price.',
      cfr1: 'Enter the CFR price.',
      lead: 'Enter the lead time in days.',
      pay: 'Choose the payment terms.',
      valid: 'Enter the validity date.',
      maker: 'Please inform the manufacturer.',
    };
    for (const [id, message] of Object.entries(expected)) {
      expect(el(id).getAttribute('aria-invalid'), id).toBe('true');
      expect(document.getElementById(`${id}-e`)?.textContent, id).toBe(message);
      expect(el(id).getAttribute('aria-describedby'), id).toContain(`${id}-e`);
    }
    expect(el('fob0').getAttribute('aria-describedby')).toBe('fob0-h fob0-e');
    expect(el('pkg0').getAttribute('aria-describedby')).toBe('pkg0-e');
    const banner = document.querySelector('.p-banner.err');

    expect(banner?.getAttribute('role')).toBe('alert');
    expect(banner?.textContent).toContain('Check the highlighted fields');
    expect(banner?.textContent).toContain('10 fields need your attention.');
    expect(document.activeElement).toBe(el('pkg0'));
    expect(posts(mock)).toHaveLength(0);
  });

  it('regras por campo: CFR < FOB, CFR = FOB vale, zero, 5 casas, prazo 0/366, validade fora da janela', async () => {
    installFetch(() => ok(makeView()));
    mountPage();
    await loaded();
    fillOffer({ fob0: '0.8', cfr0: '0.79', fob1: '1', cfr1: '1', lead: '366', valid: dayKey(366) });
    submit();

    expect(document.getElementById('cfr0-e')?.textContent).toBe('CFR cannot be lower than FOB.');
    expect(el('cfr1').hasAttribute('aria-invalid')).toBe(false);
    expect(document.getElementById('lead-e')?.textContent).toBe('Production lead time must be 1 to 365 days.');
    expect(document.getElementById('valid-e')?.textContent).toBe('The validity must be between today and 365 days from today.');
    type('fob0', '0');
    type('cfr0', '0.123456');
    type('lead', '0');
    type('valid', dayKey(-1));
    submit();

    expect(document.getElementById('fob0-e')?.textContent).toBe('The price must be greater than zero.');
    expect(document.getElementById('cfr0-e')?.textContent).toBe('Use up to 4 decimal places.');
    expect(document.getElementById('lead-e')?.textContent).toBe('Production lead time must be 1 to 365 days.');
    expect(document.getElementById('valid-e')?.textContent).toBe('The validity must be between today and 365 days from today.');
    type('valid', dayKey(0));
    submit();

    expect(document.getElementById('valid-e')).toBeNull();
    type('valid', dayKey(365));
    submit();

    expect(document.getElementById('valid-e')).toBeNull();
  });

  it('corrigir um campo remove o erro dele e atualiza a contagem do banner; zerar remove o banner', async () => {
    installFetch(() => ok(makeView()));
    mountPage();
    await loaded();
    submit();
    const total = document.querySelectorAll('[aria-invalid="true"]').length;

    type('pkg0', '25 kg bag');

    expect(document.getElementById('pkg0-e')).toBeNull();
    expect(el('pkg0').hasAttribute('aria-invalid')).toBe(false);
    expect(document.querySelector('.p-banner.err')?.textContent).toContain(`${total - 1} fields need your attention.`);
    for (const id of [...document.querySelectorAll('[aria-invalid="true"]')].map((node) => node.id)) type(id, id.startsWith('pkg') ? '25 kg bag' : id === 'pay' ? PAYMENT[0]! : id === 'valid' ? dayKey(5) : '2');
    expect(document.querySelector('.p-banner.err')).toBeNull();
  });
});

describe('erros do servidor no envio', () => {
  async function submitWith(reply: Reply) {
    const mock = installFetch((method) => (method === 'POST' ? reply : ok(makeView())));
    mountPage();
    await loaded();
    fillOffer();
    submit();
    return mock;
  }

  it('400 com path de item: mensagem do servidor no campo certo (cfr do item 2, nunca fob), banner e foco', async () => {
    await submitWith({ status: 400, body: { message: 'CFR cannot be lower than FOB.', path: 'items.1.cfrPricePerKg' } });
    await vi.waitFor(() => expect(el('cfr1').getAttribute('aria-invalid')).toBe('true'));

    expect(document.getElementById('cfr1-e')?.textContent).toBe('CFR cannot be lower than FOB.');
    expect(el('fob1').hasAttribute('aria-invalid')).toBe(false);
    expect(document.activeElement).toBe(el('cfr1'));
    expect(document.querySelector('.p-banner.err')?.textContent).toContain('1 field needs your attention.');
    expect(el<HTMLButtonElement>('submit').disabled).toBe(false);
    expect(el('submit').textContent).toBe('Submit offer');
  });

  it('400 sem campo, 413 e 429: banner com a mensagem do servidor, valores digitados mantidos', async () => {
    for (const reply of [
      { status: 400, body: { message: 'Please fill in every item.', path: 'items' } },
      { status: 400, body: { message: 'The submitted data is invalid.', code: 'BAD_REQUEST' } },
      { status: 413, body: { message: 'The request is too large.', code: 'BODY_TOO_LARGE' } },
      { status: 429, body: { message: 'Too many requests in a short time. Please wait a moment and try again.' } },
    ]) {
      await submitWith(reply);
      await vi.waitFor(() => expect(document.querySelector('.p-banner.err')).not.toBeNull());

      expect(document.querySelector('.p-banner.err')?.textContent).toContain('Your offer was not sent');
      expect(document.querySelector('.p-banner.err')?.textContent).toContain((reply.body as { message: string }).message);
      expect(el('fob0').value).toBe('0,720');
      expect(state()).toBe('open');
      vi.unstubAllGlobals();
    }
  });

  it('500, rede caindo e resposta que nao e JSON: texto generico, botao volta e nada se perde', async () => {
    for (const reply of [{ status: 500, body: { message: 'x' } }, { reject: true }, { status: 502, nonJson: true }]) {
      await submitWith(reply);
      await vi.waitFor(() => expect(document.querySelector('.p-banner.err')).not.toBeNull());

      expect(document.querySelector('.p-banner.err')?.textContent).toContain('Something went wrong on our side. Please try again in a few minutes.');
      expect(el<HTMLButtonElement>('submit').disabled).toBe(false);
      expect(el('cfr1').value).toBe('1.0150');
      vi.unstubAllGlobals();
    }
  });

  it('404 e 410 no envio levam para a tela correspondente', async () => {
    await submitWith({ status: 410, body: { message: 'This link has expired.', code: 'LINK_EXPIRED' } });
    await vi.waitFor(() => expect(state()).toBe('expired'));

    expect(text()).toContain('The link for request 275/26 was valid until 26 Nov 2030.');
    vi.unstubAllGlobals();
    await submitWith({ status: 404, body: { message: 'x', code: 'LINK_INVALID' } });
    await vi.waitFor(() => expect(state()).toBe('invalid'));
  });
});

describe('telas de erro na abertura', () => {
  it('410 LINK_EXPIRED com ref e validade (como o mock), sem cartao de formulario e sem passos', async () => {
    const mock = installFetch(() => ({ status: 410, body: { message: 'This link has expired.', code: 'LINK_EXPIRED', processRef: 'R2 - 275/26', expiresAt: '2026-11-26T14:00:00.000Z' } }));
    mountPage();
    await loaded();

    expect(state()).toBe('expired');
    expect(document.title).toBe('SQ Quimica · Link expired');
    expect(h1()).toBe('Link expired');
    expect(text()).toContain('For your security, this link is no longer valid.');
    expect(text()).toContain('This link has expired');
    expect(document.querySelector('.p-center p')?.textContent).toBe('The link for request R2 - 275/26 was valid until 26 Nov 2026. If you still want to quote, please reply to the e-mail you received and we will send a new link.');
    expect(document.querySelector('.p-center p strong')?.textContent).toBe('R2 - 275/26');
    expect(document.querySelector('.p-num small')?.textContent).toBe('Revision of request');
    expect(document.querySelector('.p-steps')).toBeNull();
    expect(document.querySelector('form')).toBeNull();
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it('410 LINK_EXPIRED sem ref nem data (servidor antigo): texto neutro, sem numero do pedido', async () => {
    installFetch(() => ({ status: 410, body: { message: 'This link has expired.', code: 'LINK_EXPIRED' } }));
    mountPage();
    await loaded();

    expect(document.querySelector('.p-center p')?.textContent).toBe('If you still want to quote, please reply to the e-mail you received and we will send a new link.');
    expect(document.querySelector('.p-num')).toBeNull();
  });

  it.each([
    [410, { message: 'This quotation is closed and no longer accepts responses.', code: 'LINK_CLOSED' }, 'closed', 'This quotation is closed', 'no longer accepts responses'],
    [404, { message: 'This link is invalid.', code: 'LINK_INVALID' }, 'invalid', 'This link is not valid', 'This link is invalid. Please use the latest e-mail from SQ Quimica'],
    [429, { message: 'Access temporarily blocked after several invalid attempts.', code: 'LOCKED' }, 'locked', 'Please try again in a few minutes', 'Access temporarily blocked after several invalid attempts.'],
    [429, { message: 'Too many requests in a short time.' }, 'busy', 'Too many requests', 'Too many requests in a short time.'],
  ])('%s %j -> tela %s', async (status, body, screen, heading, detail) => {
    installFetch(() => ({ status, body }));
    mountPage();
    await loaded();

    expect(state()).toBe(screen);
    expect(document.querySelector('.p-center h2')?.textContent).toBe(heading);
    expect(text()).toContain(detail);
    expect(document.querySelector('form')).toBeNull();
  });

  it('500, rede e HTML no lugar do JSON: "We could not load your request" e "Try again" refaz o GET', async () => {
    for (const reply of [{ status: 500, body: { message: 'x' } }, { reject: true }, { status: 200, nonJson: true }]) {
      let first = true;
      const mock = installFetch(() => {
        if (first) {
          first = false;
          return reply;
        }
        return ok(makeView());
      });
      mountPage();
      await loaded();

      expect(state()).toBe('error');
      expect(document.querySelector('.p-center h2')?.textContent).toBe('We could not load your request');
      expect(text()).toContain('Please check your connection and try again.');
      (document.querySelector('.p-center button') as HTMLButtonElement).click();
      await vi.waitFor(() => expect(state()).toBe('open'));

      expect(mock).toHaveBeenCalledTimes(2);
      vi.unstubAllGlobals();
    }
  });

  it('sem token (ou invalido): tela invalid e NENHUMA chamada a API (nao conta no bloqueio)', async () => {
    for (const url of ['/portal/indent', '/portal/indent?token=curto', `/portal/indent?token=${TOKEN}!`]) {
      const mock = installFetch(() => ok(makeView()));
      mountPage(url);
      await loaded();

      expect(state()).toBe('invalid');
      expect(mock).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    }
  });

  it('token invalido na URL nao reaproveita o token antigo da aba', async () => {
    window.sessionStorage.setItem('iq-indent-portal', TOKEN);
    const mock = installFetch(() => ok(makeView()));
    mountPage('/portal/indent?token=curto');
    await loaded();

    expect(state()).toBe('invalid');
    expect(mock).not.toHaveBeenCalled();
  });
});

describe('token', () => {
  it('sai da barra de enderecos e fica so na aba; recarregar so com o storage funciona; nunca vai ao DOM nem ao titulo', async () => {
    const replace = vi.spyOn(window.history, 'replaceState');
    const mock = installFetch(() => ok(makeView()));
    mountPage();
    await loaded();

    expect(window.location.search).toBe('');
    expect(window.location.pathname).toBe('/portal/indent');
    expect(replace).toHaveBeenLastCalledWith(null, '', '/portal/indent');
    expect(window.sessionStorage.getItem('iq-indent-portal')).toBe(TOKEN);
    expect(document.body.innerHTML).not.toContain(TOKEN);
    expect(document.title).not.toContain(TOKEN);
    vi.unstubAllGlobals();
    const reload = installFetch(() => ok(makeView()));
    mountPage('/portal/indent');
    await loaded();

    expect(state()).toBe('open');
    expect((reload.mock.calls[0] as unknown as [string])[0]).toBe(API);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it('storage bloqueado: a URL fica como esta (recarregar continua funcionando) e a pagina abre', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    const replace = vi.spyOn(window.history, 'replaceState');
    installFetch(() => ok(makeView()));
    mountPage();
    await loaded();

    expect(state()).toBe('open');
    expect(window.location.search).toBe(`?token=${TOKEN}`);
    expect(replace).toHaveBeenCalledTimes(1); // so a chamada do proprio teste (mountPage)
  });

  it('a gravacao no storage acontece ANTES de limpar a URL', async () => {
    const order: string[] = [];
    window.history.replaceState(null, '', `/portal/indent?token=${TOKEN}`);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      order.push('storage');
    });
    vi.spyOn(window.history, 'replaceState').mockImplementation(() => {
      order.push('url');
    });
    installFetch(() => ok(makeView()));
    mountPage();
    await loaded();

    expect(order.slice(-2)).toEqual(['storage', 'url']);
  });
});

describe('XSS: tudo que vem do servidor entra como texto', () => {
  it('nome, CAS, cliente, destino, mensagem, e fabricante viram texto e nenhum <img> e criado', async () => {
    installFetch(() => ok(makeView({
      endCustomer: XSS,
      destination: XSS,
      message: XSS,
      requestedBy: XSS,
      processRef: XSS,
      items: [{ quoteItemId: 201, name: XSS, cas: XSS, quantityKg: '1.000' }, { quoteItemId: 202, name: 'B', cas: null, quantityKg: '2.000' }],
      options: { packaging: [XSS, ...PACKAGING], paymentTerms: PAYMENT, currencies: ['USD', 'EUR'], maxFiles: 5, maxFileBytes: 1048576 },
    })));
    mountPage();
    await loaded();

    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('[onerror]')).toBeNull();
    expect(text()).toContain(XSS);
    expect(document.querySelector('.p-banner.amber')?.textContent).toContain(XSS);
    expect(document.querySelector('.p-num b')?.textContent).toBe(XSS);
    expect(document.querySelector('label[for="cfr0"]')?.textContent).toBe(`CFR ${XSS} price per kg`);
    expect(document.querySelector('#pkg0 option')?.nextElementSibling?.textContent).toBe(XSS);
  });

  it('enviado e expirado: resposta, fabricante, notas, anexos e referencia tambem como texto', async () => {
    installFetch(() => ok(makeSent({ attachments: [{ id: 1, fileName: XSS, fileSize: 1, createdAt: '2026-11-12T18:00:00.000Z' }], response: { ...(makeSent().response as Json), manufacturer: XSS, notes: XSS, paymentTerms: XSS } })));
    mountPage();
    await loaded();

    expect(document.querySelector('img')).toBeNull();
    expect(text()).toContain(XSS);
    vi.unstubAllGlobals();
    installFetch(() => ({ status: 410, body: { message: XSS, code: 'LINK_EXPIRED', processRef: XSS, expiresAt: '2026-11-26T14:00:00.000Z' } }));
    mountPage();
    await loaded();

    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('.p-center p strong')?.textContent).toBe(XSS);
    vi.unstubAllGlobals();
    installFetch(() => ({ status: 410, body: { message: XSS, code: 'LINK_CLOSED' } }));
    mountPage();
    await loaded();

    expect(document.querySelector('img')).toBeNull();
    expect(text()).toContain(XSS);
  });

  it('erro de campo e mensagem de upload do servidor tambem entram como texto', async () => {
    const mock = installFetch((method, url) => {
      if (url.endsWith('/attachments')) return { status: 400, body: { message: XSS, code: 'NOT_PDF' } };
      return method === 'POST' ? { status: 400, body: { message: XSS, path: 'items.0.fobPricePerKg' } } : ok(makeView());
    });
    mountPage();
    await loaded();
    fillOffer();
    submit();
    await vi.waitFor(() => expect(document.getElementById('fob0-e')).not.toBeNull());

    expect(document.getElementById('fob0-e')?.textContent).toBe(XSS);
    chooseFiles([new File(['%PDF-1.4'], 'a.pdf', { type: 'application/pdf' })]);
    await vi.waitFor(() => expect(document.querySelector('#filelist li.is-error')).not.toBeNull());

    expect(document.querySelector('#filelist li')?.textContent).toBe(`a.pdf — ${XSS}`);
    expect(document.querySelector('img')).toBeNull();
    expect(mock).toHaveBeenCalled();
  });
});
