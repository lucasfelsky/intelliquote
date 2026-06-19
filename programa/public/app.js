const API_BASE = '/api/v1';
const AUTH_API_BASE = '/api/v1/auth';
const INCOTERMS = ['EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'];
const PAGE_SIZE = 5;

const state = {
  authenticatedUser: null,
  activeTab: 'overview',
  suppliers: [],
  quoteRequests: [],
  quoteRequestItems: [],
  quoteResponses: [],
  supplierContacts: {},
  quoteRequestAttachments: {},
  quoteResponseAttachments: {},
  users: [],
  recoveryTokens: [],
  helpArticles: [],
  comparisonResults: [],
  comparisonHistory: [],
  auditLogs: [],
  selectedComparisonQuoteRequestId: '',
  selectedSupplierId: null,
  selectedQuoteRequestId: null,
  selectedQuoteResponseId: null,
  wizardStep: 1,
  filters: {
    supplierSearch: '',
    quoteRequestSearch: '',
    quoteRequestStatus: 'all',
    quoteRequestItemSearch: '',
    quoteRequestItemQuoteRequestId: 'all',
    quoteResponseSearch: '',
    quoteResponseWinner: 'all',
    auditEntityType: 'all',
    auditAction: 'all',
    auditEntityId: '',
    helpSearch: '',
    helpCategory: 'all',
    reportFrom: '',
    reportTo: '',
    userPage: 1,
  },
  pagination: {
    suppliers: 1,
    quoteRequests: 1,
    quoteRequestItems: 1,
    quoteResponses: 1,
    users: 1,
  },
  onboardingDismissed: false,
};

const elements = {
  authGate: document.getElementById('auth-gate'),
  appShell: document.getElementById('app-shell'),
  tabButtons: Array.from(document.querySelectorAll('[data-tab-target]')),
  tabPanels: Array.from(document.querySelectorAll('[data-tab-panel]')),
  loginForm: document.getElementById('login-form'),
  loginEmail: document.getElementById('login-email'),
  loginPassword: document.getElementById('login-password'),
  authFeedback: document.getElementById('auth-feedback'),
  logoutButton: document.getElementById('logout-button'),
  feedback: document.getElementById('feedback'),
  metrics: document.getElementById('metrics'),
  suppliersChart: document.getElementById('suppliers-chart'),
  quoteStatusChart: document.getElementById('quote-status-chart'),
  suppliersBody: document.getElementById('suppliers-body'),
  quoteRequestsBody: document.getElementById('quote-requests-body'),
  quoteRequestItemsBody: document.getElementById('quote-request-items-body'),
  quoteResponsesBody: document.getElementById('quote-responses-body'),
  suppliersPagination: document.getElementById('suppliers-pagination'),
  quoteRequestsPagination: document.getElementById('quote-requests-pagination'),
  quoteRequestItemsPagination: document.getElementById('quote-request-items-pagination'),
  quoteResponsesPagination: document.getElementById('quote-responses-pagination'),
  supplierSearch: document.getElementById('supplier-search'),
  quoteRequestSearch: document.getElementById('quote-request-search'),
  quoteRequestFilterStatus: document.getElementById('quote-request-filter-status'),
  quoteItemSearch: document.getElementById('quote-item-search'),
  quoteItemFilterQuoteRequest: document.getElementById('quote-item-filter-quote-request'),
  quoteResponseSearch: document.getElementById('quote-response-search'),
  quoteResponseFilterWinner: document.getElementById('quote-response-filter-winner'),
  comparisonResults: document.getElementById('comparison-results'),
  comparisonHistory: document.getElementById('comparison-history'),
  compareButton: document.getElementById('compare-button'),
  exportComparisonButton: document.getElementById('export-comparison-button'),
  comparisonQuoteRequest: document.getElementById('comparison-quote-request'),
  weightPrice: document.getElementById('weight-price'),
  weightPayment: document.getElementById('weight-payment'),
  weightIncoterm: document.getElementById('weight-incoterm'),
  weightsWarning: document.getElementById('comparison-weights-warning'),
  auditEntityType: document.getElementById('audit-entity-type'),
  auditAction: document.getElementById('audit-action'),
  auditEntityId: document.getElementById('audit-entity-id'),
  auditRefreshButton: document.getElementById('audit-refresh-button'),
  auditLogList: document.getElementById('audit-log-list'),
  auditTabButton: document.querySelector('[data-tab-target="audit"]'),
  usersTabButton: document.querySelector('[data-tab-target="users"]'),
  reportsTabButton: document.querySelector('[data-tab-target="reports"]'),
  helpTabButton: document.querySelector('[data-tab-target="help"]'),
  companyProfileTabButton: document.querySelector('[data-tab-target="company-profile"]'),
  companyProfileForm: document.getElementById('company-profile-form'),
  companyProfileName: document.getElementById('company-profile-name'),
  companyProfileTradeName: document.getElementById('company-profile-trade-name'),
  companyProfileTaxId: document.getElementById('company-profile-tax-id'),
  companyProfilePurchasingEmail: document.getElementById('company-profile-purchasing-email'),
  companyProfilePurchasingPhone: document.getElementById('company-profile-purchasing-phone'),
  companyProfileWebsite: document.getElementById('company-profile-website'),
  companyProfileAddress1: document.getElementById('company-profile-address-1'),
  companyProfileAddress2: document.getElementById('company-profile-address-2'),
  companyProfileCity: document.getElementById('company-profile-city'),
  companyProfileState: document.getElementById('company-profile-state'),
  companyProfilePostalCode: document.getElementById('company-profile-postal-code'),
  companyProfileCountry: document.getElementById('company-profile-country'),
  companyProfileLogoUrl: document.getElementById('company-profile-logo-url'),
  companyProfileFeedback: document.getElementById('company-profile-feedback'),
  supplierForm: document.getElementById('supplier-form'),
  supplierId: document.getElementById('supplier-id'),
  supplierName: document.getElementById('supplier-name'),
  supplierEmail: document.getElementById('supplier-email'),
  supplierWebsite: document.getElementById('supplier-website'),
  supplierCountry: document.getElementById('supplier-country'),
  supplierStatus: document.getElementById('supplier-status'),
  supplierNotes: document.getElementById('supplier-notes'),
  supplierIncoterms: document.getElementById('supplier-incoterms'),
  supplierCancel: document.getElementById('supplier-cancel'),
  supplierContactForm: document.getElementById('supplier-contact-form'),
  supplierContactId: document.getElementById('supplier-contact-id'),
  supplierContactName: document.getElementById('supplier-contact-name'),
  supplierContactEmail: document.getElementById('supplier-contact-email'),
  supplierContactPhone: document.getElementById('supplier-contact-phone'),
  supplierContactPosition: document.getElementById('supplier-contact-position'),
  supplierContactIsPrimary: document.getElementById('supplier-contact-is-primary'),
  supplierContactCancel: document.getElementById('supplier-contact-cancel'),
  supplierContactsBody: document.getElementById('supplier-contacts-body'),
  quoteRequestForm: document.getElementById('quote-request-form'),
  quoteRequestId: document.getElementById('quote-request-id'),
  quoteRequestCode: document.getElementById('quote-request-code'),
  quoteProductName: document.getElementById('quote-product-name'),
  quoteQuantity: document.getElementById('quote-quantity'),
  quoteDesiredIncoterm: document.getElementById('quote-desired-incoterm'),
  quoteCurrency: document.getElementById('quote-currency'),
  quoteDeadline: document.getElementById('quote-deadline'),
  quoteDescription: document.getElementById('quote-description'),
  quoteRequestCancel: document.getElementById('quote-request-cancel'),
  quoteRequestAttachmentForm: document.getElementById('quote-request-attachment-form'),
  quoteRequestAttachmentFile: document.getElementById('quote-request-attachment-file'),
  quoteRequestAttachmentsBody: document.getElementById('quote-request-attachments-body'),
  quoteItemForm: document.getElementById('quote-item-form'),
  quoteItemId: document.getElementById('quote-item-id'),
  quoteItemQuoteRequest: document.getElementById('quote-item-quote-request'),
  quoteItemCode: document.getElementById('quote-item-code'),
  quoteItemProductName: document.getElementById('quote-item-product-name'),
  quoteItemQuantity: document.getElementById('quote-item-quantity'),
  quoteItemUnit: document.getElementById('quote-item-unit'),
  quoteItemTargetPrice: document.getElementById('quote-item-target-price'),
  quoteItemDescription: document.getElementById('quote-item-description'),
  quoteItemNotes: document.getElementById('quote-item-notes'),
  quoteItemCancel: document.getElementById('quote-item-cancel'),
  quoteResponseForm: document.getElementById('quote-response-form'),
  quoteResponseId: document.getElementById('quote-response-id'),
  responseQuoteRequest: document.getElementById('response-quote-request'),
  responseSupplier: document.getElementById('response-supplier'),
  responsePrice: document.getElementById('response-price'),
  responseCurrency: document.getElementById('response-currency'),
  responseExchangeRate: document.getElementById('response-exchange-rate'),
  responseFreightCost: document.getElementById('response-freight-cost'),
  responseInsuranceCost: document.getElementById('response-insurance-cost'),
  responseOtherFees: document.getElementById('response-other-fees'),
  responseImportDuty: document.getElementById('response-import-duty'),
  responseIpi: document.getElementById('response-ipi'),
  responsePis: document.getElementById('response-pis'),
  responseCofins: document.getElementById('response-cofins'),
  responseIncoterm: document.getElementById('response-incoterm'),
  responsePaymentTerms: document.getElementById('response-payment-terms'),
  responseNotes: document.getElementById('response-notes'),
  quoteResponseCancel: document.getElementById('quote-response-cancel'),
  quoteResponseAttachmentForm: document.getElementById('quote-response-attachment-form'),
  quoteResponseAttachmentFile: document.getElementById('quote-response-attachment-file'),
  quoteResponseAttachmentsBody: document.getElementById('quote-response-attachments-body'),
  wizardSteps: document.querySelectorAll('[data-wizard-step]'),
  wizardPanes: document.querySelectorAll('[data-wizard-pane]'),
  wizardPrev: document.getElementById('wizard-prev'),
  wizardNext: document.getElementById('wizard-next'),
  wizardSubmit: document.getElementById('wizard-submit'),
  onboardingPanel: document.getElementById('onboarding-panel'),
  onboardingSteps: document.getElementById('onboarding-steps'),
  onboardingDismiss: document.getElementById('onboarding-dismiss'),
  reportFrom: document.getElementById('report-from'),
  reportTo: document.getElementById('report-to'),
  reportRefresh: document.getElementById('report-refresh'),
  reportSummary: document.getElementById('report-summary'),
  reportSavings: document.getElementById('report-savings'),
  reportLeadTime: document.getElementById('report-lead-time'),
  reportTopSuppliers: document.getElementById('report-top-suppliers'),
  reportAwardRate: document.getElementById('report-award-rate'),
  userForm: document.getElementById('user-form'),
  userId: document.getElementById('user-id'),
  userName: document.getElementById('user-name'),
  userEmail: document.getElementById('user-email'),
  userRole: document.getElementById('user-role'),
  userPassword: document.getElementById('user-password'),
  userActive: document.getElementById('user-active'),
  userCancel: document.getElementById('user-cancel'),
  usersBody: document.getElementById('users-body'),
  usersPagination: document.getElementById('users-pagination'),
  userTokensBody: document.getElementById('user-tokens-body'),
  userTokensRefresh: document.getElementById('user-tokens-refresh'),
  helpSearch: document.getElementById('help-search'),
  helpFilterCategory: document.getElementById('help-filter-category'),
  helpArticleList: document.getElementById('help-article-list'),
  helpArticleDetail: document.getElementById('help-article-detail'),
  forgotPasswordButton: document.getElementById('forgot-password-button'),
  forgotPasswordForm: document.getElementById('forgot-password-form'),
  forgotEmail: document.getElementById('forgot-email'),
  forgotCancelButton: document.getElementById('forgot-cancel-button'),
  resetPasswordForm: document.getElementById('reset-password-form'),
  resetToken: document.getElementById('reset-token'),
  resetPassword: document.getElementById('reset-password'),
  resetCancelButton: document.getElementById('reset-cancel-button'),
};

function setFeedback(message, isError = false) {
  elements.feedback.textContent = message;
  elements.feedback.style.color = isError ? 'var(--danger)' : 'var(--muted)';
}

function setAuthFeedback(message, isError = false) {
  elements.authFeedback.textContent = message;
  elements.authFeedback.classList.remove('hidden', 'error');

  if (isError) {
    elements.authFeedback.classList.add('error');
    return;
  }

  elements.authFeedback.classList.remove('error');
}

function clearAuthFeedback() {
  elements.authFeedback.textContent = '';
  elements.authFeedback.classList.add('hidden');
  elements.authFeedback.classList.remove('error');
}

