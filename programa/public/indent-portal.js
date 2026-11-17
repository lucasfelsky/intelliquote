/* Portal publico do fornecedor do IQ Indent (pagina /portal/indent). Vanilla, sem build, sem dependencia.
   Regras fixas (a CSP e os testes dependem delas): o DOM so e preenchido com textContent/atributos a partir dos <template> do HTML;
   nenhum estilo ou script inline; o token so vai na URL do fetch (nunca em log, titulo, atributo ou asset). */
(function () {
  'use strict';

  var TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
  var API_ORIGIN = 'https://intelliquote-api-705697815580.southamerica-east1.run.app';
  var STORAGE_KEY = 'iq-indent-portal';
  var TIMEOUT_MS = 30000;
  var UPLOAD_TIMEOUT_MS = 120000; // anexo de ate 10 MB em conexao lenta
  var TIME_ZONE = 'America/Sao_Paulo';
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var DASH = '—';
  var UPLOAD_CODES = ['NOT_PDF', 'TOO_MANY_FILES', 'FILE_TOO_LARGE'];
  var GENERIC_MESSAGE = 'Something went wrong on our side. Please try again in a few minutes.';
  var BAD_LINK_MESSAGE = 'This link is invalid. Please use the latest e-mail from SQ Quimica or reply to it to request a new link.';
  var CLOSED_MESSAGE = 'This quotation is closed and no longer takes responses.';
  var RENEW_TAIL = 'If you still want to quote, please reply to the e-mail you received and we will send a new link.';
  var FIELD_BY_PATH = {
    productionLeadTimeDays: 'lead',
    paymentTerms: 'pay',
    validUntil: 'valid',
    manufacturer: 'maker',
    currency: 'cur',
    notes: 'notes',
  };
  var FIELD_BY_ITEM_KEY = { packaging: 'pkg', fobPricePerKg: 'fob', cfrPricePerKg: 'cfr' };

  /* ---------------------------------------------------------------- funcoes puras */

  // Servida pelo Cloud Run (ou local): mesma origem. Servida pelo Firebase Hosting: API direto no Cloud Run (rate limit por IP real).
  function resolveApiBase(loc) {
    var host = (loc && loc.hostname) || '';
    if (/\.run\.app$/.test(host) || host === 'localhost' || host === '127.0.0.1') {
      return loc.origin + '/api';
    }
    return API_ORIGIN + '/api';
  }

  // ?token= valido -> usa. Sem o parametro: o token guardado na aba (a URL e limpa depois da 1a leitura). Parametro presente e invalido: null
  // (nao cai no token antigo da aba: o link novo mostraria outra cotacao).
  function readToken(loc, storage) {
    var fromUrl = null;
    try {
      fromUrl = new URLSearchParams((loc && loc.search) || '').get('token');
    } catch (e) {
      fromUrl = null;
    }
    if (fromUrl) {
      return TOKEN_PATTERN.test(fromUrl) ? { token: fromUrl, fromUrl: true } : null;
    }
    try {
      var saved = storage ? storage.getItem(STORAGE_KEY) : null;
      if (saved && TOKEN_PATTERN.test(saved)) {
        return { token: saved, fromUrl: false };
      }
    } catch (e) {
      /* storage bloqueado: segue sem token */
    }
    return null;
  }

  // "0,72" -> "0.72". Ate 5 inteiros e 4 decimais (mesmo padrao do servidor). Fora disso: null.
  function normalizePrice(text) {
    var t = String(text === null || text === undefined ? '' : text).trim();
    if (!/^\d{1,5}([.,]\d{1,4})?$/.test(t)) {
      return null;
    }
    return t.replace(',', '.');
  }

  // Inteiro x10000 (comparacao CFR >= FOB sem ponto flutuante).
  function priceScaled(str) {
    var parts = String(str).split('.');
    var whole = Number(parts[0]);
    var frac = Number(((parts[1] || '') + '0000').slice(0, 4));
    return whole * 10000 + frac;
  }

  var dateTimeFormat = typeof Intl !== 'undefined'
    ? new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    : null;

  function partsOf(value) {
    var date = value instanceof Date ? value : new Date(value);
    if (!dateTimeFormat || isNaN(date.getTime())) {
      return null;
    }
    var out = {};
    dateTimeFormat.formatToParts(date).forEach(function (part) {
      out[part.type] = part.value;
    });
    return out;
  }

  function todayKeySaoPaulo(now) {
    var p = partsOf(now || new Date());
    return p ? p.year + '-' + p.month + '-' + p.day : '';
  }

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  // Aritmetica de calendario sobre a chave, em UTC: sem fuso e sem horario de verao no meio.
  function addDaysToKey(key, days) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
    var d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  }

  function isDateKey(key) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''));
    if (!m) {
      return false;
    }
    var d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
  }

  function checkPrice(text, label) {
    var t = String(text === null || text === undefined ? '' : text).trim();
    if (!t) {
      return { error: 'Enter the ' + label + ' price.' };
    }
    var normalized = normalizePrice(t);
    if (normalized === null) {
      return { error: /^\d+[.,]\d{5,}$/.test(t) ? 'Use up to 4 decimal places.' : 'Enter the ' + label + ' price.' };
    }
    var scaled = priceScaled(normalized);
    return scaled <= 0 ? { error: 'The price must be greater than zero.' } : { scaled: scaled };
  }

  // form: { cur, lead, pay, valid, maker, notes, items: [{ pkg, fob, cfr }] } -> { [idDoCampo]: mensagem } (ids do mock).
  function validateOffer(form, view, todayKey) {
    var errs = {};
    var count = (view.items || []).length;
    for (var i = 0; i < count; i += 1) {
      var row = (form.items && form.items[i]) || { pkg: '', fob: '', cfr: '' };
      if (!row.pkg) {
        errs['pkg' + i] = 'Choose the packaging.';
      }
      var fob = checkPrice(row.fob, 'FOB');
      var cfr = checkPrice(row.cfr, 'CFR');
      if (fob.error) {
        errs['fob' + i] = fob.error;
      }
      if (cfr.error) {
        errs['cfr' + i] = cfr.error;
      } else if (!fob.error && cfr.scaled < fob.scaled) {
        errs['cfr' + i] = 'CFR cannot be lower than FOB.';
      }
    }
    var lead = String(form.lead === undefined || form.lead === null ? '' : form.lead).trim();
    if (!lead) {
      errs.lead = 'Enter the lead time in days.';
    } else if (!/^\d+$/.test(lead) || Number(lead) < 1 || Number(lead) > 365) {
      errs.lead = 'Production lead time must be 1 to 365 days.';
    }
    if (!form.pay) {
      errs.pay = 'Choose the payment terms.';
    }
    if (!form.valid) {
      errs.valid = 'Enter the validity date.';
    } else if (!isDateKey(form.valid) || form.valid < todayKey || form.valid > addDaysToKey(todayKey, 365)) {
      errs.valid = 'The validity must be between today and 365 days from today.';
    }
    if (view.manufacturerRequired && !String(form.maker || '').trim()) {
      errs.maker = 'Please inform the manufacturer.';
    }
    return errs;
  }

  // 'items.2.cfrPricePerKg' -> 'cfr2'; caminho desconhecido -> null (vira banner).
  function errorFieldFromPath(path) {
    var text = String(path || '');
    var m = /^items\.(\d+)\.(packaging|fobPricePerKg|cfrPricePerKg)$/.exec(text);
    if (m) {
      return FIELD_BY_ITEM_KEY[m[2]] + m[1];
    }
    return Object.prototype.hasOwnProperty.call(FIELD_BY_PATH, text) ? FIELD_BY_PATH[text] : null;
  }

  function nullIfEmpty(value) {
    var t = String(value === null || value === undefined ? '' : value).trim();
    return t === '' ? null : t;
  }

  function buildPayload(form, view) {
    return {
      currency: form.cur,
      productionLeadTimeDays: Number(String(form.lead).trim()),
      paymentTerms: form.pay,
      validUntil: form.valid,
      manufacturer: nullIfEmpty(form.maker),
      notes: nullIfEmpty(form.notes),
      items: view.items.map(function (item, i) {
        var row = form.items[i];
        return {
          quoteItemId: item.quoteItemId,
          packaging: row.pkg,
          fobPricePerKg: normalizePrice(row.fob),
          cfrPricePerKg: normalizePrice(row.cfr),
        };
      }),
    };
  }

  // "0.7200" -> "0.720" (3 casas no minimo, como no mock; nunca perde a 4a casa).
  function priceToInput(value) {
    if (value === null || value === undefined || value === '') {
      return '';
    }
    var text = String(value);
    if (text.indexOf('.') === -1) {
      return text;
    }
    var out = text.replace(/0+$/, '');
    var decimals = out.length - out.indexOf('.') - 1;
    while (decimals < 3) {
      out += '0';
      decimals += 1;
    }
    return out;
  }

  function oneOf(list, value) {
    return list && value && list.indexOf(value) !== -1 ? value : '';
  }

  // Revisao -> oferta anterior; ja respondida (editar) -> a resposta; pedido novo -> em branco. Embalagem/pagamento fora das opcoes ficam vazios.
  function prefillForm(view) {
    var options = view.options || {};
    var source = view.state === 'revision' ? view.previousOffer : view.state === 'sent' ? view.response : null;
    var form = {
      cur: oneOf(options.currencies, source && source.currency) || oneOf(options.currencies, view.currency) || (options.currencies && options.currencies[0]) || 'USD',
      lead: source && source.productionLeadTimeDays ? String(source.productionLeadTimeDays) : '',
      pay: source ? oneOf(options.paymentTerms, source.paymentTerms) : '',
      valid: (source && source.validUntil) || '',
      maker: (source && source.manufacturer) || '',
      notes: view.state === 'sent' && source && source.notes ? source.notes : '',
      items: [],
    };
    (view.items || []).forEach(function (item) {
      var prev = null;
      if (source && source.items) {
        for (var i = 0; i < source.items.length; i += 1) {
          if (source.items[i].quoteItemId === item.quoteItemId) {
            prev = source.items[i];
          }
        }
      }
      form.items.push({
        pkg: prev ? oneOf(options.packaging, prev.packaging) : '',
        fob: prev ? priceToInput(prev.fobPricePerKg) : '',
        cfr: prev ? priceToInput(prev.cfrPricePerKg) : '',
      });
    });
    return form;
  }

  function formatKg(value) {
    var n = Number(value);
    return (isNaN(n) ? String(value) : n.toLocaleString('en-GB', { maximumFractionDigits: 3 })) + ' kg';
  }

  function formatPrice(value) {
    var n = Number(value);
    return isNaN(n) ? DASH : n.toLocaleString('en-GB', { minimumFractionDigits: 3, maximumFractionDigits: 4 });
  }

  function formatMoney(n, cur) {
    return (cur === 'EUR' ? '€' : 'US$') + ' ' + n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function formatDate(iso) {
    var p = partsOf(iso);
    return p ? Number(p.day) + ' ' + MONTHS[Number(p.month) - 1] + ' ' + p.year : '';
  }

  function formatDateTime(iso) {
    var p = partsOf(iso);
    return p ? Number(p.day) + ' ' + MONTHS[Number(p.month) - 1] + ' ' + p.year + ', ' + p.hour + ':' + p.minute : '';
  }

  function formatDateKey(key) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''));
    return m ? Number(m[3]) + ' ' + MONTHS[Number(m[2]) - 1] + ' ' + m[1] : DASH;
  }

  // Qual tela uma resposta de erro pede.
  function screenForError(status, body) {
    var code = body && typeof body === 'object' ? body.code : undefined;
    if (status === 404) {
      return 'invalid';
    }
    if (status === 410) {
      return code === 'LINK_EXPIRED' ? 'expired' : 'closed';
    }
    if (status === 429) {
      return code === 'LOCKED' ? 'locked' : 'busy';
    }
    return 'error';
  }

  /* ---------------------------------------------------------------- DOM */

  var ctx = null;

  function make(tag, className, text) {
    var node = document.createElement(tag);
    if (className) {
      node.className = className;
    }
    if (text !== undefined && text !== null) {
      node.textContent = text;
    }
    return node;
  }

  function tpl(id) {
    return document.importNode(document.getElementById(id).content.firstElementChild, true);
  }

  function slot(root, name) {
    return root.querySelector('[data-slot="' + name + '"]');
  }

  function setSlot(root, name, text) {
    var node = slot(root, name);
    if (node) {
      node.textContent = text;
    }
    return node;
  }

  function clear(node) {
    while (node.firstChild) {
      node.removeChild(node.firstChild);
    }
  }

  // parts: texto simples ou { strong: 'texto' }.
  function fillParts(node, parts) {
    clear(node);
    parts.forEach(function (part) {
      node.appendChild(typeof part === 'string' ? document.createTextNode(part) : make('strong', null, part.strong));
    });
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function iconNode(id) {
    return tpl(id);
  }

  function banner(kind, title, text, alert) {
    var node = tpl('t-banner');
    node.className = 'p-banner ' + kind;
    slot(node, 'icon').appendChild(iconNode(kind === 'ok' ? 't-ico-check-sm' : 't-ico-warn'));
    setSlot(node, 'title', title);
    if (text) {
      setSlot(node, 'text', text);
    } else {
      var textNode = slot(node, 'text');
      textNode.parentNode.removeChild(textNode);
    }
    if (alert) {
      node.setAttribute('role', 'alert');
    }
    return node;
  }

  function hero(options) {
    var node = tpl('t-hero');
    setSlot(node, 'title', options.title);
    var sub = slot(node, 'sub');
    if (options.sub) {
      sub.textContent = options.sub;
    } else {
      sub.parentNode.removeChild(sub);
    }
    var num = slot(node, 'num');
    if (options.ref) {
      setSlot(node, 'numLabel', /^R\d+ - /.test(options.ref) || options.revision > 1 ? 'Revision of request' : 'Request no.');
      setSlot(node, 'numValue', options.ref);
    } else {
      num.parentNode.removeChild(num);
    }
    var steps = slot(node, 'steps');
    var spacer = slot(node, 'spacer');
    if (options.step > 0) {
      spacer.parentNode.removeChild(spacer);
      Array.prototype.forEach.call(steps.children, function (step, index) {
        var position = index + 1;
        var n = slot(step, 'n');
        if (position < options.step) {
          step.className = 'p-step done';
          n.textContent = '✓';
          step.appendChild(make('span', 'sr-only', ' (completed)'));
        } else if (position === options.step) {
          step.className = 'p-step on';
          step.setAttribute('aria-current', 'step');
          n.textContent = String(position);
        } else {
          n.textContent = String(position);
        }
      });
    } else {
      steps.parentNode.removeChild(steps);
    }
    return node;
  }

  function mount(stateName, title, nodes, focusHero) {
    var app = byId('ip-app');
    app.setAttribute('data-state', stateName);
    if (stateName === 'loading') {
      app.setAttribute('aria-busy', 'true');
    } else {
      app.removeAttribute('aria-busy');
    }
    document.title = 'SQ Quimica · ' + title;
    clear(app);
    nodes.forEach(function (node) {
      app.appendChild(node);
    });
    app.appendChild(tpl('t-foot'));
    if (focusHero) {
      var h1 = app.querySelector('.p-h1');
      if (h1) {
        h1.focus();
      }
    }
  }

  function showLoading() {
    var app = byId('ip-app');
    var wrap = make('div', 'p-body p-body--single p-wrap');
    var card = make('section', 'p-card p-center');
    card.setAttribute('role', 'status');
    card.appendChild(make('h2', null, 'Loading your request…'));
    wrap.appendChild(card);
    app.setAttribute('data-state', 'loading');
    app.setAttribute('aria-busy', 'true');
    document.title = 'SQ Quimica · Indent request';
    clear(app);
    app.appendChild(wrap);
  }

  // Telas sem formulario (vencido, fechado, invalido, bloqueado, erro).
  function showCenter(config, focusHero) {
    var body = tpl('t-center');
    var icon = slot(body, 'icon');
    icon.className = 'p-big p-big--err';
    icon.appendChild(iconNode('t-ico-warn-big'));
    setSlot(body, 'heading', config.heading);
    fillParts(slot(body, 'text'), config.parts);
    var action = slot(body, 'action');
    if (config.action) {
      action.textContent = config.action.label;
      action.hidden = false;
      action.addEventListener('click', config.action.run);
    } else {
      action.parentNode.removeChild(action);
    }
    mount(config.state, config.title, [hero({ title: config.heroTitle, sub: config.sub, ref: config.ref, step: 0 }), body], focusHero);
  }

  function showScreen(kind, body, focusHero) {
    // Tela terminal: a fila de anexos para (cada POST extra com link invalido contaria para o bloqueio).
    ctx.dead = true;
    var message = body && typeof body.message === 'string' && body.message ? body.message : '';
    if (kind === 'expired') {
      var view = ctx && ctx.view;
      var ref = (body && body.processRef) || (view && view.processRef) || '';
      var until = formatDate((body && body.expiresAt) || (view && view.expiresAt));
      var parts = ref
        ? ['The link for request ', { strong: ref }, until ? ' was valid until ' + until + '. ' + RENEW_TAIL : ' is no longer valid. ' + RENEW_TAIL]
        : [RENEW_TAIL];
      showCenter({ state: 'expired', title: 'Link expired', heroTitle: 'Link expired', sub: 'For your security, this link is no longer valid.', ref: ref, heading: 'This link has expired', parts: parts }, focusHero);
    } else if (kind === 'closed') {
      showCenter({ state: 'closed', title: 'Quotation closed', heroTitle: 'Quotation closed', sub: 'This quotation is no longer open for responses.', heading: 'This quotation is closed', parts: [message || CLOSED_MESSAGE] }, focusHero);
    } else if (kind === 'invalid') {
      showCenter({ state: 'invalid', title: 'Link not valid', heroTitle: 'Link not valid', sub: 'Please use the latest e-mail from SQ Quimica.', heading: 'This link is not valid', parts: [BAD_LINK_MESSAGE] }, focusHero);
    } else if (kind === 'locked') {
      showCenter({ state: 'locked', title: 'Access blocked', heroTitle: 'Access temporarily blocked', sub: 'Too many invalid attempts were made from this connection.', heading: 'Please try again in a few minutes', parts: [message || 'Access temporarily blocked after several invalid attempts. Please try again in a few minutes.'] }, focusHero);
    } else if (kind === 'busy') {
      showCenter({ state: 'busy', title: 'Please wait', heroTitle: 'Please wait a moment', sub: 'This page was requested too many times in a short period.', heading: 'Too many requests', parts: [message || 'Too many requests in a short time. Please wait a moment and try again.'], action: { label: 'Try again', run: load } }, focusHero);
    } else {
      showCenter({ state: 'error', title: 'Something went wrong', heroTitle: 'Something went wrong', sub: 'Your request could not be shown.', heading: 'We could not load your request', parts: ['Please check your connection and try again.'], action: { label: 'Try again', run: load } }, focusHero);
    }
  }

  /* ---------------------------------------------------------------- rede */

  // Resolve sempre { status, body }; falha de rede/tempo = status 0; corpo que nao e JSON = body null.
  function send(method, path, extra) {
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, extra && extra.file ? UPLOAD_TIMEOUT_MS : TIMEOUT_MS) : null;
    var init = { method: method, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', headers: {} };
    if (controller) {
      init.signal = controller.signal;
    }
    if (extra && extra.json !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(extra.json);
    }
    if (extra && extra.file) {
      init.headers['Content-Type'] = 'application/pdf';
      init.headers['X-File-Name'] = encodeURIComponent(extra.file.name);
      init.body = extra.file;
    }
    return fetch(ctx.apiBase + path, init)
      .then(function (res) {
        return Promise.resolve()
          .then(function () { return res.json(); })
          .then(
            function (body) { return { status: res.status, body: body }; },
            function () { return { status: res.status, body: null }; },
          );
      })
      .catch(function () { return { status: 0, body: null }; })
      .then(function (result) {
        if (timer) {
          clearTimeout(timer);
        }
        return result;
      });
  }

  function endpoint(suffix) {
    return '/indent-portal/' + ctx.token + (suffix || '');
  }

  function isView(body) {
    return !!body && typeof body === 'object' && Array.isArray(body.items) && !!body.options && typeof body.processRef === 'string';
  }

  function load() {
    ctx.dead = false;
    showLoading();
    return send('GET', endpoint()).then(function (result) {
      if (result.status === 200 && isView(result.body)) {
        ctx.view = result.body;
        ctx.files = (result.body.attachments || []).map(function (file) {
          return { name: file.fileName, size: file.fileSize, status: 'ok' };
        });
        if (result.body.state === 'sent') {
          showSent(false, false);
        } else {
          ctx.form = prefillForm(result.body);
          showForm(result.body.state === 'revision' ? 'revision' : 'open', false);
        }
        return;
      }
      showScreen(result.status === 200 ? 'error' : screenForError(result.status, result.body), result.body, false);
    });
  }

  /* ---------------------------------------------------------------- formulario */

  function totalOf(form, view) {
    var total = 0;
    var any = false;
    view.items.forEach(function (item, i) {
      var cfr = normalizePrice(form.items[i].cfr);
      if (cfr !== null && Number(cfr) > 0) {
        total += Number(cfr) * Number(item.quantityKg);
        any = true;
      }
    });
    return any ? total : null;
  }

  function updateLive() {
    var form = ctx.form;
    var view = ctx.view;
    view.items.forEach(function (item, i) {
      var line = byId('line' + i);
      var cfr = normalizePrice(form.items[i].cfr);
      if (line) {
        line.textContent = cfr !== null && Number(cfr) > 0 ? formatMoney(Number(cfr) * Number(item.quantityKg), form.cur) : DASH;
      }
    });
    var total = totalOf(form, view);
    var tot = byId('tot');
    if (tot) {
      tot.textContent = total === null ? DASH : formatMoney(total, form.cur);
    }
    var sv = byId('sv');
    if (sv) {
      sv.textContent = form.valid ? formatDateKey(form.valid) : DASH;
    }
    Array.prototype.forEach.call(document.querySelectorAll('.p-item [data-slot="cur"]'), function (node) {
      node.textContent = form.cur + '/kg';
    });
  }

  function alertsBox() {
    return byId('alerts');
  }

  function setAlert(kind, title, text) {
    var box = alertsBox();
    if (!box) {
      return;
    }
    clear(box);
    if (title) {
      box.appendChild(banner(kind, title, text, kind !== 'ok'));
    }
  }

  function invalidCount() {
    return document.querySelectorAll('#ip-app form [aria-invalid="true"]').length;
  }

  function attentionText(n) {
    return n + ' field' + (n > 1 ? 's need' : ' needs') + ' your attention.';
  }

  function setFieldError(id, message) {
    var input = byId(id);
    if (!input) {
      return false;
    }
    var errorId = id + '-e';
    var span = byId(errorId);
    if (!span) {
      span = make('span', 'p-err');
      span.id = errorId;
      input.closest('.p-field').appendChild(span);
    }
    span.textContent = message;
    input.setAttribute('aria-invalid', 'true');
    input.setAttribute('aria-describedby', byId(id + '-h') ? id + '-h ' + errorId : errorId);
    return true;
  }

  function clearFieldError(id) {
    var input = byId(id);
    var span = byId(id + '-e');
    if (span) {
      span.parentNode.removeChild(span);
    }
    if (input && input.getAttribute('aria-invalid') === 'true') {
      input.removeAttribute('aria-invalid');
      if (byId(id + '-h')) {
        input.setAttribute('aria-describedby', id + '-h');
      } else {
        input.removeAttribute('aria-describedby');
      }
      var left = invalidCount();
      var box = alertsBox();
      if (box && box.querySelector('.p-banner.err[data-kind="fields"]')) {
        if (left > 0) {
          // Atualiza o texto no lugar: refazer o banner reanunciaria o alerta a cada tecla.
          box.querySelector('.p-banner-text').textContent = attentionText(left);
        } else {
          setAlert('err', '', '');
        }
      }
    }
  }

  function clearAllErrors() {
    Array.prototype.forEach.call(document.querySelectorAll('#ip-app form [aria-invalid="true"]'), function (input) {
      clearFieldError(input.id);
    });
    setAlert('err', '', '');
  }

  function showFieldBanner() {
    setAlert('err', 'Check the highlighted fields', attentionText(invalidCount()));
    var box = alertsBox();
    if (box && box.firstChild) {
      box.firstChild.setAttribute('data-kind', 'fields');
    }
  }

  function focusFirstInvalid() {
    var first = document.querySelector('#ip-app form [aria-invalid="true"]');
    if (first) {
      first.focus();
    }
  }

  function onFormInput(event) {
    var target = event.target;
    var id = target && target.id;
    if (!id || id === 'files') {
      return;
    }
    var form = ctx.form;
    var m = /^(pkg|fob|cfr)(\d+)$/.exec(id);
    if (m) {
      form.items[Number(m[2])][m[1]] = target.value;
    } else if (id === 'cur' || id === 'lead' || id === 'pay' || id === 'valid' || id === 'maker' || id === 'notes') {
      form[id] = target.value;
    } else {
      return;
    }
    clearFieldError(id);
    updateLive();
  }

  function fillSelect(select, values) {
    (values || []).forEach(function (value) {
      var option = make('option', null, value);
      option.value = value;
      select.appendChild(option);
    });
  }

  function metaRow(label, value) {
    var row = make('div');
    row.appendChild(make('dt', null, label));
    row.appendChild(make('dd', null, value));
    return row;
  }

  function itemsCard(view) {
    var card = tpl('t-items');
    var meta = slot(card, 'meta');
    meta.appendChild(metaRow('Requested by', view.requestedBy || 'SQ Quimica'));
    if (view.endCustomer) {
      meta.appendChild(metaRow('End customer', view.endCustomer));
    } else {
      meta.appendChild(metaRow('Request type', view.requestType || 'Indent'));
    }
    meta.appendChild(metaRow('Destination', view.destination));
    meta.appendChild(metaRow('Price basis', 'FOB origin and CFR ' + view.destination));
    meta.appendChild(metaRow('Link expires', formatDate(view.expiresAt)));
    var rows = slot(card, 'rows');
    view.items.forEach(function (item) {
      var tr = make('tr');
      var name = make('td');
      name.appendChild(make('strong', null, item.name));
      tr.appendChild(name);
      tr.appendChild(make('td', null, item.cas || DASH));
      tr.appendChild(make('td', 'r', formatKg(item.quantityKg)));
      rows.appendChild(tr);
    });
    return card;
  }

  function pricingCard(view, form) {
    var card = tpl('t-pricing');
    view.items.forEach(function (item, i) {
      var node = tpl('t-item');
      var nameNode = slot(node, 'name');
      nameNode.textContent = (i + 1) + '. ' + item.name;
      nameNode.id = 'item-name-' + i;
      node.setAttribute('aria-labelledby', nameNode.id);
      setSlot(node, 'cas', item.cas ? 'CAS ' + item.cas : '');
      setSlot(node, 'qty', formatKg(item.quantityKg));
      setSlot(node, 'cfrLabel', 'CFR ' + view.destination + ' price per kg');
      setSlot(node, 'cfrHelp', 'Including ocean freight to ' + view.destination);
      slot(node, 'line').id = 'line' + i;
      ['pkg', 'fob', 'cfr'].forEach(function (key) {
        var input = node.querySelector('[data-input="' + key + '"]');
        var label = node.querySelector('[data-label="' + key + '"]');
        var help = node.querySelector('[data-help="' + key + '"]');
        input.id = key + i;
        label.setAttribute('for', key + i);
        if (help) {
          help.id = key + i + '-h';
          input.setAttribute('aria-describedby', help.id);
        }
        input.removeAttribute('data-input');
        label.removeAttribute('data-label');
        if (help) {
          help.removeAttribute('data-help');
        }
      });
      fillSelect(node.querySelector('select'), view.options.packaging);
      node.querySelector('select').value = form.items[i].pkg;
      byIdIn(node, 'fob' + i).value = form.items[i].fob;
      byIdIn(node, 'cfr' + i).value = form.items[i].cfr;
      card.appendChild(node);
    });
    return card;
  }

  function byIdIn(root, id) {
    return root.querySelector('[id="' + id + '"]');
  }

  function conditionsCard(view, form) {
    var card = tpl('t-conditions');
    var today = todayKeySaoPaulo(new Date());
    fillSelect(byIdIn(card, 'cur'), view.options.currencies);
    fillSelect(byIdIn(card, 'pay'), view.options.paymentTerms);
    byIdIn(card, 'cur').value = form.cur;
    byIdIn(card, 'lead').value = form.lead;
    byIdIn(card, 'pay').value = form.pay;
    var valid = byIdIn(card, 'valid');
    valid.value = form.valid;
    valid.min = today;
    valid.max = addDaysToKey(today, 365);
    byIdIn(card, 'maker').value = form.maker;
    if (view.manufacturerRequired) {
      byIdIn(card, 'maker').setAttribute('aria-required', 'true');
    }
    byIdIn(card, 'notes').value = form.notes;
    var maxMb = Math.round((view.options.maxFileBytes / (1024 * 1024)) * 10) / 10;
    setSlot(card, 'filesHelp', 'TDS, COA or MSDS. PDF, up to ' + maxMb + ' MB each, up to ' + view.options.maxFiles + ' files.');
    return card;
  }

  function summaryCard(view, mode) {
    var aside = tpl('t-summary');
    setSlot(aside, 'totalCaption', 'Estimated total, CFR ' + view.destination);
    setSlot(aside, 'count', String(view.items.length));
    var kgTotal = view.items.reduce(function (sum, item) { return sum + Number(item.quantityKg); }, 0);
    setSlot(aside, 'qty', formatKg(kgTotal));
    byIdIn(aside, 'submit').textContent = mode === 'open' ? 'Submit offer' : 'Send updated offer';
    return aside;
  }

  function modeBanner(mode, view) {
    if (mode === 'revision') {
      var node = banner('amber', 'SQ Quimica asked you to review your prices', '', false);
      var text = (view.message ? 'Message from SQ Quimica: "' + view.message + '" ' : '') + 'Your previous offer is filled in below.';
      var span = make('span', 'p-banner-text', text);
      node.querySelector('div').appendChild(document.createTextNode(' '));
      node.querySelector('div').appendChild(span);
      return node;
    }
    if (mode === 'edit') {
      var when = view.response && view.response.submittedAt ? formatDateTime(view.response.submittedAt) : '';
      return banner('amber', 'You are updating the offer you sent' + (when ? ' on ' + when : ''), 'Your previous values are filled in. Sending again replaces the previous offer; both stay on record.', false);
    }
    if (view.message) {
      return banner('amber', 'Message from SQ Quimica', view.message, false);
    }
    return null;
  }

  function showForm(mode, focusHero) {
    var view = ctx.view;
    var form = ctx.form;
    var formNode = make('form', 'p-body p-wrap');
    formNode.setAttribute('novalidate', '');
    var col = make('div', 'p-col');
    var top = modeBanner(mode, view);
    if (top) {
      col.appendChild(top);
    }
    col.appendChild(itemsCard(view));
    col.appendChild(pricingCard(view, form));
    col.appendChild(conditionsCard(view, form));
    formNode.appendChild(col);
    formNode.appendChild(summaryCard(view, mode));
    formNode.addEventListener('input', onFormInput);
    formNode.addEventListener('change', onFormInput);
    // So o botao envia a oferta: Enter dentro de um campo de texto/numero (preco, prazo...) nao submete. Textarea, botoes e links seguem normais.
    formNode.addEventListener('keydown', function (event) {
      var target = event.target;
      if (event.key === 'Enter' && target && target.tagName === 'INPUT' && target.type !== 'button' && target.type !== 'submit' && target.type !== 'file') {
        event.preventDefault();
      }
    });
    formNode.addEventListener('submit', function (event) {
      event.preventDefault();
      submitOffer(mode);
    });
    var heroNode = hero({
      title: mode === 'revision' ? 'Price update requested' : 'Indent request',
      sub: 'This secure page is linked to a single request. Review the items, fill in your offer and submit it before the link expires.',
      ref: view.processRef,
      revision: view.revision,
      step: 2,
    });
    mount(mode === 'revision' ? 'revision' : mode === 'edit' ? 'edit' : 'open', 'Indent request', [heroNode, formNode], focusHero);
    var files = byId('files');
    files.addEventListener('change', function () {
      var picked = Array.prototype.slice.call(files.files || []);
      files.value = '';
      enqueueUploads(picked);
    });
    renderFileList();
    updateLive();
  }

  function submitOffer(mode) {
    if (ctx.submitting) {
      return;
    }
    clearAllErrors();
    var errs = validateOffer(ctx.form, ctx.view, todayKeySaoPaulo(new Date()));
    var ids = Object.keys(errs);
    if (ids.length > 0) {
      ids.forEach(function (id) { setFieldError(id, errs[id]); });
      showFieldBanner();
      focusFirstInvalid();
      return;
    }
    var payload = buildPayload(ctx.form, ctx.view);
    var button = byId('submit');
    ctx.submitting = true;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.textContent = 'Sending…';
    send('POST', endpoint('/respond'), { json: payload }).then(function (result) {
      ctx.submitting = false;
      var ok = (result.status === 200 || result.status === 201) && result.body && typeof result.body === 'object' && result.body.version !== undefined;
      if (ok) {
        ctx.view.state = 'sent';
        ctx.view.response = {
          via: 'portal',
          version: result.body.version,
          submittedAt: result.body.submittedAt,
          currency: payload.currency,
          productionLeadTimeDays: payload.productionLeadTimeDays,
          paymentTerms: payload.paymentTerms,
          validUntil: payload.validUntil,
          manufacturer: payload.manufacturer,
          notes: payload.notes,
          items: payload.items,
        };
        showSent(true, result.body.unchanged === true);
        return;
      }
      if (result.status === 404 || result.status === 410) {
        showScreen(screenForError(result.status, result.body), result.body, true);
        return;
      }
      var live = byId('submit');
      if (live) {
        live.disabled = false;
        live.removeAttribute('aria-busy');
        live.textContent = mode === 'open' ? 'Submit offer' : 'Send updated offer';
      }
      var body = result.body && typeof result.body === 'object' ? result.body : {};
      var message = typeof body.message === 'string' && body.message ? body.message : '';
      if (result.status === 400 && typeof body.path === 'string') {
        var field = errorFieldFromPath(body.path);
        if (field && setFieldError(field, message || 'Please review this field.')) {
          showFieldBanner();
          focusFirstInvalid();
          return;
        }
      }
      if (result.status === 400 || result.status === 413 || result.status === 429) {
        setAlert('err', 'Your offer was not sent', message || GENERIC_MESSAGE);
        return;
      }
      setAlert('err', 'Your offer was not sent', GENERIC_MESSAGE);
    });
  }

  /* ---------------------------------------------------------------- anexos */

  function renderFileList() {
    var list = byId('filelist');
    if (!list) {
      return;
    }
    clear(list);
    ctx.files.forEach(function (file) {
      var li = make('li', file.status === 'error' ? 'is-error' : file.status === 'pending' ? 'is-pending' : '');
      li.textContent = file.status === 'error' ? file.name + ' — ' + file.message : file.status === 'pending' ? file.name + ' — uploading…' : file.name;
      list.appendChild(li);
    });
  }

  function activeFiles() {
    return ctx.files.filter(function (file) { return file.status === 'ok' || file.status === 'pending'; });
  }

  function isPdf(file) {
    return file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
  }

  function maxMbText(bytes) {
    return Math.round((bytes / (1024 * 1024)) * 10) / 10;
  }

  function enqueueUploads(files) {
    ctx.files = ctx.files.filter(function (file) { return file.status !== 'error'; });
    files.forEach(function (file) {
      ctx.chain = ctx.chain.then(function () { return uploadOne(file); });
    });
    renderFileList();
  }

  function uploadOne(file) {
    if (ctx.dead) {
      return Promise.resolve();
    }
    var options = ctx.view.options;
    var active = activeFiles();
    var repeated = active.some(function (item) { return item.name === file.name && item.size === file.size; });
    if (repeated) {
      return Promise.resolve();
    }
    var entry = { name: file.name, size: file.size, status: 'pending', message: '' };
    function fail(message) {
      entry.status = 'error';
      entry.message = message;
      ctx.files.push(entry);
      renderFileList();
    }
    if (!isPdf(file)) {
      fail('Only PDF files are allowed.');
      return Promise.resolve();
    }
    if (file.size > options.maxFileBytes) {
      fail('The file is larger than ' + maxMbText(options.maxFileBytes) + ' MB.');
      return Promise.resolve();
    }
    if (active.length >= options.maxFiles) {
      fail('You can attach up to ' + options.maxFiles + ' files.');
      return Promise.resolve();
    }
    ctx.files.push(entry);
    renderFileList();
    return send('POST', endpoint('/attachments'), { file: file }).then(function (result) {
      var body = result.body && typeof result.body === 'object' ? result.body : {};
      if ((result.status === 200 || result.status === 201) && typeof body.fileName === 'string') {
        entry.status = 'ok';
        entry.name = body.fileName;
        renderFileList();
        return;
      }
      if (result.status === 404 || result.status === 410) {
        showScreen(screenForError(result.status, result.body), result.body, true);
        return;
      }
      entry.status = 'error';
      entry.message = UPLOAD_CODES.indexOf(body.code) !== -1 && typeof body.message === 'string' ? body.message : 'Upload failed. Please try again.';
      renderFileList();
    });
  }

  /* ---------------------------------------------------------------- enviado */

  function summaryRow(list, label, value, strong) {
    var li = make('li');
    li.appendChild(make('span', null, label));
    var right = make('span');
    if (strong) {
      right.appendChild(make('b', null, value));
    } else {
      right.textContent = value;
    }
    li.appendChild(right);
    list.appendChild(li);
  }

  function showSent(focusHero, unchanged) {
    var view = ctx.view;
    var response = view.response || {};
    var body = tpl('t-sent');
    if (unchanged) {
      slot(body, 'banners').appendChild(banner('ok', 'No changes were detected', 'Your previous offer stays on record.', false));
    }
    slot(body, 'icon').appendChild(iconNode('t-ico-check'));
    var when = response.submittedAt ? formatDateTime(response.submittedAt) : '';
    var received = (when ? 'Received on ' + when : 'Received') + (view.revision > 1 ? ' · revision ' + view.revision : '') + '. We will contact you if we need anything else. You can update it until the link expires.';
    setSlot(body, 'received', received);
    var byItem = {};
    (response.items || []).forEach(function (item) { byItem[item.quoteItemId] = item; });
    var rows = slot(body, 'rows');
    var total = 0;
    var any = false;
    view.items.forEach(function (item) {
      var saved = byItem[item.quoteItemId] || {};
      var tr = make('tr');
      var name = make('td');
      name.appendChild(make('strong', null, item.name));
      tr.appendChild(name);
      tr.appendChild(make('td', null, saved.packaging || DASH));
      tr.appendChild(make('td', 'r', formatKg(item.quantityKg)));
      tr.appendChild(make('td', 'r', saved.fobPricePerKg ? formatPrice(saved.fobPricePerKg) : DASH));
      tr.appendChild(make('td', 'r', saved.cfrPricePerKg ? formatPrice(saved.cfrPricePerKg) : DASH));
      rows.appendChild(tr);
      if (saved.cfrPricePerKg) {
        total += Number(saved.cfrPricePerKg) * Number(item.quantityKg);
        any = true;
      }
    });
    var list = slot(body, 'list');
    summaryRow(list, 'Estimated total, CFR ' + view.destination, any ? formatMoney(total, response.currency || view.currency) : DASH, true);
    summaryRow(list, 'Production lead time', response.productionLeadTimeDays ? response.productionLeadTimeDays + ' days' : DASH, false);
    summaryRow(list, 'Payment terms', response.paymentTerms || DASH, false);
    summaryRow(list, 'Valid until', response.validUntil ? formatDateKey(response.validUntil) : DASH, false);
    if (response.manufacturer) {
      summaryRow(list, 'Manufacturer', response.manufacturer, false);
    }
    var documents = activeFiles().filter(function (file) { return file.status === 'ok'; });
    if (documents.length > 0) {
      summaryRow(list, 'Documents', documents.map(function (file) { return file.name; }).join('\n'), false);
    }
    if (response.notes) {
      summaryRow(list, 'Notes', response.notes, false);
    }
    byIdIn(body, 'edit').addEventListener('click', function () {
      ctx.form = prefillForm(ctx.view);
      showForm('edit', true);
    });
    mount(
      'sent',
      'Offer received',
      [hero({ title: 'Offer received', sub: 'Thank you. Your offer is with SQ Quimica.', ref: view.processRef, revision: view.revision, step: 4 }), body],
      focusHero,
    );
  }

  /* ---------------------------------------------------------------- boot */

  function sessionStore() {
    try {
      return window.sessionStorage;
    } catch (e) {
      return null;
    }
  }

  function boot() {
    var found = readToken(window.location, sessionStore());
    ctx = { token: found ? found.token : '', apiBase: resolveApiBase(window.location), view: null, form: null, files: [], chain: Promise.resolve(), submitting: false, dead: false };
    if (!found) {
      showScreen('invalid', null, false);
      return;
    }
    if (found.fromUrl) {
      // Guarda na aba ANTES de limpar a URL; se o storage estiver bloqueado, a URL fica como esta (recarregar continua funcionando).
      var stored = false;
      try {
        window.sessionStorage.setItem(STORAGE_KEY, found.token);
        stored = true;
      } catch (e) {
        stored = false;
      }
      if (stored) {
        try {
          window.history.replaceState(null, '', window.location.pathname);
        } catch (e) {
          /* mantem a URL */
        }
      }
    }
    load();
  }

  if (typeof module === 'object' && module && module.exports) {
    module.exports = {
      TOKEN_PATTERN: TOKEN_PATTERN,
      API_ORIGIN: API_ORIGIN,
      resolveApiBase: resolveApiBase,
      readToken: readToken,
      normalizePrice: normalizePrice,
      priceScaled: priceScaled,
      todayKeySaoPaulo: todayKeySaoPaulo,
      addDaysToKey: addDaysToKey,
      validateOffer: validateOffer,
      errorFieldFromPath: errorFieldFromPath,
      buildPayload: buildPayload,
      prefillForm: prefillForm,
      formatKg: formatKg,
      formatPrice: formatPrice,
      formatMoney: formatMoney,
      formatDate: formatDate,
      formatDateTime: formatDateTime,
      screenForError: screenForError,
    };
  }

  if (typeof document !== 'undefined' && document.getElementById('ip-app')) {
    boot();
  }
})();
