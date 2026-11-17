// Anexos do fornecedor na pagina publica do portal Indent (upload imediato, limites no cliente, erros e tela terminal).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API, makeView, Reply, installFetch, mountPage, loaded, el, state, posts, ok, chooseFiles, pdf } from './indentPortalPage.helpers';

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('anexos do fornecedor', () => {
  const upload = (url: string) => url.endsWith('/attachments');

  it('envia na hora, um por vez, com Content-Type pdf e nome codificado; o nome do servidor entra na lista', async () => {
    const mock = installFetch((_method, url, init) => (upload(url) ? ok({ id: 7, fileName: (init.body as File).name, fileSize: 64 }, 201) : ok(makeView())));
    mountPage();
    await loaded();
    const odd = pdf('Relatório de qualidade (COA) #1.pdf');
    chooseFiles([odd, pdf('b.pdf', 80)]);
    await vi.waitFor(() => expect(document.querySelectorAll('#filelist li')).toHaveLength(2));
    await vi.waitFor(() => expect([...document.querySelectorAll('#filelist li')].every((li) => li.className === '')).toBe(true));

    const [url, init] = posts(mock)[0] as unknown as [string, RequestInit];

    expect(url).toBe(`${API}/attachments`);
    expect(init.headers).toEqual({ 'Content-Type': 'application/pdf', 'X-File-Name': encodeURIComponent('Relatório de qualidade (COA) #1.pdf') });
    expect(init.body).toBe(odd);
    expect(posts(mock)).toHaveLength(2);
    expect([...document.querySelectorAll('#filelist li')].map((li) => li.textContent)).toEqual(['Relatório de qualidade (COA) #1.pdf', 'b.pdf']);
    expect(el('files').value).toBe('');
  });

  it('barra no cliente: nao-PDF, acima do limite e o 6o arquivo; repetido (nome+tamanho) e ignorado; nada disso chama a API', async () => {
    const mock = installFetch((_method, url, init) => (upload(url) ? ok({ id: 1, fileName: (init.body as File).name, fileSize: 64 }, 201) : ok(makeView())));
    mountPage();
    await loaded();
    chooseFiles([new File(['x'], 'nota.txt', { type: 'text/plain' }), pdf('grande.pdf', 10 * 1024 * 1024 + 1)]);
    await vi.waitFor(() => expect(document.querySelectorAll('#filelist li.is-error')).toHaveLength(2));

    expect([...document.querySelectorAll('#filelist li')].map((li) => li.textContent)).toEqual(['nota.txt — Only PDF files are allowed.', 'grande.pdf — The file is larger than 10 MB.']);
    expect(posts(mock)).toHaveLength(0);
    chooseFiles(['1', '2', '3', '4', '5', '6'].map((n) => pdf(`f${n}.pdf`, 10 + Number(n))));
    await vi.waitFor(() => expect(document.querySelector('#filelist li.is-error')?.textContent).toBe('f6.pdf — You can attach up to 5 files.'));

    expect(posts(mock)).toHaveLength(5);
  });

  it('arquivo repetido (nome+tamanho) com 1 anexo ativo e ignorado: 1 POST, 1 item sem erro; exatamente 10 MB passa', async () => {
    const mock = installFetch((_method, url, init) => (upload(url) ? ok({ id: 1, fileName: (init.body as File).name, fileSize: 64 }, 201) : ok(makeView())));
    mountPage();
    await loaded();
    chooseFiles([pdf('a.pdf', 64)]);
    await vi.waitFor(() => expect(document.querySelectorAll('#filelist li')).toHaveLength(1));
    chooseFiles([pdf('a.pdf', 64)]);
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(posts(mock)).toHaveLength(1);
    expect(document.querySelectorAll('#filelist li')).toHaveLength(1);
    expect(document.querySelector('#filelist li.is-error')).toBeNull();
    chooseFiles([pdf('exato.pdf', 10 * 1024 * 1024)]);
    await vi.waitFor(() => expect(posts(mock)).toHaveLength(2));

    expect(document.querySelector('#filelist li.is-error')).toBeNull();
  });

  it.each([[410, 'LINK_EXPIRED', 'expired'], [404, 'LINK_INVALID', 'invalid']])('%s no 1o anexo: tela terminal e a fila para (1 POST, nao 3: cada POST invalido conta no bloqueio)', async (status, code, screen) => {
    const mock = installFetch((_method, url) => (upload(url) ? { status, body: { message: 'x', code } } : ok(makeView())));
    mountPage();
    await loaded();
    chooseFiles([pdf('a.pdf', 1), pdf('b.pdf', 2), pdf('c.pdf', 3)]);
    await vi.waitFor(() => expect(state()).toBe(screen));
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(posts(mock)).toHaveLength(1);
  });

  it('tempo limite: 30 s para GET/POST da oferta e 120 s so para o anexo', async () => {
    const timers = vi.spyOn(globalThis, 'setTimeout');
    installFetch((_method, url, init) => (upload(url) ? ok({ id: 1, fileName: (init.body as File).name, fileSize: 1 }, 201) : ok(makeView())));
    mountPage();
    await loaded();
    const delays = () => timers.mock.calls.map((call) => call[1]).filter((ms) => ms === 30000 || ms === 120000);

    expect(delays()).toEqual([30000]);
    chooseFiles([pdf('a.pdf', 1)]);
    await vi.waitFor(() => expect(delays()).toEqual([30000, 120000]));
  });

  it('erro do servidor com codigo conhecido mostra a mensagem; erro desconhecido vira "Upload failed"; 410 leva a tela de vencido', async () => {
    const replies: Reply[] = [
      { status: 400, body: { message: 'Only PDF files are allowed.', code: 'NOT_PDF' } },
      { status: 500, body: { message: 'boom' } },
      { status: 409, body: { message: 'You can attach up to 5 files.', code: 'TOO_MANY_FILES' } },
    ];
    installFetch((_method, url) => (upload(url) ? (replies.shift() as Reply) : ok(makeView())));
    mountPage();
    await loaded();
    chooseFiles([pdf('a.pdf', 1), pdf('b.pdf', 2), pdf('c.pdf', 3)]);
    await vi.waitFor(() => expect(document.querySelectorAll('#filelist li.is-error')).toHaveLength(3));

    expect([...document.querySelectorAll('#filelist li')].map((li) => li.textContent)).toEqual([
      'a.pdf — Only PDF files are allowed.',
      'b.pdf — Upload failed. Please try again.',
      'c.pdf — You can attach up to 5 files.',
    ]);
    vi.unstubAllGlobals();
    installFetch((_method, url) => (upload(url) ? { status: 410, body: { message: 'This link has expired.', code: 'LINK_EXPIRED' } } : ok(makeView())));
    mountPage();
    await loaded();
    chooseFiles([pdf('a.pdf')]);
    await vi.waitFor(() => expect(state()).toBe('expired'));
  });

  it('"Try again" depois de erro na abertura: o formulario volta com a fila de anexos VIVA (1 POST, sem erro)', async () => {
    let first = true;
    const mock = installFetch((_method, url, init) => {
      if (upload(url)) return ok({ id: 1, fileName: (init.body as File).name, fileSize: 64 }, 201);
      if (first) {
        first = false;
        return { status: 500, body: { message: 'x' } };
      }
      return ok(makeView());
    });
    mountPage();
    await loaded();

    expect(state()).toBe('error');
    (document.querySelector('.p-center button') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(state()).toBe('open'));
    chooseFiles([pdf('a.pdf', 64)]);
    await vi.waitFor(() => expect(posts(mock)).toHaveLength(1));

    expect(document.querySelectorAll('#filelist li')).toHaveLength(1);
    expect(document.querySelector('#filelist li.is-error')).toBeNull();
  });

  it('os anexos ja enviados vem na lista e contam para o limite', async () => {
    const attachments = [1, 2, 3, 4].map((id) => ({ id, fileName: `old${id}.pdf`, fileSize: 10, createdAt: '2026-11-12T18:00:00.000Z' }));
    const mock = installFetch((_method, url) => (upload(url) ? ok({ id: 9, fileName: 'new.pdf', fileSize: 10 }, 201) : ok(makeView({ attachments }))));
    mountPage();
    await loaded();

    expect([...document.querySelectorAll('#filelist li')].map((li) => li.textContent)).toEqual(['old1.pdf', 'old2.pdf', 'old3.pdf', 'old4.pdf']);
    chooseFiles([pdf('new.pdf', 10), pdf('over.pdf', 11)]);
    await vi.waitFor(() => expect(document.querySelector('#filelist li.is-error')?.textContent).toBe('over.pdf — You can attach up to 5 files.'));

    expect(posts(mock)).toHaveLength(1);
  });
});