function ensure(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function hasRole(...roles) {
  return roles.includes(state.authenticatedUser?.role);
}

function canManageSuppliers() {
  return hasRole('admin', 'comprador');
}

function canDeleteSuppliers() {
  return hasRole('admin');
}

function canManageQuoteRequests() {
  return hasRole('admin', 'comprador');
}

function canDeleteQuoteRequests() {
  return hasRole('admin');
}

function canManageQuoteItems() {
  return hasRole('admin', 'comprador');
}

function canManageQuoteState() {
  return hasRole('admin', 'gestor');
}

function canManageQuoteResponses() {
  return hasRole('admin', 'comprador');
}

function canCompareResponses() {
  return hasRole('admin', 'comprador', 'gestor');
}

function hasAuditAccess() {
  return hasRole('admin', 'gestor');
}

function showApp() {
  elements.authGate.classList.add('hidden');
  elements.appShell.classList.remove('hidden');
}

function showAuth() {
  elements.appShell.classList.add('hidden');
  elements.authGate.classList.remove('hidden');
}

function drawBarChart(canvas, labels, values, color) {
  const ctx = canvas.getContext('2d');
  const width = canvas.clientWidth || 520;
  const height = canvas.height;
  const padding = 28;
  const chartWidth = width - padding * 2;
  const chartHeight = height - padding * 2;
  const maxValue = Math.max(...values, 1);

  canvas.width = width;
  ctx.clearRect(0, 0, width, height);

  values.forEach((value, index) => {
    const barWidth = chartWidth / values.length - 16;
    const x = padding + index * (chartWidth / values.length) + 8;
    const barHeight = (value / maxValue) * (chartHeight - 30);
    const y = height - padding - barHeight;

    ctx.fillStyle = color;
    ctx.fillRect(x, y, barWidth, barHeight);
    ctx.fillStyle = '#655f55';
    ctx.font = '12px Manrope';
    ctx.fillText(String(value), x, y - 8);
    ctx.fillText(labels[index].slice(0, 12), x, height - 10);
  });
}

function drawDonutChart(canvas, data) {
  const ctx = canvas.getContext('2d');
  const width = canvas.clientWidth || 520;
  const height = canvas.height;
  const total = Object.values(data).reduce((sum, value) => sum + value, 0) || 1;
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = 70;
  const colors = ['#c85d2c', '#4e6647', '#b48a2d'];
  const entries = Object.entries(data);

  canvas.width = width;
  ctx.clearRect(0, 0, width, height);

  let startAngle = -Math.PI / 2;
  entries.forEach(([label, value], index) => {
    const angle = (value / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.arc(centerX, centerY, radius, startAngle, startAngle + angle);
    ctx.closePath();
    ctx.fillStyle = colors[index % colors.length];
    ctx.fill();
    startAngle += angle;
  });

  ctx.beginPath();
  ctx.arc(centerX, centerY, 42, 0, Math.PI * 2);
  ctx.fillStyle = '#fff8f0';
  ctx.fill();

  ctx.fillStyle = '#1f1c18';
  ctx.font = '700 20px Space Grotesk';
  ctx.textAlign = 'center';
  ctx.fillText(String(total), centerX, centerY + 6);

  ctx.textAlign = 'left';
  entries.forEach(([label, value], index) => {
    const y = 28 + index * 20;
    ctx.fillStyle = colors[index % colors.length];
    ctx.fillRect(20, y, 10, 10);
    ctx.fillStyle = '#655f55';
    ctx.font = '12px Manrope';
    ctx.fillText(`${label}: ${value}`, 38, y + 10);
  });
}

function renderCharts() {
  const supplierMap = state.suppliers.map((supplier) => ({
    label: supplier.name,
    total: state.quoteResponses.filter((response) => response.supplierId === supplier.id).length,
  }));
  const topSuppliers = supplierMap.sort((a, b) => b.total - a.total).slice(0, 5);

  drawBarChart(
    elements.suppliersChart,
    topSuppliers.map((item) => item.label),
    topSuppliers.map((item) => item.total),
    '#c85d2c',
  );

  drawDonutChart(elements.quoteStatusChart, {
    abertas: state.quoteRequests.filter((item) => item.status === 'open').length,
    fechadas: state.quoteRequests.filter((item) => item.status === 'closed').length,
  });
}

function formatCurrency(value, currency = 'USD') {
  return new Intl.NumberFormat('pt-PT', {
    style: 'currency',
    currency,
  }).format(Number(value));
}

function formatDate(value) {
  return new Intl.DateTimeFormat('pt-PT', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}

function getSelectedValues(select) {
  return Array.from(select.selectedOptions).map((option) => option.value);
}

function renderSelectOptions(select, options, valueKey, labelBuilder, placeholder) {
  if (!options.length) {
    select.innerHTML = `<option value="">${placeholder}</option>`;
    return;
  }

  select.innerHTML = options
    .map((option) => `<option value="${option[valueKey]}">${labelBuilder(option)}</option>`)
    .join('');
}

function renderIncotermOptions() {
  const markup = INCOTERMS.map((incoterm) => `<option value="${incoterm}">${incoterm}</option>`).join('');
  elements.supplierIncoterms.innerHTML = markup;
  elements.quoteDesiredIncoterm.innerHTML = markup;
  elements.responseIncoterm.innerHTML = markup;
}

function renderMetrics() {
  const openQuoteRequests = state.quoteRequests.filter((quoteRequest) => quoteRequest.status === 'open').length;
  const winnerResponses = state.quoteResponses.filter((response) => response.isWinner).length;

  elements.metrics.innerHTML = `
    <article class="metric-card">
      <span class="metric-label">Fornecedores ativos</span>
      <strong class="metric-value">${state.suppliers.length}</strong>
    </article>
    <article class="metric-card">
      <span class="metric-label">Cotacoes abertas</span>
      <strong class="metric-value">${openQuoteRequests}</strong>
    </article>
    <article class="metric-card">
      <span class="metric-label">Itens registados</span>
      <strong class="metric-value">${state.quoteRequestItems.length}</strong>
    </article>
    <article class="metric-card">
      <span class="metric-label">Propostas registadas</span>
      <strong class="metric-value">${state.quoteResponses.length}</strong>
    </article>
    <article class="metric-card">
      <span class="metric-label">Vencedoras definidas</span>
      <strong class="metric-value">${winnerResponses}</strong>
    </article>
  `;
}

function paginate(items, page) {
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(page, 1), totalPages);
  const start = (safePage - 1) * PAGE_SIZE;

  return {
    items: items.slice(start, start + PAGE_SIZE),
    page: safePage,
    totalPages,
    totalItems: items.length,
  };
}

function renderPagination(container, key, info) {
  container.innerHTML = `
    <span class="pagination-info">${info.totalItems} registos | Pagina ${info.page} de ${info.totalPages}</span>
    <button class="table-button" type="button" ${info.page === 1 ? 'disabled' : ''} onclick="changePage('${key}', ${info.page - 1})">Anterior</button>
    <button class="table-button" type="button" ${info.page === info.totalPages ? 'disabled' : ''} onclick="changePage('${key}', ${info.page + 1})">Seguinte</button>
  `;
}

function formatQuoteRequestLabel(quoteRequest) {
  const requestCode = quoteRequest.requestCode ? ` | ${quoteRequest.requestCode}` : '';
  return `${quoteRequest.productName}${requestCode} (${quoteRequest.status})`;
}

function setActiveTab(tabId) {
  if (tabId === 'audit' && !hasAuditAccess()) {
    tabId = 'overview';
  }

  if (tabId === 'users' && !hasRole('admin')) {
    tabId = 'overview';
  }

  state.activeTab = tabId;

  elements.tabButtons.forEach((button) => {
    button.classList.toggle('active', button.dataset.tabTarget === tabId);
  });

  elements.tabPanels.forEach((panel) => {
    panel.classList.toggle('hidden', panel.dataset.tabPanel !== tabId);
  });

  if (tabId === 'comparison') {
    void loadSelectedComparisonHistory();
  }

  if (tabId === 'audit') {
    void loadAuditLogs();
  }

  if (tabId === 'reports') {
    void loadReports();
  }

  if (tabId === 'users' && hasRole('admin')) {
    void loadUsers();
    void loadRecoveryTokens();
  }

  if (tabId === 'help') {
    void loadHelpArticles();
  }

  if (tabId === 'suppliers' && state.selectedSupplierId) {
    void loadSupplierContacts(state.selectedSupplierId);
  }

  if (tabId === 'quotes' && state.selectedQuoteRequestId) {
    void loadQuoteRequestAttachments(state.selectedQuoteRequestId);
  }

  if (tabId === 'responses' && state.selectedQuoteResponseId) {
    void loadQuoteResponseAttachments(state.selectedQuoteResponseId);
  }
}

function findWinnerForQuoteRequest(quoteRequestId) {
  return state.quoteResponses.find(
    (response) => response.quoteRequestId === quoteRequestId && response.isWinner,
  );
}

function getFilteredSuppliers() {
  const term = state.filters.supplierSearch.toLowerCase();
  return state.suppliers.filter((supplier) => {
    if (!term) {
      return true;
    }

    return (
      supplier.name.toLowerCase().includes(term) ||
      supplier.email.toLowerCase().includes(term)
    );
  });
}

function getFilteredQuoteRequests() {
  const term = state.filters.quoteRequestSearch.toLowerCase();
  const status = state.filters.quoteRequestStatus;

  return state.quoteRequests.filter((quoteRequest) => {
    const matchesSearch = !term || quoteRequest.productName.toLowerCase().includes(term);
    const matchesStatus = status === 'all' || quoteRequest.status === status;
    return matchesSearch && matchesStatus;
  });
}

function getFilteredQuoteRequestItems() {
  const term = state.filters.quoteRequestItemSearch.toLowerCase();
  const quoteRequestId = state.filters.quoteRequestItemQuoteRequestId;

  return state.quoteRequestItems.filter((item) => {
    const quoteLabel = item.quoteRequest?.requestCode ?? item.quoteRequest?.productName ?? '';
    const matchesSearch =
      !term ||
      (item.itemCode ?? '').toLowerCase().includes(term) ||
      item.productName.toLowerCase().includes(term) ||
      quoteLabel.toLowerCase().includes(term);
    const matchesQuoteRequest =
      quoteRequestId === 'all' || String(item.quoteRequestId) === quoteRequestId;

    return matchesSearch && matchesQuoteRequest;
  });
}

function getFilteredQuoteResponses() {
  const term = state.filters.quoteResponseSearch.toLowerCase();
  const winnerFilter = state.filters.quoteResponseWinner;

  return state.quoteResponses.filter((response) => {
    const supplierName = response.supplier?.name?.toLowerCase() ?? '';
    const quoteName = response.quoteRequest?.productName?.toLowerCase() ?? '';
    const matchesSearch =
      !term || supplierName.includes(term) || quoteName.includes(term);
    const matchesWinner =
      winnerFilter === 'all' ||
      (winnerFilter === 'winner' && response.isWinner) ||
      (winnerFilter === 'non-winner' && !response.isWinner);

    return matchesSearch && matchesWinner;
  });
}

function renderSuppliers() {
  const paginated = paginate(getFilteredSuppliers(), state.pagination.suppliers);
  state.pagination.suppliers = paginated.page;

  elements.suppliersBody.innerHTML =
    paginated.items
      .map(
        (supplier) => {
          const statusLabel = {
            active: 'Ativo',
            inactive: 'Inativo',
            blocked: 'Bloqueado',
          }[supplier.status ?? 'active'];
          const supplierContactList = state.supplierContacts[supplier.id] ?? [];
          const primaryContact = supplierContactList.find((c) => c.isPrimary);
          const hasAnyContact = supplierContactList.length > 0;
          const missingContactBadge = !hasAnyContact
            ? '<span class="chip warning" title="Cadastre ao menos um contato para enviar cotacoes">Sem contato</span>'
            : '';
          return `
            <tr data-supplier-row="${supplier.id}">
              <td>
                <div class="table-main">${supplier.name}</div>
                <div class="table-subtle">
                  ${primaryContact ? primaryContact.name : '<span class="feedback error">Sem contato principal</span>'}
                  ${missingContactBadge}
                </div>
              </td>
              <td>${supplier.email}</td>
              <td>${supplier.country ?? '-'}</td>
              <td><span class="chip ${supplier.status === 'blocked' ? 'warning' : 'neutral'}">${statusLabel}</span></td>
              <td>${supplier.acceptedIncoterms.map((incoterm) => `<span class="chip">${incoterm}</span>`).join(' ')}</td>
              <td>
                ${renderSupplierActions(supplier.id)}
              </td>
            </tr>
          `;
        },
      )
      .join('') || '<tr><td colspan="6">Nenhum fornecedor encontrado.</td></tr>';

  renderPagination(elements.suppliersPagination, 'suppliers', paginated);
}

function renderQuoteRequests() {
  const paginated = paginate(getFilteredQuoteRequests(), state.pagination.quoteRequests);
  state.pagination.quoteRequests = paginated.page;

  elements.quoteRequestsBody.innerHTML =
    paginated.items
      .map((quoteRequest) => {
        const winner = findWinnerForQuoteRequest(quoteRequest.id);
        const winnerLabel = winner
          ? `${winner.supplier?.name ?? `Fornecedor #${winner.supplierId}`} | ${formatCurrency(winner.offeredPrice, winner.currency)}`
          : 'Sem definicao';

        return `
          <tr>
            <td>
              <div class="table-main">${quoteRequest.requestCode ?? `#${quoteRequest.id}`}</div>
              <div class="table-subtle">${quoteRequest.productName} | ${quoteRequest.items?.length ?? 0} itens</div>
            </td>
            <td>${quoteRequest.productName}</td>
            <td>${quoteRequest.quantity}</td>
            <td>
              <span class="chip">${quoteRequest.desiredIncoterm}</span>
            </td>
            <td>${quoteRequest.currency ?? 'USD'}</td>
            <td><span class="chip ${quoteRequest.status === 'closed' ? 'warning' : ''}">${quoteRequest.status}</span></td>
            <td><span class="chip ${winner ? 'winner' : 'neutral'}">${winnerLabel}</span></td>
            <td>${formatDate(quoteRequest.createdAt)}</td>
            <td>
              ${renderQuoteRequestActions(quoteRequest.id)}
            </td>
          </tr>
        `;
      })
      .join('') || '<tr><td colspan="9">Nenhuma cotacao encontrada.</td></tr>';

  renderPagination(elements.quoteRequestsPagination, 'quoteRequests', paginated);
}

function renderQuoteRequestItems() {
  const paginated = paginate(
    getFilteredQuoteRequestItems(),
    state.pagination.quoteRequestItems,
  );
  state.pagination.quoteRequestItems = paginated.page;

  elements.quoteRequestItemsBody.innerHTML =
    paginated.items
      .map((item) => {
        const quoteLabel = item.quoteRequest
          ? formatQuoteRequestLabel(item.quoteRequest)
          : `Cotacao #${item.quoteRequestId}`;

        return `
          <tr>
            <td>${quoteLabel}</td>
            <td>${item.itemCode ?? '-'}</td>
            <td>
              <div class="table-main">${item.productName}</div>
              <div class="table-subtle">${item.unit} | ${item.quantity} unidades</div>
            </td>
            <td>${item.quantity} ${item.unit}</td>
            <td>${item.targetPrice ? formatCurrency(item.targetPrice, item.quoteRequest?.currency ?? 'USD') : '-'}</td>
            <td>
              ${renderQuoteRequestItemActions(item.id)}
            </td>
          </tr>
        `;
      })
      .join('') || '<tr><td colspan="6">Nenhum item encontrado.</td></tr>';

  renderPagination(elements.quoteRequestItemsPagination, 'quoteRequestItems', paginated);
}

function renderQuoteResponses() {
  const paginated = paginate(getFilteredQuoteResponses(), state.pagination.quoteResponses);
  state.pagination.quoteResponses = paginated.page;

  elements.quoteResponsesBody.innerHTML =
    paginated.items
      .map(
        (response) => `
          <tr>
            <td>${response.quoteRequest?.requestCode ?? response.quoteRequest?.productName ?? `#${response.quoteRequestId}`}</td>
            <td>${response.supplier?.name ?? `#${response.supplierId}`}</td>
            <td>
              <div class="table-main">${formatCurrency(response.offeredPrice, response.currency)}</div>
              <div class="table-subtle">Landed cost ${formatCurrency(response.totalLandedCost ?? 0, 'BRL')}</div>
            </td>
            <td><span class="chip">${response.offeredIncoterm}</span></td>
            <td>
              <div class="table-main">${response.paymentTermsDays} dias</div>
              <div class="table-subtle">${response.exchangeRate ?? '-'} BRL | ${response.leadTimeDays ?? '-'} dias de lead time</div>
            </td>
            <td>${response.isWinner ? '<span class="chip winner">Melhor proposta</span>' : '-'}</td>
            <td>
              ${renderQuoteResponseActions(response.id)}
            </td>
          </tr>
        `,
      )
      .join('') || '<tr><td colspan="7">Nenhuma proposta encontrada.</td></tr>';

  renderPagination(elements.quoteResponsesPagination, 'quoteResponses', paginated);
}

function renderRelationSelects() {
  const openQuoteRequests = state.quoteRequests.filter((quoteRequest) => quoteRequest.status === 'open');
  const comparisonQuoteRequestId =
    state.selectedComparisonQuoteRequestId || elements.comparisonQuoteRequest.value;

  renderSelectOptions(
    elements.responseSupplier,
    state.suppliers.filter((supplier) => supplier.status !== 'blocked'),
    'id',
    (supplier) => supplier.name,
    'Registe primeiro um fornecedor',
  );

  renderSelectOptions(
    elements.responseQuoteRequest,
    openQuoteRequests,
    'id',
    formatQuoteRequestLabel,
    'Registe primeiro uma cotacao aberta',
  );

  renderSelectOptions(
    elements.quoteItemQuoteRequest,
    openQuoteRequests,
    'id',
    formatQuoteRequestLabel,
    'Registe primeiro uma cotacao aberta',
  );

  renderSelectOptions(
    elements.comparisonQuoteRequest,
    state.quoteRequests,
    'id',
    formatQuoteRequestLabel,
    'Registe primeiro uma cotacao',
  );
  if (
    comparisonQuoteRequestId &&
    state.quoteRequests.some(
      (quoteRequest) => String(quoteRequest.id) === String(comparisonQuoteRequestId),
    )
  ) {
    elements.comparisonQuoteRequest.value = String(comparisonQuoteRequestId);
  }
  state.selectedComparisonQuoteRequestId = elements.comparisonQuoteRequest.value;

  const itemFilterOptions = [
    '<option value="all">Todas</option>',
    ...state.quoteRequests.map(
      (quoteRequest) =>
        `<option value="${quoteRequest.id}">${formatQuoteRequestLabel(quoteRequest)}</option>`,
    ),
  ];
  elements.quoteItemFilterQuoteRequest.innerHTML = itemFilterOptions.join('');
  elements.quoteItemFilterQuoteRequest.value = state.filters.quoteRequestItemQuoteRequestId;
  syncResponseCurrencyFromQuoteRequest();
  renderComparisonActionState();
  validateWeights();
}

function renderComparison(results, emptyMessage = 'Nenhuma proposta disponivel para comparar.') {
  state.comparisonResults = Array.isArray(results) ? results : [];

  if (!state.comparisonResults.length) {
    elements.comparisonResults.classList.add('empty-state');
    elements.comparisonResults.textContent = emptyMessage;
    renderComparisonActionState();
    return;
  }

  elements.comparisonResults.classList.remove('empty-state');
  elements.comparisonResults.innerHTML = state.comparisonResults
    .map((result) => {
      const supplier = state.suppliers.find((item) => item.id === result.supplierId);

      return `
        <article class="result-card ${result.isWinner ? 'winner' : ''}">
          <div class="result-header">
            <div>
              <p class="section-tag">Fornecedor</p>
              <h3>${supplier?.name ?? `Fornecedor #${result.supplierId}`}</h3>
            </div>
            ${result.isWinner ? '<span class="chip winner">Vencedora</span>' : ''}
          </div>
          <div class="result-score">${result.totalScore}</div>
          <div class="result-breakdown">
            <span>Preco: ${result.priceScore} / 50</span>
            <span>Pagamento: ${result.paymentTermsScore} / 30</span>
            <span>Incoterm: ${result.incotermScore} / 20</span>
            <span>Oferta: ${formatCurrency(result.offeredPrice, result.currency)} | ${result.offeredIncoterm} | ${result.paymentTermsDays} dias</span>
            <span>CIF: ${formatCurrency(result.cifValue ?? 0, 'BRL')} | Landed cost: ${formatCurrency(result.totalLandedCost ?? 0, 'BRL')}</span>
          </div>
        </article>
        `;
    })
    .join('');
  renderComparisonActionState();
}

function renderComparisonHistory(
  comparisons,
  emptyMessage = 'Seleccione uma cotacao para rever o historico auditavel.',
) {
  state.comparisonHistory = Array.isArray(comparisons) ? comparisons : [];

  if (!state.comparisonHistory.length) {
    elements.comparisonHistory.classList.add('empty-state');
    elements.comparisonHistory.textContent = emptyMessage;
    return;
  }

  elements.comparisonHistory.classList.remove('empty-state');
  elements.comparisonHistory.innerHTML = state.comparisonHistory
    .map((comparison) => {
      const winner = comparison.results.find((result) => result.isWinner);
      const winnerLabel = winner
        ? winner.quoteResponse?.supplier?.name ?? `Fornecedor #${winner.supplierId}`
        : 'Sem vencedora';
      const executedBy = comparison.executedBy?.name ?? 'Sistema';

      return `
        <article class="history-card">
          <div class="history-card-header">
            <div>
              <p class="section-tag">Comparacao #${comparison.id}</p>
              <h3>${formatDate(comparison.createdAt)}</h3>
            </div>
            <span class="chip ${winner ? 'winner' : 'neutral'}">${winnerLabel}</span>
          </div>
          <p class="history-meta">Executada por <strong>${executedBy}</strong>.</p>
          <div class="history-meta-row">
            <span class="chip neutral">Preco ${comparison.priceWeight}</span>
            <span class="chip neutral">Pagamento ${comparison.paymentTermsWeight}</span>
            <span class="chip neutral">Incoterm ${comparison.incotermWeight}</span>
            <span class="chip neutral">${comparison.results.length} propostas</span>
          </div>
          <div class="history-score-list">
            ${comparison.results
              .map((result) => {
                const supplierName =
                  result.quoteResponse?.supplier?.name ?? `Fornecedor #${result.supplierId}`;

                return `
                  <div class="history-score-item ${result.isWinner ? 'winner' : ''}">
                    <div>
                      <strong>${supplierName}</strong>
                      <div class="table-subtle">
                        ${formatCurrency(result.offeredPrice, result.quoteResponse?.currency ?? 'USD')} | ${result.offeredIncoterm} | ${result.paymentTermsDays} dias
                      </div>
                      <div class="table-subtle">
                        CIF ${formatCurrency(result.cifValue ?? 0, 'BRL')} | Landed ${formatCurrency(result.totalLandedCost ?? 0, 'BRL')}
                      </div>
                    </div>
                    <strong>${Number(result.totalScore).toFixed(2)}</strong>
                  </div>
                `;
              })
              .join('')}
          </div>
        </article>
      `;
    })
    .join('');
}

function renderAuditLogs(
  auditLogs,
  emptyMessage = 'Nenhum registo encontrado para os filtros selecionados.',
) {
  state.auditLogs = Array.isArray(auditLogs) ? auditLogs : [];

  if (!state.auditLogs.length) {
    elements.auditLogList.classList.add('empty-state');
    elements.auditLogList.textContent = emptyMessage;
    return;
  }

  elements.auditLogList.classList.remove('empty-state');
  elements.auditLogList.innerHTML = state.auditLogs
    .map((entry) => {
      const performedBy = entry.performedBy?.name ?? 'Sistema';
      const roleName = entry.performedBy?.role?.name
        ? ` | ${entry.performedBy.role.name}`
        : '';

      return `
        <article class="audit-card">
          <div class="audit-card-header">
            <div>
              <p class="section-tag">${formatAuditEntityType(entry.entityType)} #${entry.entityId}</p>
              <h3>${formatAuditAction(entry.action)}</h3>
            </div>
            <span class="chip neutral">${formatDate(entry.createdAt)}</span>
          </div>
          <p class="audit-meta">Executado por <strong>${performedBy}</strong>${roleName}.</p>
          <div class="audit-payloads">
            ${renderAuditPayload('Antes', entry.beforeData)}
            ${renderAuditPayload('Depois', entry.afterData)}
            ${renderAuditPayload('Metadata', entry.metadata)}
          </div>
        </article>
      `;
    })
    .join('');
}

function renderAll() {
  renderMetrics();
  renderCharts();
  renderSuppliers();
  renderQuoteRequests();
  renderQuoteRequestItems();
  renderQuoteResponses();
  renderUsers();
  renderRelationSelects();
  applyPermissions();
  updateOnboardingSteps();
}

function ensureOptionExists(select, value, label) {
  const hasOption = Array.from(select.options).some((option) => option.value === value);

  if (!hasOption) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    select.append(option);
  }
}

function resetPage(key) {
  state.pagination[key] = 1;
}

function exportComparisonCsv() {
  if (!state.comparisonResults.length) {
    setFeedback('Execute uma comparacao antes de exportar.', true);
    return;
  }

  const rows = [
    ['supplier', 'offered_price', 'currency', 'exchange_rate', 'cif_value_brl', 'total_landed_cost_brl', 'offered_incoterm', 'payment_terms_days', 'price_score', 'payment_terms_score', 'incoterm_score', 'total_score', 'is_winner'],
    ...state.comparisonResults.map((result) => {
      const supplier = state.suppliers.find((item) => item.id === result.supplierId);
      return [
        supplier?.name ?? `Fornecedor #${result.supplierId}`,
        result.offeredPrice,
        result.currency,
        result.exchangeRate ?? '',
        result.cifValue ?? '',
        result.totalLandedCost ?? '',
        result.offeredIncoterm,
        result.paymentTermsDays,
        result.priceScore,
        result.paymentTermsScore,
        result.incotermScore,
        result.totalScore,
        result.isWinner,
      ];
    }),
  ];

  const csv = rows
    .map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(','))
    .join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const quoteRequest = state.quoteRequests.find(
    (item) => String(item.id) === elements.comparisonQuoteRequest.value,
  );

  link.href = url;
  link.download = `comparacao-${quoteRequest?.productName?.replaceAll(' ', '-').toLowerCase() ?? 'intelliquote'}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  setFeedback('Comparacao exportada em CSV.');
}

async function request(url, options = {}) {
  const init = { credentials: 'include', ...options };
  if (init.body && !(init.body instanceof FormData) && !init.headers) {
    init.headers = { 'Content-Type': 'application/json' };
  }
  if (init.body && !(init.body instanceof FormData) && init.headers) {
    init.headers = { 'Content-Type': 'application/json', ...init.headers };
  }
  const response = await fetch(url, init);

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const error = new Error(body.message || 'Falha no pedido.');
    error.status = response.status;
    throw error;
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

function isUnauthorizedError(error) {
  return error?.status === 401;
}

function isForbiddenError(error) {
  return error?.status === 403;
}

function getSelectedComparisonQuoteRequest() {
  return state.quoteRequests.find(
    (quoteRequest) => String(quoteRequest.id) === elements.comparisonQuoteRequest.value,
  );
}

function syncResponseCurrencyFromQuoteRequest() {
  const selectedQuoteRequest = state.quoteRequests.find(
    (quoteRequest) => String(quoteRequest.id) === elements.responseQuoteRequest.value,
  );

  if (!selectedQuoteRequest) {
    return;
  }

  elements.responseCurrency.value = selectedQuoteRequest.currency ?? 'USD';

  if (elements.responseCurrency.value === 'BRL' && !elements.responseExchangeRate.value) {
    elements.responseExchangeRate.value = '1';
  }
}

function renderComparisonActionState() {
  const selectedQuoteRequest = getSelectedComparisonQuoteRequest();
  const canRunComparison = Boolean(selectedQuoteRequest) && canCompareResponses();

  elements.compareButton.disabled = !canRunComparison || selectedQuoteRequest?.status !== 'open';
  elements.exportComparisonButton.disabled = !state.comparisonResults.length;
}

function formatAuditEntityType(entityType) {
  const labels = {
    supplier: 'Fornecedor',
    quote_request: 'Cotacao',
    quote_request_item: 'Item',
    quote_response: 'Proposta',
  };

  return labels[entityType] ?? entityType;
}

function formatAuditAction(action) {
  const labels = {
    create: 'Criacao',
    update: 'Atualizacao',
    delete: 'Eliminacao',
    close: 'Fecho',
    reopen: 'Reabertura',
    compare: 'Comparacao',
  };

  return labels[action] ?? action;
}

function renderAuditPayload(label, payload) {
  if (payload === undefined || payload === null) {
    return '';
  }

  return `
    <details>
      <summary>${label}</summary>
      <pre class="json-block">${escapeHtml(JSON.stringify(payload, null, 2))}</pre>
    </details>
  `;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function buildAuditQuery() {
  const params = new URLSearchParams();

  if (state.filters.auditEntityType !== 'all') {
    params.set('entityType', state.filters.auditEntityType);
  }

  if (state.filters.auditAction !== 'all') {
    params.set('action', state.filters.auditAction);
  }

  if (state.filters.auditEntityId) {
    params.set('entityId', state.filters.auditEntityId);
  }

  params.set('limit', '50');
  return params.toString();
}

async function loadAuthenticatedUser() {
  const response = await request(`${AUTH_API_BASE}/me`);
  state.authenticatedUser = response.user;
  return response.user;
}

async function loadData(showMessage = false) {
  try {
    const [suppliers, quoteRequests, quoteRequestItems, quoteResponses] = await Promise.all([
      request(`${API_BASE}/suppliers`),
      request(`${API_BASE}/quote-requests`),
      request(`${API_BASE}/quote-request-items`),
      request(`${API_BASE}/quote-responses`),
    ]);

    state.suppliers = suppliers;
    state.quoteRequests = quoteRequests;
    state.quoteRequestItems = quoteRequestItems;
    state.quoteResponses = quoteResponses;

    // Carrega contatos em bulk (1 request) para descobrir o "contato principal"
    // de cada fornecedor, sem precisar clicar em cada um.
    if (state.suppliers.length > 0) {
      try {
        const supplierIds = state.suppliers.map((s) => s.id).join(',');
        const bulk = await request(`${API_BASE}/supplier-contacts?supplierIds=${supplierIds}`);
        state.supplierContacts = bulk.bySupplier ?? {};
      } catch (error) {
        // Se o endpoint bulk falhar, mantemos o comportamento anterior (carregar sob demanda)
        console.warn('Bulk contacts load failed, falling back to per-supplier', error);
      }
    }

    await loadCompanyProfile();
    renderAll();

    if (state.selectedComparisonQuoteRequestId) {
      await loadSelectedComparisonHistory();
    }

    if (showMessage) {
      setFeedback('Dados sincronizados com sucesso.');
    }
  } catch (error) {
    if (isUnauthorizedError(error)) {
      state.authenticatedUser = null;
      showAuth();
      clearAuthFeedback();
      setFeedback('Sessao expirada. Entre novamente.', true);
      return;
    }

    if (isForbiddenError(error)) {
      setFeedback('O seu perfil nao tem permissao para carregar estes dados.', true);
      return;
    }

    setFeedback(error.message, true);
  }
}
async function loadSelectedComparisonHistory() {
  const quoteRequestId = elements.comparisonQuoteRequest.value;
  state.selectedComparisonQuoteRequestId = quoteRequestId;

  if (!quoteRequestId) {
    renderComparison(
      [],
      'Seleccione uma cotacao aberta para comparar ou uma fechada para rever o ultimo resultado.',
    );
    renderComparisonHistory([]);
    return;
  }

  try {
    const payload = await request(`${API_BASE}/quote-requests/${quoteRequestId}/comparisons`);
    const comparisons = Array.isArray(payload.comparisons) ? payload.comparisons : [];

    renderComparisonHistory(
      comparisons,
      'Esta cotacao ainda nao tem historico auditavel de comparacao.',
    );
    renderComparison(
      comparisons[0]?.results ?? [],
      comparisons.length
        ? 'Nao foi possivel carregar os resultados desta comparacao.'
        : 'Esta cotacao ainda nao foi comparada.',
    );
  } catch (error) {
    if (isUnauthorizedError(error)) {
      state.authenticatedUser = null;
      showAuth();
      clearAuthFeedback();
      setFeedback('Sessao expirada. Entre novamente.', true);
      return;
    }

    if (isForbiddenError(error)) {
      renderComparisonHistory([], 'O seu perfil nao tem permissao para ver o historico.');
      setFeedback('O seu perfil nao tem permissao para consultar o historico.', true);
      return;
    }

    renderComparisonHistory([], 'Nao foi possivel carregar o historico desta cotacao.');
    setFeedback(error.message, true);
  }
}

async function loadAuditLogs(showSuccessMessage = false) {
  if (!hasAuditAccess()) {
    return;
  }

  try {
    const query = buildAuditQuery();
    const auditLogs = await request(`${API_BASE}/audit${query ? `?${query}` : ''}`);
    renderAuditLogs(auditLogs);

    if (showSuccessMessage) {
      setFeedback('Auditoria sincronizada com sucesso.');
    }
  } catch (error) {
    if (isUnauthorizedError(error)) {
      state.authenticatedUser = null;
      showAuth();
      clearAuthFeedback();
      setFeedback('Sessao expirada. Entre novamente.', true);
      return;
    }

    if (isForbiddenError(error)) {
      renderAuditLogs([], 'O seu perfil nao tem permissao para consultar a auditoria.');
      setFeedback('O seu perfil nao tem permissao para consultar a auditoria.', true);
      return;
    }

    renderAuditLogs([], 'Nao foi possivel carregar os registos de auditoria.');
    setFeedback(error.message, true);
  }
}

function applyPermissions() {
  elements.supplierForm.classList.toggle('hidden', !canManageSuppliers());
  elements.supplierContactForm?.classList.toggle('hidden', !canManageSuppliers());
  elements.quoteRequestForm.classList.toggle('hidden', !canManageQuoteRequests());
  elements.quoteRequestAttachmentForm?.classList.toggle('hidden', !canManageQuoteRequests());
  elements.quoteItemForm.classList.toggle('hidden', !canManageQuoteItems());
  elements.quoteResponseForm.classList.toggle('hidden', !canManageQuoteResponses());
  elements.quoteResponseAttachmentForm?.classList.toggle('hidden', !canManageQuoteResponses());
  elements.compareButton.classList.toggle('hidden', !canCompareResponses());
  elements.auditTabButton.classList.toggle('hidden', !hasAuditAccess());
  elements.usersTabButton?.classList.toggle('hidden', !hasRole('admin'));
  elements.reportsTabButton?.classList.toggle('hidden', !hasAuditAccess());
  elements.helpTabButton?.classList.toggle('hidden', false);
  elements.companyProfileTabButton?.classList.toggle('hidden', false);

  if (!canManageSuppliers()) {
    resetSupplierForm();
  }

  if (!canManageQuoteRequests()) {
    resetQuoteRequestForm();
  }

  if (!canManageQuoteItems()) {
    resetQuoteItemForm();
  }

  if (!canManageQuoteResponses()) {
    resetQuoteResponseForm();
  }

  if (elements.userForm) {
    elements.userForm.classList.toggle('hidden', !hasRole('admin'));
  }

  if (!hasAuditAccess() && state.activeTab === 'audit') {
    setActiveTab('overview');
  }

  if (!hasRole('admin') && state.activeTab === 'users') {
    setActiveTab('overview');
  }

  renderComparisonActionState();
  validateWeights();
}

function initTabs() {
  elements.tabButtons.forEach((button) => {
    button.addEventListener('click', () => {
      setActiveTab(button.dataset.tabTarget);
    });
  });

  setActiveTab(state.activeTab);
}

function setAuditFilterState() {
  state.filters.auditEntityType = elements.auditEntityType.value;
  state.filters.auditAction = elements.auditAction.value;
  state.filters.auditEntityId = elements.auditEntityId.value.trim();
}

function renderSupplierActions(id) {
  const actions = [];

  if (canManageSuppliers()) {
    actions.push(`<button class="table-button" type="button" onclick="editSupplier(${id})">Editar</button>`);
  }

  if (canDeleteSuppliers()) {
    actions.push(`<button class="danger-button" type="button" onclick="deleteSupplier(${id})">Apagar</button>`);
  }

  if (!actions.length) {
    return '<span class="chip neutral">Leitura</span>';
  }

  return `<div class="table-actions">${actions.join('')}</div>`;
}

function renderQuoteRequestActions(id) {
  const actions = [];
  const quoteRequest = state.quoteRequests.find((item) => item.id === id);

  if (canManageQuoteRequests() && quoteRequest?.status === 'open') {
    actions.push(`<button class="table-button" type="button" onclick="openDispatchModal(${id})">Enviar para fornecedores</button>`);
    actions.push(`<button class="table-button" type="button" onclick="editQuoteRequest(${id})">Editar</button>`);
  }

  if (canManageQuoteState() && quoteRequest?.status === 'open') {
    actions.push(`<button class="table-button" type="button" onclick="closeQuoteRequest(${id})">Fechar</button>`);
  }

  if (canManageQuoteState() && quoteRequest?.status === 'closed') {
    actions.push(`<button class="table-button" type="button" onclick="reopenQuoteRequest(${id})">Reabrir</button>`);
  }

  actions.push(`<button class="table-button" type="button" onclick="showDispatchHistory(${id})">Ver envios</button>`);

  if (canDeleteQuoteRequests()) {
    actions.push(`<button class="danger-button" type="button" onclick="deleteQuoteRequest(${id})">Apagar</button>`);
  }

  if (!actions.length) {
    return '<span class="chip neutral">Leitura</span>';
  }

  return `<div class="table-actions">${actions.join('')}</div>`;
}

function renderQuoteRequestItemActions(id) {
  const actions = [];
  const item = state.quoteRequestItems.find((entry) => entry.id === id);

  if (canManageQuoteItems() && item?.quoteRequest?.status === 'open') {
    actions.push(`<button class="table-button" type="button" onclick="editQuoteRequestItem(${id})">Editar</button>`);
    actions.push(`<button class="danger-button" type="button" onclick="deleteQuoteRequestItem(${id})">Apagar</button>`);
  }

  if (!actions.length) {
    return '<span class="chip neutral">Leitura</span>';
  }

  return `<div class="table-actions">${actions.join('')}</div>`;
}

function renderQuoteResponseActions(id) {
  const actions = [];
  const quoteResponse = state.quoteResponses.find((item) => item.id === id);
  const canEdit = canManageQuoteResponses() && quoteResponse?.quoteRequest?.status === 'open';

  if (canEdit) {
    actions.push(`<button class="table-button" type="button" onclick="editQuoteResponse(${id})">Editar</button>`);
    actions.push(`<button class="danger-button" type="button" onclick="deleteQuoteResponse(${id})">Apagar</button>`);
  }

  if (!actions.length) {
    return '<span class="chip neutral">Leitura</span>';
  }

  return `<div class="table-actions">${actions.join('')}</div>`;
}

function resetSupplierForm() {
  elements.supplierForm.reset();
  elements.supplierId.value = '';
  elements.supplierStatus.value = 'active';
  elements.supplierCancel.classList.add('hidden');
}

function resetQuoteRequestForm() {
  elements.quoteRequestForm.reset();
  elements.quoteRequestId.value = '';
  elements.quoteCurrency.value = 'USD';
  elements.quoteRequestCancel.classList.add('hidden');
}

function resetQuoteItemForm() {
  elements.quoteItemForm.reset();
  elements.quoteItemId.value = '';
  elements.quoteItemUnit.value = 'UN';
  elements.quoteItemCancel.classList.add('hidden');
}

function resetQuoteResponseForm() {
  elements.quoteResponseForm.reset();
  elements.quoteResponseId.value = '';
  elements.responseCurrency.value = 'USD';
  elements.responseExchangeRate.value = '';
  elements.responseFreightCost.value = '0';
  elements.responseInsuranceCost.value = '0';
  elements.responseOtherFees.value = '0';
  elements.responseImportDuty.value = '0';
  elements.responseIpi.value = '0';
  elements.responsePis.value = '0';
  elements.responseCofins.value = '0';
  elements.quoteResponseCancel.classList.add('hidden');
  showWizardStep(1);
}

function resetUserForm() {
  if (!elements.userForm) {
    return;
  }
  elements.userForm.reset();
  elements.userId.value = '';
  elements.userActive.checked = true;
  elements.userPassword.value = '';
  elements.userCancel.classList.add('hidden');
}

function resetSupplierContactForm() {
  if (!elements.supplierContactForm) {
    return;
  }
  elements.supplierContactForm.reset();
  elements.supplierContactId.value = '';
  elements.supplierContactIsPrimary.checked = false;
  elements.supplierContactCancel.classList.add('hidden');
}

elements.loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearAuthFeedback();

  try {
    await request(`${AUTH_API_BASE}/login`, {
      method: 'POST',
      body: JSON.stringify({
        email: elements.loginEmail.value.trim(),
        password: elements.loginPassword.value,
      }),
    });

    await loadAuthenticatedUser();
    elements.loginForm.reset();
    showApp();
    await loadData(true);
  } catch (error) {
    elements.loginPassword.value = '';
    setAuthFeedback(error.message, true);
  }
});

elements.logoutButton.addEventListener('click', async () => {
  try {
    await request(`${AUTH_API_BASE}/logout`, {
      method: 'POST',
    });
  } catch (_error) {
    // Limpa a sessao local mesmo que o token ja tenha expirado.
  }

  state.authenticatedUser = null;
  showAuth();
  clearAuthFeedback();
  state.comparisonResults = [];
  state.comparisonHistory = [];
  state.auditLogs = [];
  state.selectedComparisonQuoteRequestId = '';
  renderComparison([]);
  renderComparisonHistory([]);
  renderAuditLogs([], 'Os registos de auditoria vao aparecer aqui.');
});

elements.supplierForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const payload = {
    name: elements.supplierName.value,
    email: elements.supplierEmail.value,
    website: elements.supplierWebsite.value || null,
    country: elements.supplierCountry.value || null,
    status: elements.supplierStatus.value,
    notes: elements.supplierNotes.value || null,
    acceptedIncoterms: getSelectedValues(elements.supplierIncoterms),
  };

  try {
    ensure(payload.name.trim().length > 1, 'Indique um nome valido para o fornecedor.');
    ensure(payload.email.includes('@'), 'Indique um e-mail valido.');
    ensure(payload.acceptedIncoterms.length > 0, 'Seleccione pelo menos um incoterm aceite.');

    const id = elements.supplierId.value;
    const saved = await request(id ? `${API_BASE}/suppliers/${id}` : `${API_BASE}/suppliers`, {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify(payload),
    });
    resetSupplierForm();
    if (saved?.id) {
      state.selectedSupplierId = saved.id;
      await loadSupplierContacts(saved.id);
    }
    await loadData();
    setFeedback('Fornecedor guardado com sucesso.');
  } catch (error) {
    if (isForbiddenError(error)) {
      setFeedback('O seu perfil nao tem permissao para gerir fornecedores.', true);
      return;
    }

    setFeedback(error.message, true);
  }
});

elements.quoteRequestForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const payload = {
    productName: elements.quoteProductName.value,
    quantity: Number(elements.quoteQuantity.value),
    desiredIncoterm: elements.quoteDesiredIncoterm.value,
    currency: elements.quoteCurrency.value || 'USD',
    description: elements.quoteDescription.value || null,
    deadlineAt: elements.quoteDeadline.value || null,
  };

  if (elements.quoteRequestCode.value) {
    payload.requestCode = elements.quoteRequestCode.value;
  }

  try {
    ensure(payload.productName.trim().length > 1, 'Indique um produto valido.');
    ensure(payload.quantity > 0, 'A quantidade tem de ser superior a zero.');
    ensure(payload.currency.length === 3, 'Indique uma moeda valida com 3 letras.');

    const id = elements.quoteRequestId.value;
    const saved = await request(id ? `${API_BASE}/quote-requests/${id}` : `${API_BASE}/quote-requests`, {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify(payload),
    });
    resetQuoteRequestForm();
    if (saved?.id) {
      state.selectedQuoteRequestId = saved.id;
      await loadQuoteRequestAttachments(saved.id);
    }
    await loadData();
    setFeedback('Cotacao guardada com sucesso.');
  } catch (error) {
    if (isForbiddenError(error)) {
      setFeedback('O seu perfil nao tem permissao para gerir cotacoes.', true);
      return;
    }

    setFeedback(error.message, true);
  }
});

elements.quoteItemForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const payload = {
    itemCode: elements.quoteItemCode.value || null,
    productName: elements.quoteItemProductName.value,
    description: elements.quoteItemDescription.value || null,
    quantity: Number(elements.quoteItemQuantity.value),
    unit: elements.quoteItemUnit.value,
    targetPrice: elements.quoteItemTargetPrice.value
      ? Number(elements.quoteItemTargetPrice.value)
      : null,
    notes: elements.quoteItemNotes.value || null,
  };

  try {
    const quoteRequestId = Number(elements.quoteItemQuoteRequest.value);
    ensure(quoteRequestId > 0, 'Seleccione uma cotacao aberta para o item.');
    ensure(payload.productName.trim().length > 1, 'Indique um produto valido para o item.');
    ensure(payload.quantity > 0, 'A quantidade do item tem de ser superior a zero.');
    ensure(payload.unit.trim().length > 0, 'Indique uma unidade valida para o item.');
    ensure(
      payload.targetPrice === null || payload.targetPrice > 0,
      'O preco alvo deve ser superior a zero quando informado.',
    );

    const id = elements.quoteItemId.value;
    await request(
      id
        ? `${API_BASE}/quote-request-items/${id}`
        : `${API_BASE}/quote-requests/${quoteRequestId}/items`,
      {
        method: id ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      },
    );
    resetQuoteItemForm();
    await loadData();
    setActiveTab('items');
    setFeedback('Item guardado com sucesso.');
  } catch (error) {
    if (isForbiddenError(error)) {
      setFeedback('O seu perfil nao tem permissao para gerir itens da cotacao.', true);
      return;
    }

    setFeedback(error.message, true);
  }
});

elements.quoteResponseForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const payload = {
    quoteRequestId: Number(elements.responseQuoteRequest.value),
    supplierId: Number(elements.responseSupplier.value),
    offeredPrice: Number(elements.responsePrice.value),
    currency: elements.responseCurrency.value.trim().toUpperCase(),
    exchangeRate: elements.responseExchangeRate.value
      ? Number(elements.responseExchangeRate.value)
      : undefined,
    freightCost: Number(elements.responseFreightCost.value || 0),
    insuranceCost: Number(elements.responseInsuranceCost.value || 0),
    otherFees: Number(elements.responseOtherFees.value || 0),
    importDuty: Number(elements.responseImportDuty.value || 0),
    ipi: Number(elements.responseIpi.value || 0),
    pis: Number(elements.responsePis.value || 0),
    cofins: Number(elements.responseCofins.value || 0),
    offeredIncoterm: elements.responseIncoterm.value,
    paymentTermsDays: Number(elements.responsePaymentTerms.value),
    notes: elements.responseNotes?.value || undefined,
  };

  try {
    ensure(payload.quoteRequestId > 0, 'Seleccione uma cotacao aberta.');
    ensure(payload.supplierId > 0, 'Seleccione um fornecedor.');
    ensure(payload.offeredPrice > 0, 'O preco proposto tem de ser superior a zero.');
    ensure(payload.currency.length === 3, 'Indique uma moeda valida com 3 letras.');
    ensure(
      payload.currency === 'BRL' || (payload.exchangeRate ?? 0) > 0,
      'Informe a exchange rate para propostas fora de BRL.',
    );
    ensure(payload.freightCost >= 0, 'O frete nao pode ser negativo.');
    ensure(payload.insuranceCost >= 0, 'O seguro nao pode ser negativo.');
    ensure(payload.otherFees >= 0, 'Outras taxas nao podem ser negativas.');
    ensure(payload.importDuty >= 0, 'O II nao pode ser negativo.');
    ensure(payload.ipi >= 0, 'O IPI nao pode ser negativo.');
    ensure(payload.pis >= 0, 'O PIS nao pode ser negativo.');
    ensure(payload.cofins >= 0, 'O COFINS nao pode ser negativo.');
    ensure(payload.paymentTermsDays >= 0, 'O prazo de pagamento nao pode ser negativo.');

    const id = elements.quoteResponseId.value;
    const saved = await request(id ? `${API_BASE}/quote-responses/${id}` : `${API_BASE}/quote-responses`, {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify(payload),
    });
    resetQuoteResponseForm();
    if (saved?.id) {
      state.selectedQuoteResponseId = saved.id;
      await loadQuoteResponseAttachments(saved.id);
    }
    await loadData();
    setFeedback('Proposta guardada com sucesso.');
  } catch (error) {
    if (isForbiddenError(error)) {
      setFeedback('O seu perfil nao tem permissao para gerir propostas.', true);
      return;
    }

    setFeedback(error.message, true);
  }
});

elements.supplierCancel.addEventListener('click', resetSupplierForm);
elements.quoteRequestCancel.addEventListener('click', resetQuoteRequestForm);
elements.quoteItemCancel.addEventListener('click', resetQuoteItemForm);
elements.quoteResponseCancel.addEventListener('click', resetQuoteResponseForm);
if (elements.userCancel) {
  elements.userCancel.addEventListener('click', resetUserForm);
}
if (elements.supplierContactCancel) {
  elements.supplierContactCancel.addEventListener('click', resetSupplierContactForm);
}

if (elements.supplierContactForm) {
  elements.supplierContactForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!state.selectedSupplierId) {
      setFeedback('Guarde ou selecione um fornecedor antes de adicionar contatos.', true);
      return;
    }
    const payload = {
      name: elements.supplierContactName.value.trim(),
      email: elements.supplierContactEmail.value.trim(),
      phone: elements.supplierContactPhone.value.trim() || null,
      position: elements.supplierContactPosition.value.trim() || null,
      isPrimary: elements.supplierContactIsPrimary.checked,
    };
    try {
      ensure(payload.name.length > 1, 'Indique um nome para o contato.');
      ensure(payload.email.includes('@'), 'Indique um e-mail valido para o contato.');
      const id = elements.supplierContactId.value;
      await request(
        id
          ? `${API_BASE}/suppliers/${state.selectedSupplierId}/contacts/${id}`
          : `${API_BASE}/suppliers/${state.selectedSupplierId}/contacts`,
        {
          method: id ? 'PUT' : 'POST',
          body: JSON.stringify(payload),
        },
      );
      resetSupplierContactForm();
      await loadSupplierContacts(state.selectedSupplierId);
      // Atualiza tambem o cache local para reflet ir imediato na listagem
      // sem precisar de um loadData completo (que recarrega tudo).
      state.supplierContacts[state.selectedSupplierId] =
        state.supplierContacts[state.selectedSupplierId] ?? [];
      const cachedList = state.supplierContacts[state.selectedSupplierId];
      if (id) {
        const idx = cachedList.findIndex((c) => String(c.id) === String(id));
        if (idx >= 0) {
          cachedList[idx] = {
            ...cachedList[idx],
            name: payload.name,
            email: payload.email,
            phone: payload.phone,
            position: payload.position,
            isPrimary: payload.isPrimary,
          };
        }
      } else {
        // contato novo: recarregamos a lista do servidor ja acima
      }
      renderSuppliers();
      setFeedback('Contato guardado com sucesso.');
    } catch (error) {
      setFeedback(error.message, true);
    }
  });
}

if (elements.quoteRequestAttachmentForm) {
  elements.quoteRequestAttachmentForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!state.selectedQuoteRequestId) {
      setFeedback('Guarde ou selecione uma cotacao antes de adicionar anexos.', true);
      return;
    }
    const file = elements.quoteRequestAttachmentFile.files?.[0];
    if (!file) {
      setFeedback('Selecione um arquivo para enviar.', true);
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setFeedback('Arquivo excede o limite de 5MB.', true);
      return;
    }
    try {
      const data = await readFileAsBase64(file);
      await request(`${API_BASE}/quote-requests/${state.selectedQuoteRequestId}/attachments`, {
        method: 'POST',
        body: JSON.stringify({
          filename: file.name,
          mimeType: file.type || 'application/octet-stream',
          base64: data,
        }),
      });
      elements.quoteRequestAttachmentForm.reset();
      await loadQuoteRequestAttachments(state.selectedQuoteRequestId);
      setFeedback('Anexo adicionado com sucesso.');
    } catch (error) {
      setFeedback(error.message, true);
    }
  });
}

if (elements.quoteResponseAttachmentForm) {
  elements.quoteResponseAttachmentForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!state.selectedQuoteResponseId) {
      setFeedback('Guarde ou selecione uma proposta antes de adicionar anexos.', true);
      return;
    }
    const file = elements.quoteResponseAttachmentFile.files?.[0];
    if (!file) {
      setFeedback('Selecione um arquivo para enviar.', true);
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setFeedback('Arquivo excede o limite de 5MB.', true);
      return;
    }
    try {
      const data = await readFileAsBase64(file);
      await request(`${API_BASE}/quote-responses/${state.selectedQuoteResponseId}/attachments`, {
        method: 'POST',
        body: JSON.stringify({
          filename: file.name,
          mimeType: file.type || 'application/octet-stream',
          base64: data,
        }),
      });
      elements.quoteResponseAttachmentForm.reset();
      await loadQuoteResponseAttachments(state.selectedQuoteResponseId);
      setFeedback('Anexo adicionado com sucesso.');
    } catch (error) {
      setFeedback(error.message, true);
    }
  });
}

if (elements.userForm) {
  elements.userForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = {
      name: elements.userName.value.trim(),
      email: elements.userEmail.value.trim(),
      role: elements.userRole.value,
      isActive: elements.userActive.checked,
    };
    if (elements.userPassword.value) {
      payload.password = elements.userPassword.value;
    }
    try {
      ensure(payload.name.length > 1, 'Indique um nome para o usuario.');
      ensure(payload.email.includes('@'), 'Indique um e-mail valido.');
      const id = elements.userId.value;
      if (id) {
        await request(`${AUTH_API_BASE}/users/${id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
      } else {
        ensure((payload.password ?? '').length >= 8, 'A senha deve ter pelo menos 8 caracteres.');
        await request(`${AUTH_API_BASE}/users`, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
      resetUserForm();
      await loadUsers();
      setFeedback('Usuario guardado com sucesso.');
    } catch (error) {
      setFeedback(error.message, true);
    }
  });
}

if (elements.userTokensRefresh) {
  elements.userTokensRefresh.addEventListener('click', () => loadRecoveryTokens());
}

if (elements.companyProfileForm) {
  elements.companyProfileForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = {
      companyName: elements.companyProfileName.value.trim(),
      tradeName: elements.companyProfileTradeName.value.trim() || null,
      taxId: elements.companyProfileTaxId.value.trim() || null,
      purchasingEmail: elements.companyProfilePurchasingEmail.value.trim() || null,
      purchasingPhone: elements.companyProfilePurchasingPhone.value.trim() || null,
      website: elements.companyProfileWebsite.value.trim() || null,
      addressLine1: elements.companyProfileAddress1.value.trim() || null,
      addressLine2: elements.companyProfileAddress2.value.trim() || null,
      city: elements.companyProfileCity.value.trim() || null,
      state: elements.companyProfileState.value.trim() || null,
      postalCode: elements.companyProfilePostalCode.value.trim() || null,
      country: elements.companyProfileCountry.value.trim() || null,
      logoUrl: elements.companyProfileLogoUrl.value.trim() || null,
    };
    try {
      ensure(payload.companyName.length > 1, 'Indique a razao social.');
      ensure(
        payload.purchasingEmail && payload.purchasingEmail.includes('@'),
        'Indique um e-mail de compras valido.',
      );
      await request(`${API_BASE}/company-profile`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      elements.companyProfileFeedback.textContent = 'Perfil atualizado com sucesso.';
      elements.companyProfileFeedback.classList.remove('error');
    } catch (error) {
      elements.companyProfileFeedback.textContent = error.message;
      elements.companyProfileFeedback.classList.add('error');
    }
  });
}

if (elements.helpSearch) {
  elements.helpSearch.addEventListener('input', () => loadHelpArticles());
  elements.helpFilterCategory.addEventListener('change', () => loadHelpArticles());
}

async function loadCompanyProfile() {
  if (!elements.companyProfileForm) return;
  try {
    const profile = await request(`${API_BASE}/company-profile`);
    elements.companyProfileName.value = profile.companyName ?? '';
    elements.companyProfileTradeName.value = profile.tradeName ?? '';
    elements.companyProfileTaxId.value = profile.taxId ?? '';
    elements.companyProfilePurchasingEmail.value = profile.purchasingEmail ?? '';
    elements.companyProfilePurchasingPhone.value = profile.purchasingPhone ?? '';
    elements.companyProfileWebsite.value = profile.website ?? '';
    elements.companyProfileAddress1.value = profile.addressLine1 ?? '';
    elements.companyProfileAddress2.value = profile.addressLine2 ?? '';
    elements.companyProfileCity.value = profile.city ?? '';
    elements.companyProfileState.value = profile.state ?? '';
    elements.companyProfilePostalCode.value = profile.postalCode ?? '';
    elements.companyProfileCountry.value = profile.country ?? '';
    elements.companyProfileLogoUrl.value = profile.logoUrl ?? '';
  } catch (error) {
    setFeedback(error.message, true);
  }
}

if (elements.reportRefresh) {
  elements.reportRefresh.addEventListener('click', () => loadReports(true));
}

if (elements.wizardPrev) {
  elements.wizardPrev.addEventListener('click', () => showWizardStep(state.wizardStep - 1));
  elements.wizardNext.addEventListener('click', () => showWizardStep(state.wizardStep + 1));
}

if (elements.onboardingDismiss) {
  elements.onboardingDismiss.addEventListener('click', () => {
    state.onboardingDismissed = true;
    elements.onboardingPanel.classList.add('hidden');
  });
}

if (elements.forgotPasswordButton) {
  elements.forgotPasswordButton.addEventListener('click', () => {
    elements.loginForm.classList.add('hidden');
    elements.forgotPasswordForm.classList.remove('hidden');
    elements.resetPasswordForm.classList.add('hidden');
    clearAuthFeedback();
  });
}

if (elements.forgotCancelButton) {
  elements.forgotCancelButton.addEventListener('click', () => {
    elements.forgotPasswordForm.classList.add('hidden');
    elements.resetPasswordForm.classList.add('hidden');
    elements.loginForm.classList.remove('hidden');
    clearAuthFeedback();
  });
}

if (elements.resetCancelButton) {
  elements.resetCancelButton.addEventListener('click', () => {
    elements.resetPasswordForm.classList.add('hidden');
    elements.forgotPasswordForm.classList.add('hidden');
    elements.loginForm.classList.remove('hidden');
    clearAuthFeedback();
  });
}

if (elements.forgotPasswordForm) {
  elements.forgotPasswordForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearAuthFeedback();
    try {
      const response = await request(`${AUTH_API_BASE}/forgot-password`, {
        method: 'POST',
        body: JSON.stringify({ email: elements.forgotEmail.value.trim() }),
      });
      let message = response?.message || 'Se o e-mail existir, um link sera enviado.';
      if (response?.devToken) {
        message += ` Token de desenvolvimento: ${response.devToken}`;
      }
      setAuthFeedback(message, false);
    } catch (error) {
      setAuthFeedback(error.message, true);
    }
  });
}

if (elements.resetPasswordForm) {
  elements.resetPasswordForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearAuthFeedback();
    try {
      ensure(elements.resetPassword.value.length >= 8, 'A senha deve ter pelo menos 8 caracteres.');
      const response = await request(`${AUTH_API_BASE}/reset-password`, {
        method: 'POST',
        body: JSON.stringify({
          token: elements.resetToken.value.trim(),
          password: elements.resetPassword.value,
        }),
      });
      setAuthFeedback(response?.message || 'Senha redefinida com sucesso.', false);
      elements.resetPasswordForm.classList.add('hidden');
      elements.loginForm.classList.remove('hidden');
      elements.resetPasswordForm.reset();
    } catch (error) {
      setAuthFeedback(error.message, true);
    }
  });
}

if (elements.weightPrice) {
  ['input', 'change'].forEach((evt) => {
    elements.weightPrice.addEventListener(evt, validateWeights);
    elements.weightPayment.addEventListener(evt, validateWeights);
    elements.weightIncoterm.addEventListener(evt, validateWeights);
  });
}

if (elements.reportFrom) {
  elements.reportFrom.addEventListener('change', () => {
    loadFiltersFromInputs();
    loadReports();
  });
  elements.reportTo.addEventListener('change', () => {
    loadFiltersFromInputs();
    loadReports();
  });
}

// click-on-row to focus a supplier/quote/response
elements.suppliersBody.addEventListener('click', (event) => {
  if (event.target.closest('button')) {
    return;
  }
  const row = event.target.closest('[data-supplier-row]');
  if (!row) {
    return;
  }
  const id = Number(row.dataset.supplierRow);
  state.selectedSupplierId = id;
  void loadSupplierContacts(id);
});
elements.quoteRequestsBody.addEventListener('click', (event) => {
  if (event.target.closest('button')) {
    return;
  }
  const row = event.target.closest('tr');
  if (!row) {
    return;
  }
  const id = Number(row.querySelector('button')?.getAttribute('onclick')?.match(/(\d+)/)?.[1]);
  if (id) {
    state.selectedQuoteRequestId = id;
    void loadQuoteRequestAttachments(id);
  }
});

elements.compareButton.addEventListener('click', async () => {
  const quoteRequestId = elements.comparisonQuoteRequest.value;

  if (!quoteRequestId) {
    setFeedback('Seleccione uma cotacao para comparar.', true);
    return;
  }

  try {
    const results = await request(`${API_BASE}/quote-requests/${quoteRequestId}/compare`, {
      method: 'POST',
    });

    state.selectedComparisonQuoteRequestId = quoteRequestId;
    setActiveTab('comparison');
    renderComparison(results);
    await loadData();
    await loadSelectedComparisonHistory();
    setFeedback('Comparacao executada, vencedora definida e cotacao fechada.');
  } catch (error) {
    if (isForbiddenError(error)) {
      setFeedback('O seu perfil nao tem permissao para comparar propostas.', true);
      return;
    }

    setFeedback(error.message, true);
  }
});

elements.exportComparisonButton.addEventListener('click', exportComparisonCsv);
elements.comparisonQuoteRequest.addEventListener('change', async (event) => {
  state.selectedComparisonQuoteRequestId = event.target.value;
  await loadSelectedComparisonHistory();
});

elements.supplierSearch.addEventListener('input', (event) => {
  state.filters.supplierSearch = event.target.value.trim();
  resetPage('suppliers');
  renderSuppliers();
});

elements.quoteRequestSearch.addEventListener('input', (event) => {
  state.filters.quoteRequestSearch = event.target.value.trim();
  resetPage('quoteRequests');
  renderQuoteRequests();
});

elements.quoteRequestFilterStatus.addEventListener('change', (event) => {
  state.filters.quoteRequestStatus = event.target.value;
  resetPage('quoteRequests');
  renderQuoteRequests();
});

elements.quoteItemSearch.addEventListener('input', (event) => {
  state.filters.quoteRequestItemSearch = event.target.value.trim();
  resetPage('quoteRequestItems');
  renderQuoteRequestItems();
});

elements.quoteItemFilterQuoteRequest.addEventListener('change', (event) => {
  state.filters.quoteRequestItemQuoteRequestId = event.target.value;
  resetPage('quoteRequestItems');
  renderQuoteRequestItems();
});

elements.quoteResponseSearch.addEventListener('input', (event) => {
  state.filters.quoteResponseSearch = event.target.value.trim();
  resetPage('quoteResponses');
  renderQuoteResponses();
});

elements.quoteResponseFilterWinner.addEventListener('change', (event) => {
  state.filters.quoteResponseWinner = event.target.value;
  resetPage('quoteResponses');
  renderQuoteResponses();
});

elements.responseQuoteRequest.addEventListener('change', () => {
  syncResponseCurrencyFromQuoteRequest();
});

elements.auditEntityType.addEventListener('change', async () => {
  setAuditFilterState();
  await loadAuditLogs();
});

elements.auditAction.addEventListener('change', async () => {
  setAuditFilterState();
  await loadAuditLogs();
});

elements.auditEntityId.addEventListener('input', async () => {
  setAuditFilterState();
  await loadAuditLogs();
});

elements.auditRefreshButton.addEventListener('click', async () => {
  setAuditFilterState();
  await loadAuditLogs(true);
});

window.changePage = (key, page) => {
  state.pagination[key] = page;
  if (key === 'suppliers') {
    renderSuppliers();
    return;
  }

  if (key === 'quoteRequests') {
    renderQuoteRequests();
    return;
  }

  if (key === 'quoteRequestItems') {
    renderQuoteRequestItems();
    return;
  }

  renderQuoteResponses();
};

function showModal(title, bodyHtml, actions = []) {
  const root = document.getElementById('modal-root');
  if (!root) return;
  root.innerHTML = `
    <div class="modal-backdrop" data-modal-backdrop>
      <div class="modal-card" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
        <header class="modal-head">
          <h2>${escapeHtml(title)}</h2>
          <button type="button" class="ghost-button" data-modal-close>Fechar</button>
        </header>
        <div class="modal-body">${bodyHtml}</div>
        <footer class="modal-foot">${actions.join(' ')}</footer>
      </div>
    </div>`;
  const close = () => {
    root.innerHTML = '';
  };
  root.querySelector('[data-modal-close]')?.addEventListener('click', close);
  root.querySelector('[data-modal-backdrop]')?.addEventListener('click', (event) => {
    if (event.target.matches('[data-modal-backdrop]')) close();
  });
  return { root, close };
}

function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

window.openDispatchModal = async (quoteRequestId) => {
  if (!canManageQuoteRequests()) {
    setFeedback('O seu perfil nao tem permissao para enviar cotacoes.', true);
    return;
  }
  const qr = state.quoteRequests.find((item) => item.id === quoteRequestId);
  if (!qr) return;

  // Garante que todos os contatos dos fornecedores ativos estao carregados
  // antes de abrir o modal. Se algum supplierContacts[id] estiver faltando,
  // busca agora. Tambem dispara o bulk para preencher varios de uma vez.
  const activeSuppliers = state.suppliers.filter((s) => s.status === 'active');
  const missing = activeSuppliers.filter((s) => !state.supplierContacts[s.id]);
  if (missing.length > 0) {
    try {
      const ids = missing.map((s) => s.id).join(',');
      const bulk = await request(`${API_BASE}/supplier-contacts?supplierIds=${ids}`);
      state.supplierContacts = { ...state.supplierContacts, ...(bulk.bySupplier ?? {}) };
    } catch (error) {
      // Fallback: carrega um por um
      await Promise.all(missing.map((s) => loadSupplierContacts(s.id)));
    }
  }

  const supplierOptions = activeSuppliers
    .map((s) => {
      const contactOptions = (state.supplierContacts[s.id] || [])
        .map(
          (c) => `<label class="checkbox-row">
              <input type="checkbox" name="dispatch-contact" value="${c.id}" data-supplier-id="${s.id}" data-supplier-name="${escapeHtml(s.name)}" data-contact-name="${escapeHtml(c.name)}" data-contact-email="${escapeHtml(c.email)}" />
              <span>${escapeHtml(c.name)} &lt;${escapeHtml(c.email)}&gt;</span>
            </label>`,
        )
        .join('');
      const missingContactHint = !contactOptions
        ? '<p class="feedback error">Cadastre ao menos um contato antes de enviar.</p>'
        : '';
      return `
        <fieldset class="dispatch-supplier" data-supplier-name="${escapeHtml(s.name).toLowerCase()}">
          <legend>${escapeHtml(s.name)}</legend>
          ${contactOptions || missingContactHint}
        </fieldset>`;
    })
    .join('');

  const body = `
    <p class="feedback">
      Enviaremos um e-mail individual para cada contato selecionado com um link
      exclusivo para a cotacao <strong>${escapeHtml(qr.requestCode || `#${qr.id}`)}</strong>.
      Nenhum fornecedor tera visibilidade dos demais destinatarios.
    </p>
    <div class="form-grid">
      <label>Assunto (opcional)
        <input type="text" id="dispatch-subject" placeholder="Sourcing request ${escapeHtml(qr.requestCode || '#' + qr.id)}" />
      </label>
      <label>Validade do link (dias)
        <input type="number" id="dispatch-expires" min="1" max="60" value="14" />
      </label>
      <label class="full">Mensagem adicional (opcional)
        <textarea id="dispatch-message" rows="3" placeholder="Contexto extra para o fornecedor"></textarea>
      </label>
    </div>
    <div class="dispatch-toolbar">
      <input type="search" id="dispatch-search" placeholder="Filtrar por fornecedor ou contato..." autocomplete="off" />
      <span class="chip neutral" id="dispatch-selected-count">0 selecionados</span>
      <button type="button" class="ghost-button" id="dispatch-select-all">Selecionar todos visiveis</button>
      <button type="button" class="ghost-button" id="dispatch-clear">Limpar</button>
    </div>
    <h3 style="margin-top:18px;color:var(--accent,#00ae91);">Destinatarios</h3>
    <div id="dispatch-recipients" class="dispatch-list">${supplierOptions || '<p class="feedback">Cadastre fornecedores ativos com contatos para enviar.</p>'}</div>`;

  const actions = [
    `<button type="button" class="ghost-button" data-modal-close>Cancelar</button>`,
    `<button type="button" class="primary-button" id="dispatch-confirm">Enviar agora</button>`,
  ];

  const modal = showModal(`Enviar cotacao ${qr.requestCode || '#' + qr.id}`, body, actions);
  if (!modal) return;

  const root = modal.root;
  const search = root.querySelector('#dispatch-search');
  const counter = root.querySelector('#dispatch-selected-count');
  const fieldsets = Array.from(root.querySelectorAll('.dispatch-supplier'));

  function updateCounter() {
    const total = root.querySelectorAll('input[name="dispatch-contact"]:checked').length;
    if (counter) counter.textContent = `${total} selecionado(s)`;
  }

  function applyFilter() {
    const term = (search?.value || '').toLowerCase().trim();
    fieldsets.forEach((fs) => {
      const supplierName = fs.getAttribute('data-supplier-name') ?? '';
      const labels = Array.from(fs.querySelectorAll('label'));
      let anyVisible = false;
      labels.forEach((label) => {
        const text = label.textContent.toLowerCase();
        const matches = !term || text.includes(term) || supplierName.includes(term);
        label.style.display = matches ? '' : 'none';
        if (matches) anyVisible = true;
      });
      fs.style.display = term ? (anyVisible ? '' : 'none') : '';
    });
  }

  search?.addEventListener('input', applyFilter);
  root.addEventListener('change', (ev) => {
    if (ev.target && ev.target.matches('input[name="dispatch-contact"]')) updateCounter();
  });
  root.querySelector('#dispatch-select-all')?.addEventListener('click', () => {
    root.querySelectorAll('input[name="dispatch-contact"]').forEach((cb) => {
      if (cb.closest('label')?.style.display !== 'none' && cb.closest('fieldset')?.style.display !== 'none') {
        cb.checked = true;
      }
    });
    updateCounter();
  });
  root.querySelector('#dispatch-clear')?.addEventListener('click', () => {
    root.querySelectorAll('input[name="dispatch-contact"]').forEach((cb) => { cb.checked = false; });
    updateCounter();
  });
  updateCounter();

  const confirm = root.querySelector('#dispatch-confirm');
  confirm?.addEventListener('click', async () => {
    const selected = Array.from(
      modal.root.querySelectorAll('input[name="dispatch-contact"]:checked'),
    ).map((el) => ({
      id: Number(el.value),
      supplierId: Number(el.getAttribute('data-supplier-id')),
      supplierName: el.getAttribute('data-supplier-name'),
      contactName: el.getAttribute('data-contact-name'),
      contactEmail: el.getAttribute('data-contact-email'),
    }));
    if (selected.length === 0) {
      setFeedback('Selecione ao menos um destinatario.', true);
      return;
    }
    const subject = modal.root.querySelector('#dispatch-subject').value.trim();
    const message = modal.root.querySelector('#dispatch-message').value.trim();
    const expiresInDays = Number(modal.root.querySelector('#dispatch-expires').value || 14);
    confirm.disabled = true;
    setFeedback('Enviando e-mails aos fornecedores...');
    try {
      const preview = await request(`${API_BASE}/quote-requests/${quoteRequestId}/dispatch/preview`, {
        method: 'POST',
        body: JSON.stringify({ recipientContactIds: selected.map((s) => s.id) }),
      });
      const proceed = window.confirm(
        `Confirma o envio para ${preview.recipientCount} contato(s)?\n` +
          `Assunto: ${preview.preview?.subject || '(padrao)'}\n` +
          `CC: ${preview.cc?.length ? preview.cc.map((c) => c.email).join(', ') : 'nenhum'}`,
      );
      if (!proceed) {
        confirm.disabled = false;
        return;
      }
      const result = await request(`${API_BASE}/quote-requests/${quoteRequestId}/dispatch`, {
        method: 'POST',
        body: JSON.stringify({
          recipientContactIds: selected.map((s) => s.id),
          subject: subject || undefined,
          message: message || undefined,
          expiresInDays,
        }),
      });
      modal.close();
      setFeedback(
        `Envio concluido: ${result.sentCount} sucesso, ${result.failedCount} falha(s).`,
        result.failedCount > 0,
      );
    } catch (error) {
      confirm.disabled = false;
      setFeedback(error.message, true);
    }
  });
};

window.showDispatchHistory = async (quoteRequestId) => {
  try {
    const events = await request(`${API_BASE}/quote-requests/${quoteRequestId}/dispatches`);
    if (!events.length) {
      showModal('Envios da cotacao', '<p class="feedback">Nenhum envio registrado ate o momento.</p>');
      return;
    }
    const rows = events
      .map((event) => {
        const tokens = event.tokens
          .map((token) => {
            const status = token.revokedAt
              ? 'Revogado'
              : token.respondedAt
                ? 'Respondido'
                : new Date(token.expiresAt).getTime() < Date.now()
                  ? 'Expirado'
                  : 'Pendente';
            const sent = token.response
              ? `Proposta ${escapeHtml(token.response.totalPrice)} ${escapeHtml(token.response.totalPriceCurrency || '')}`
              : '-';
            return `<tr>
              <td>${escapeHtml(token.supplier?.name || '-')}</td>
              <td>${escapeHtml(token.contact?.name || '-')}<div class="table-subtle">${escapeHtml(token.contact?.email || '')}</div></td>
              <td>${escapeHtml(status)}</td>
              <td>${escapeHtml(formatDate(token.lastSeenAt) || '-')}</td>
              <td>${escapeHtml(sent)}</td>
              <td>
                ${
                  !token.revokedAt && !token.respondedAt
                    ? `<button class="table-button" type="button" data-revoke-token="${token.id}">Revogar</button>`
                    : '-'
                }
              </td>
            </tr>`;
          })
          .join('');
        return `
          <section class="panel" style="margin-bottom:12px;">
            <div class="panel-heading">
              <div>
                <p class="section-tag">${escapeHtml(new Date(event.createdAt).toLocaleString())}</p>
                <h3>${escapeHtml(event.subject)}</h3>
              </div>
              <span class="chip">${escapeHtml(event.status)}</span>
            </div>
            <p class="feedback">${event.recipientsCount} destinatarios &middot; CC: ${escapeHtml(event.ccList || 'nenhum')}</p>
            <table class="data-table">
              <thead>
                <tr>
                  <th>Fornecedor</th><th>Contato</th><th>Estado</th><th>Visto</th><th>Proposta</th><th>Acoes</th>
                </tr>
              </thead>
              <tbody>${tokens}</tbody>
            </table>
          </section>`;
      })
      .join('');
    const modal = showModal('Historico de envios', rows);
    modal?.root.querySelectorAll('[data-revoke-token]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-revoke-token');
        btn.disabled = true;
        try {
          await request(`${API_BASE}/portal-tokens/${id}/revoke`, { method: 'POST' });
          await window.showDispatchHistory(quoteRequestId);
        } catch (error) {
          setFeedback(error.message, true);
        }
      });
    });
  } catch (error) {
    setFeedback(error.message, true);
  }
};

window.editSupplier = (id) => {
  if (!canManageSuppliers()) {
    setFeedback('O seu perfil nao tem permissao para editar fornecedores.', true);
    return;
  }

  const supplier = state.suppliers.find((item) => item.id === id);

  if (!supplier) {
    return;
  }

  elements.supplierId.value = String(supplier.id);
  elements.supplierName.value = supplier.name;
  elements.supplierEmail.value = supplier.email;
  elements.supplierWebsite.value = supplier.website ?? '';
  elements.supplierCountry.value = supplier.country ?? '';
  elements.supplierStatus.value = supplier.status ?? 'active';
  elements.supplierNotes.value = supplier.notes ?? '';
  Array.from(elements.supplierIncoterms.options).forEach((option) => {
    option.selected = supplier.acceptedIncoterms.includes(option.value);
  });
  elements.supplierCancel.classList.remove('hidden');
  state.selectedSupplierId = supplier.id;
  void loadSupplierContacts(supplier.id);
  setActiveTab('suppliers');
  window.scrollTo({
    top: elements.supplierForm.closest('.panel').offsetTop - 18,
    behavior: 'smooth',
  });
};

window.deleteSupplier = async (id) => {
  if (!canDeleteSuppliers()) {
    setFeedback('O seu perfil nao tem permissao para apagar fornecedores.', true);
    return;
  }

  if (!window.confirm('Pretende apagar este fornecedor?')) {
    return;
  }

  try {
    await request(`${API_BASE}/suppliers/${id}`, { method: 'DELETE' });
    await loadData();
    setFeedback('Fornecedor apagado.');
  } catch (error) {
    setFeedback(error.message, true);
  }
};

window.editQuoteRequest = (id) => {
  if (!canManageQuoteRequests()) {
    setFeedback('O seu perfil nao tem permissao para editar cotacoes.', true);
    return;
  }

  const quoteRequest = state.quoteRequests.find((item) => item.id === id);

  if (!quoteRequest) {
    return;
  }

  elements.quoteRequestId.value = String(quoteRequest.id);
  elements.quoteRequestCode.value = quoteRequest.requestCode ?? '';
  elements.quoteProductName.value = quoteRequest.productName;
  elements.quoteQuantity.value = String(quoteRequest.quantity);
  elements.quoteDesiredIncoterm.value = quoteRequest.desiredIncoterm;
  elements.quoteCurrency.value = quoteRequest.currency ?? 'USD';
  elements.quoteDeadline.value = quoteRequest.deadlineAt ? String(quoteRequest.deadlineAt).slice(0, 10) : '';
  elements.quoteDescription.value = quoteRequest.description ?? '';
  elements.quoteRequestCancel.classList.remove('hidden');
  state.selectedQuoteRequestId = quoteRequest.id;
  void loadQuoteRequestAttachments(quoteRequest.id);
  setActiveTab('quotes');
  window.scrollTo({
    top: elements.quoteRequestForm.closest('.panel').offsetTop - 18,
    behavior: 'smooth',
  });
};

window.closeQuoteRequest = async (id) => {
  if (!canManageQuoteState()) {
    setFeedback('O seu perfil nao tem permissao para fechar cotacoes.', true);
    return;
  }

  if (!window.confirm('Pretende fechar esta cotacao?')) {
    return;
  }

  try {
    await request(`${API_BASE}/quote-requests/${id}/close`, { method: 'POST' });
    await loadData();
    setActiveTab('quotes');
    setFeedback('Cotacao fechada com sucesso.');
  } catch (error) {
    setFeedback(error.message, true);
  }
};

window.reopenQuoteRequest = async (id) => {
  if (!canManageQuoteState()) {
    setFeedback('O seu perfil nao tem permissao para reabrir cotacoes.', true);
    return;
  }

  if (!window.confirm('Pretende reabrir esta cotacao? A vencedora atual sera limpa.')) {
    return;
  }

  try {
    await request(`${API_BASE}/quote-requests/${id}/reopen`, { method: 'POST' });
    await loadData();
    setActiveTab('quotes');
    setFeedback('Cotacao reaberta com sucesso.');
  } catch (error) {
    setFeedback(error.message, true);
  }
};

window.deleteQuoteRequest = async (id) => {
  if (!canDeleteQuoteRequests()) {
    setFeedback('O seu perfil nao tem permissao para apagar cotacoes.', true);
    return;
  }

  if (!window.confirm('Pretende apagar esta cotacao? Todas as propostas associadas tambem serao removidas.')) {
    return;
  }

  try {
    await request(`${API_BASE}/quote-requests/${id}`, { method: 'DELETE' });
    await loadData();
    setFeedback('Cotacao apagada.');
  } catch (error) {
    setFeedback(error.message, true);
  }
};

window.editQuoteRequestItem = (id) => {
  if (!canManageQuoteItems()) {
    setFeedback('O seu perfil nao tem permissao para editar itens.', true);
    return;
  }

  const item = state.quoteRequestItems.find((entry) => entry.id === id);
  const quoteRequest = state.quoteRequests.find(
    (entry) => entry.id === item?.quoteRequestId,
  );

  if (!item) {
    return;
  }

  ensureOptionExists(
    elements.quoteItemQuoteRequest,
    String(item.quoteRequestId),
    quoteRequest
      ? formatQuoteRequestLabel(quoteRequest)
      : `Cotacao #${item.quoteRequestId}`,
  );
  elements.quoteItemId.value = String(item.id);
  elements.quoteItemQuoteRequest.value = String(item.quoteRequestId);
  elements.quoteItemCode.value = item.itemCode ?? '';
  elements.quoteItemProductName.value = item.productName;
  elements.quoteItemQuantity.value = String(item.quantity);
  elements.quoteItemUnit.value = item.unit;
  elements.quoteItemTargetPrice.value = item.targetPrice ? String(item.targetPrice) : '';
  elements.quoteItemDescription.value = item.description ?? '';
  elements.quoteItemNotes.value = item.notes ?? '';
  elements.quoteItemCancel.classList.remove('hidden');
  setActiveTab('items');
  window.scrollTo({
    top: elements.quoteItemForm.closest('.panel').offsetTop - 18,
    behavior: 'smooth',
  });
};

window.deleteQuoteRequestItem = async (id) => {
  if (!canManageQuoteItems()) {
    setFeedback('O seu perfil nao tem permissao para apagar itens.', true);
    return;
  }

  if (!window.confirm('Pretende apagar este item da cotacao?')) {
    return;
  }

  try {
    await request(`${API_BASE}/quote-request-items/${id}`, { method: 'DELETE' });
    await loadData();
    setActiveTab('items');
    setFeedback('Item apagado.');
  } catch (error) {
    setFeedback(error.message, true);
  }
};

window.editQuoteResponse = (id) => {
  if (!canManageQuoteResponses()) {
    setFeedback('O seu perfil nao tem permissao para editar propostas.', true);
    return;
  }

  const quoteResponse = state.quoteResponses.find((item) => item.id === id);
  const quoteRequest = state.quoteRequests.find(
    (item) => item.id === quoteResponse?.quoteRequestId,
  );

  if (!quoteResponse) {
    return;
  }

  elements.quoteResponseId.value = String(quoteResponse.id);
  ensureOptionExists(
    elements.responseQuoteRequest,
    String(quoteResponse.quoteRequestId),
    quoteRequest
      ? formatQuoteRequestLabel(quoteRequest)
      : `Cotacao #${quoteResponse.quoteRequestId}`,
  );
  elements.responseQuoteRequest.value = String(quoteResponse.quoteRequestId);
  elements.responseSupplier.value = String(quoteResponse.supplierId);
  elements.responsePrice.value = String(quoteResponse.offeredPrice);
  elements.responseCurrency.value = quoteResponse.currency ?? 'USD';
  elements.responseExchangeRate.value =
    quoteResponse.exchangeRate !== undefined && quoteResponse.exchangeRate !== null
      ? String(quoteResponse.exchangeRate)
      : '';
  elements.responseFreightCost.value = String(quoteResponse.freightCost ?? 0);
  elements.responseInsuranceCost.value = String(quoteResponse.insuranceCost ?? 0);
  elements.responseOtherFees.value = String(quoteResponse.otherFees ?? 0);
  elements.responseImportDuty.value = String(quoteResponse.importDuty ?? 0);
  elements.responseIpi.value = String(quoteResponse.ipi ?? 0);
  elements.responsePis.value = String(quoteResponse.pis ?? 0);
  elements.responseCofins.value = String(quoteResponse.cofins ?? 0);
  elements.responseIncoterm.value = quoteResponse.offeredIncoterm;
  elements.responsePaymentTerms.value = String(quoteResponse.paymentTermsDays);
  if (elements.responseNotes) {
    elements.responseNotes.value = quoteResponse.notes ?? '';
  }
  elements.quoteResponseCancel.classList.remove('hidden');
  state.selectedQuoteResponseId = quoteResponse.id;
  void loadQuoteResponseAttachments(quoteResponse.id);
  showWizardStep(1);
  setActiveTab('responses');
  window.scrollTo({
    top: elements.quoteResponseForm.closest('.panel').offsetTop - 18,
    behavior: 'smooth',
  });
};

window.deleteQuoteResponse = async (id) => {
  if (!canManageQuoteResponses()) {
    setFeedback('O seu perfil nao tem permissao para apagar propostas.', true);
    return;
  }

  if (!window.confirm('Pretende apagar esta proposta?')) {
    return;
  }

  try {
    await request(`${API_BASE}/quote-responses/${id}`, { method: 'DELETE' });
    await loadData();
    setFeedback('Proposta apagada.');
  } catch (error) {
    setFeedback(error.message, true);
  }
};

// ===== Feedback-driven modules =====

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const idx = result.indexOf(',');
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = () => reject(new Error('Falha ao ler o arquivo.'));
    reader.readAsDataURL(file);
  });
}

function showWizardStep(step) {
  const next = Math.min(Math.max(step, 1), 4);
  state.wizardStep = next;
  elements.wizardSteps.forEach((li) => {
    li.classList.toggle('active', Number(li.dataset.wizardStep) === next);
    li.classList.toggle('done', Number(li.dataset.wizardStep) < next);
  });
  elements.wizardPanes.forEach((pane) => {
    pane.classList.toggle('hidden', Number(pane.dataset.wizardPane) !== next);
  });
  elements.wizardPrev.disabled = next === 1;
  elements.wizardNext.classList.toggle('hidden', next === 4);
  elements.wizardSubmit.classList.toggle('hidden', next !== 4);
}

function validateWeights() {
  if (!elements.weightPrice) {
    return { valid: true, total: 0 };
  }
  const price = Number(elements.weightPrice.value || 0);
  const payment = Number(elements.weightPayment.value || 0);
  const incoterm = Number(elements.weightIncoterm.value || 0);
  const total = price + payment + incoterm;
  if (total === 100) {
    elements.weightsWarning.classList.add('hidden');
    elements.weightsWarning.textContent = '';
    return { valid: true, total };
  }
  elements.weightsWarning.classList.remove('hidden');
  elements.weightsWarning.textContent = `A soma dos pesos deve ser 100 (atual: ${total}).`;
  return { valid: false, total };
}

function updateOnboardingSteps() {
  if (!elements.onboardingSteps) {
    return;
  }
  const steps = [
    {
      title: '1. Cadastre um fornecedor',
      done: state.suppliers.length > 0,
      action: 'suppliers',
    },
    {
      title: '2. Crie uma cotacao',
      done: state.quoteRequests.length > 0,
      action: 'quotes',
    },
    {
      title: '3. Registre uma proposta',
      done: state.quoteResponses.length > 0,
      action: 'responses',
    },
    {
      title: '4. Compare as propostas e defina a vencedora',
      done: state.quoteResponses.some((r) => r.isWinner),
      action: 'comparison',
    },
  ];
  elements.onboardingSteps.innerHTML = steps
    .map(
      (step) => `
        <li>
          <span class="chip ${step.done ? 'winner' : 'neutral'}">${step.done ? 'Concluido' : 'Pendente'}</span>
          <button class="link-button" type="button" data-onboarding-target="${step.action}">${step.title}</button>
        </li>
      `,
    )
    .join('');
  elements.onboardingSteps.querySelectorAll('[data-onboarding-target]').forEach((button) => {
    button.addEventListener('click', () => setActiveTab(button.dataset.onboardingTarget));
  });
  elements.onboardingPanel.classList.toggle('hidden', state.onboardingDismissed);
}

async function loadSupplierContacts(supplierId) {
  if (!supplierId) {
    return;
  }
  state.selectedSupplierId = supplierId;
  try {
    const contacts = await request(`${API_BASE}/suppliers/${supplierId}/contacts`);
    state.supplierContacts[supplierId] = contacts;
    renderSupplierContacts(supplierId);
    // Re-renderiza a tabela de fornecedores para que o chip "contato principal"
    // apareca na listagem (chamada inicial apos refresh do navegador).
    renderSuppliers();
  } catch (error) {
    setFeedback(error.message, true);
  }
}

function renderSupplierContacts(supplierId) {
  if (!elements.supplierContactsBody) {
    return;
  }
  const contacts = state.supplierContacts[supplierId] ?? [];
  elements.supplierContactsBody.innerHTML = contacts.length
    ? contacts
        .map(
          (contact) => `
        <tr>
          <td>${contact.name}</td>
          <td>${contact.email}</td>
          <td>${contact.position ?? '-'}</td>
          <td>${contact.isPrimary ? '<span class="chip winner">Principal</span>' : '-'}</td>
          <td>
            <div class="table-actions">
              <button class="table-button" type="button" onclick="editSupplierContact(${supplierId}, ${contact.id})">Editar</button>
              <button class="danger-button" type="button" onclick="deleteSupplierContact(${supplierId}, ${contact.id})">Apagar</button>
            </div>
          </td>
        </tr>
      `,
        )
        .join('')
    : '<tr><td colspan="5">Nenhum contato registrado.</td></tr>';
}

window.editSupplierContact = async (supplierId, contactId) => {
  const contact = (state.supplierContacts[supplierId] ?? []).find((c) => c.id === contactId);
  if (!contact) {
    return;
  }
  elements.supplierContactId.value = String(contact.id);
  elements.supplierContactName.value = contact.name;
  elements.supplierContactEmail.value = contact.email;
  elements.supplierContactPhone.value = contact.phone ?? '';
  elements.supplierContactPosition.value = contact.position ?? '';
  elements.supplierContactIsPrimary.checked = Boolean(contact.isPrimary);
  elements.supplierContactCancel.classList.remove('hidden');
  setActiveTab('suppliers');
};

window.deleteSupplierContact = async (supplierId, contactId) => {
  if (!window.confirm('Pretende apagar este contato?')) {
    return;
  }
  try {
    await request(`${API_BASE}/suppliers/${supplierId}/contacts/${contactId}`, {
      method: 'DELETE',
    });
    // Remove do cache local para reflet ir imediato na listagem
    if (state.supplierContacts[supplierId]) {
      state.supplierContacts[supplierId] = state.supplierContacts[supplierId].filter(
        (c) => c.id !== contactId,
      );
    }
    await loadSupplierContacts(supplierId);
    renderSuppliers();
    setFeedback('Contato apagado.');
  } catch (error) {
    setFeedback(error.message, true);
  }
};

async function loadQuoteRequestAttachments(quoteRequestId) {
  if (!quoteRequestId) {
    return;
  }
  state.selectedQuoteRequestId = quoteRequestId;
  try {
    const attachments = await request(`${API_BASE}/quote-requests/${quoteRequestId}/attachments`);
    state.quoteRequestAttachments[quoteRequestId] = attachments;
    renderAttachments(elements.quoteRequestAttachmentsBody, attachments, 'quote-request', quoteRequestId);
  } catch (error) {
    setFeedback(error.message, true);
  }
}

async function loadQuoteResponseAttachments(quoteResponseId) {
  if (!quoteResponseId) {
    return;
  }
  state.selectedQuoteResponseId = quoteResponseId;
  try {
    const attachments = await request(`${API_BASE}/quote-responses/${quoteResponseId}/attachments`);
    state.quoteResponseAttachments[quoteResponseId] = attachments;
    renderAttachments(elements.quoteResponseAttachmentsBody, attachments, 'quote-response', quoteResponseId);
  } catch (error) {
    setFeedback(error.message, true);
  }
}

function renderAttachments(container, attachments, parentType, parentId) {
  if (!container) {
    return;
  }
  if (!attachments?.length) {
    container.innerHTML = '<tr><td colspan="4">Sem anexos registrados.</td></tr>';
    return;
  }
  container.innerHTML = attachments
    .map(
      (attachment) => `
        <tr>
          <td>${attachment.filename}</td>
          <td>${formatBytes(attachment.sizeBytes)}</td>
          <td>${attachment.uploadedBy?.name ?? 'Sistema'}</td>
          <td>
            <div class="table-actions">
              <button class="table-button" type="button" onclick="downloadAttachment('${parentType}', ${parentId}, ${attachment.id}, '${encodeURIComponent(attachment.filename)}')">Baixar</button>
              <button class="danger-button" type="button" onclick="deleteAttachment('${parentType}', ${parentId}, ${attachment.id})">Apagar</button>
            </div>
          </td>
        </tr>
      `,
    )
    .join('');
}

function formatBytes(bytes) {
  if (!bytes) {
    return '-';
  }
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = Number(bytes);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

window.downloadAttachment = async (parentType, parentId, attachmentId, encodedFilename) => {
  try {
    const response = await fetch(
      `${API_BASE}/${parentType === 'quote-request' ? 'quote-requests' : 'quote-responses'}/${parentId}/attachments/${attachmentId}/download`,
      { credentials: 'same-origin' },
    );
    if (!response.ok) {
      throw new Error('Falha no download do anexo.');
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = decodeURIComponent(encodedFilename);
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch (error) {
    setFeedback(error.message, true);
  }
};

window.deleteAttachment = async (parentType, parentId, attachmentId) => {
  if (!window.confirm('Pretende apagar este anexo?')) {
    return;
  }
  const base = parentType === 'quote-request' ? 'quote-requests' : 'quote-responses';
  try {
    await request(`${API_BASE}/${base}/${parentId}/attachments/${attachmentId}`, {
      method: 'DELETE',
    });
    if (parentType === 'quote-request') {
      await loadQuoteRequestAttachments(parentId);
    } else {
      await loadQuoteResponseAttachments(parentId);
    }
    setFeedback('Anexo apagado.');
  } catch (error) {
    setFeedback(error.message, true);
  }
};

async function loadUsers() {
  if (!hasRole('admin') || !elements.usersBody) {
    return;
  }
  try {
    const users = await request(`${AUTH_API_BASE}/users`);
    state.users = users;
    renderUsers();
  } catch (error) {
    setFeedback(error.message, true);
  }
}

function renderUsers() {
  if (!elements.usersBody) {
    return;
  }
  const paginated = paginate(state.users, state.pagination.users);
  state.pagination.users = paginated.page;
  elements.usersBody.innerHTML = paginated.items
    .map(
      (user) => `
        <tr>
          <td>${user.name}</td>
          <td>${user.email}</td>
          <td><span class="chip">${user.role}</span></td>
          <td><span class="chip ${user.isActive ? 'winner' : 'warning'}">${user.isActive ? 'Ativo' : 'Inativo'}</span></td>
          <td>${user.lastLoginAt ? formatDate(user.lastLoginAt) : '-'}</td>
          <td>
            <div class="table-actions">
              <button class="table-button" type="button" onclick="editUser(${user.id})">Editar</button>
              <button class="danger-button" type="button" onclick="deleteUser(${user.id})">Apagar</button>
            </div>
          </td>
        </tr>
      `,
    )
    .join('') || '<tr><td colspan="6">Nenhum usuario cadastrado.</td></tr>';
  renderPagination(elements.usersPagination, 'users', paginated);
}

window.editUser = (id) => {
  const user = state.users.find((u) => u.id === id);
  if (!user) {
    return;
  }
  elements.userId.value = String(user.id);
  elements.userName.value = user.name;
  elements.userEmail.value = user.email;
  elements.userRole.value = user.role;
  elements.userActive.checked = Boolean(user.isActive);
  elements.userPassword.value = '';
  elements.userCancel.classList.remove('hidden');
};

window.deleteUser = async (id) => {
  if (!window.confirm('Pretende apagar este usuario?')) {
    return;
  }
  try {
    await request(`${AUTH_API_BASE}/users/${id}`, { method: 'DELETE' });
    await loadUsers();
    setFeedback('Usuario removido.');
  } catch (error) {
    setFeedback(error.message, true);
  }
};

async function loadRecoveryTokens() {
  if (!hasRole('admin') || !elements.userTokensBody) {
    return;
  }
  try {
    const tokens = await request(`${AUTH_API_BASE}/password-recovery/tokens`);
    state.recoveryTokens = tokens;
    elements.userTokensBody.innerHTML = tokens.length
      ? tokens
          .map(
            (token) => `
              <tr>
                <td>${token.user?.email ?? `#${token.userId}`}</td>
                <td><code>${token.token}</code></td>
                <td>${formatDate(token.expiresAt)}</td>
                <td>${token.usedAt ? formatDate(token.usedAt) : 'Nao'}</td>
                <td>${formatDate(token.createdAt)}</td>
              </tr>
            `,
          )
          .join('')
      : '<tr><td colspan="5">Nenhum token de recuperacao gerado.</td></tr>';
  } catch (error) {
    setFeedback(error.message, true);
  }
}

async function loadHelpArticles() {
  if (!elements.helpArticleList) {
    return;
  }
  try {
    const params = new URLSearchParams();
    if (state.filters.helpSearch) {
      params.set('search', state.filters.helpSearch);
    }
    if (state.filters.helpCategory && state.filters.helpCategory !== 'all') {
      params.set('category', state.filters.helpCategory);
    }
    const articles = await request(`${API_BASE}/help/articles${params.toString() ? `?${params}` : ''}`);
    state.helpArticles = articles;
    renderHelpArticles();
  } catch (error) {
    setFeedback(error.message, true);
  }
}

function renderHelpArticles() {
  if (!elements.helpArticleList) {
    return;
  }
  const categories = new Set(state.helpArticles.map((article) => article.category));
  if (elements.helpFilterCategory) {
    const current = elements.helpFilterCategory.value;
    const options = ['<option value="all">Todas</option>',
      ...Array.from(categories).map((category) => `<option value="${category}">${category}</option>`),
    ];
    elements.helpFilterCategory.innerHTML = options.join('');
    elements.helpFilterCategory.value = current || 'all';
  }
  elements.helpArticleList.innerHTML = state.helpArticles.length
    ? state.helpArticles
        .map(
          (article) => `
            <button class="help-card" type="button" onclick="showHelpArticle(${article.id})">
              <span class="chip">${article.category}</span>
              <h3>${article.title}</h3>
              <p>${article.summary ?? ''}</p>
            </button>
          `,
        )
        .join('')
    : '<p class="empty-state">Nenhum artigo encontrado.</p>';
  if (elements.helpArticleDetail) {
    elements.helpArticleDetail.classList.add('hidden');
    elements.helpArticleDetail.innerHTML = '';
  }
}

window.showHelpArticle = (id) => {
  const article = state.helpArticles.find((a) => a.id === id);
  if (!article || !elements.helpArticleDetail) {
    return;
  }
  elements.helpArticleDetail.classList.remove('hidden');
  elements.helpArticleDetail.innerHTML = `
    <h3>${article.title}</h3>
    <span class="chip">${article.category}</span>
    <pre class="json-block">${escapeHtml(article.body ?? '')}</pre>
  `;
};

async function loadReports(showSuccess) {
  if (!elements.reportSummary) {
    return;
  }
  loadFiltersFromInputs();
  try {
    const params = new URLSearchParams();
    if (state.filters.reportFrom) {
      params.set('from', state.filters.reportFrom);
    }
    if (state.filters.reportTo) {
      params.set('to', state.filters.reportTo);
    }
    const query = params.toString() ? `?${params}` : '';
    const [summary, savings, leadTime, topSuppliers, awardRate] = await Promise.all([
      request(`${API_BASE}/reports/summary${query}`),
      request(`${API_BASE}/reports/savings${query}`),
      request(`${API_BASE}/reports/lead-time${query}`),
      request(`${API_BASE}/reports/top-suppliers${query}`),
      request(`${API_BASE}/reports/award-rate${query}`),
    ]);
    renderReport(elements.reportSummary, summary, renderSummaryBody);
    renderReport(elements.reportSavings, savings, renderSavingsBody);
    renderReport(elements.reportLeadTime, leadTime, renderLeadTimeBody);
    renderReport(elements.reportTopSuppliers, topSuppliers, renderTopSuppliersBody);
    renderReport(elements.reportAwardRate, awardRate, renderAwardRateBody);
    if (showSuccess) {
      setFeedback('Relatorios atualizados.');
    }
  } catch (error) {
    setFeedback(error.message, true);
  }
}

function renderReport(article, payload, renderBody) {
  if (!article) {
    return;
  }
  const body = article.querySelector('.report-body');
  if (!body) {
    return;
  }
  body.innerHTML = renderBody(payload);
}

function renderSummaryBody(payload) {
  if (!payload) {
    return '<p class="empty-state">Sem dados no periodo.</p>';
  }
  return `
    <ul class="report-list">
      <li><strong>${payload.quoteRequests ?? 0}</strong> cotacoes</li>
      <li><strong>${payload.quoteResponses ?? 0}</strong> propostas</li>
      <li><strong>${payload.comparisons ?? 0}</strong> comparacoes executadas</li>
      <li><strong>${payload.winners ?? 0}</strong> vencedoras definidas</li>
    </ul>
  `;
}

function renderSavingsBody(payload) {
  if (!payload?.items?.length) {
    return '<p class="empty-state">Sem dados de economia no periodo.</p>';
  }
  return `
    <table>
      <thead><tr><th>Fornecedor</th><th>Cotacoes</th><th>Economia estimada</th></tr></thead>
      <tbody>
        ${payload.items
          .map(
            (item) => `
              <tr>
                <td>${item.supplierName ?? `#${item.supplierId}`}</td>
                <td>${item.quoteRequestCount}</td>
                <td>${formatCurrency(item.savingsBrl, 'BRL')}</td>
              </tr>
            `,
          )
          .join('')}
      </tbody>
    </table>
  `;
}

function renderLeadTimeBody(payload) {
  if (!payload?.items?.length) {
    return '<p class="empty-state">Sem dados de lead-time no periodo.</p>';
  }
  return `
    <table>
      <thead><tr><th>Fornecedor</th><th>Lead-time medio (dias)</th><th>Propostas</th></tr></thead>
      <tbody>
        ${payload.items
          .map(
            (item) => `
              <tr>
                <td>${item.supplierName ?? `#${item.supplierId}`}</td>
                <td>${item.averageLeadTimeDays.toFixed(1)}</td>
                <td>${item.responseCount}</td>
              </tr>
            `,
          )
          .join('')}
      </tbody>
    </table>
  `;
}

function renderTopSuppliersBody(payload) {
  if (!payload?.items?.length) {
    return '<p class="empty-state">Sem vitorias no periodo.</p>';
  }
  return `
    <table>
      <thead><tr><th>Fornecedor</th><th>Vitorias</th><th>Score medio</th></tr></thead>
      <tbody>
        ${payload.items
          .map(
            (item) => `
              <tr>
                <td>${item.supplierName ?? `#${item.supplierId}`}</td>
                <td>${item.wins}</td>
                <td>${item.averageScore.toFixed(2)}</td>
              </tr>
            `,
          )
          .join('')}
      </tbody>
    </table>
  `;
}

function renderAwardRateBody(payload) {
  if (!payload) {
    return '<p class="empty-state">Sem dados de adjudicacao.</p>';
  }
  return `
    <ul class="report-list">
      <li>Taxa de adjudicacao: <strong>${(payload.awardRate * 100).toFixed(1)}%</strong></li>
      <li>Cotacoes comparadas: <strong>${payload.comparedRequests}</strong></li>
      <li>Cotacoes abertas: <strong>${payload.openRequests}</strong></li>
    </ul>
  `;
}

function loadFiltersFromInputs() {
  state.filters.reportFrom = elements.reportFrom?.value || '';
  state.filters.reportTo = elements.reportTo?.value || '';
  state.filters.helpSearch = elements.helpSearch?.value || '';
  state.filters.helpCategory = elements.helpFilterCategory?.value || 'all';
}

async function init() {
  initTabs();
  renderIncotermOptions();
  resetSupplierForm();
  resetQuoteRequestForm();
  resetQuoteItemForm();
  resetQuoteResponseForm();
  resetUserForm();
  resetSupplierContactForm();
  showWizardStep(1);
  renderComparison([]);
  renderComparisonHistory([]);
  renderAuditLogs([], 'Os registos de auditoria vao aparecer aqui.');
  setAuditFilterState();
  clearAuthFeedback();
  loadFiltersFromInputs();

  try {
    await loadAuthenticatedUser();
    showApp();
    await loadData(true);
  } catch (error) {
    state.authenticatedUser = null;
    showAuth();

    if (!isUnauthorizedError(error)) {
      setAuthFeedback(error.message, true);
    }
  }
}

init();
