'use strict';
(() => {
  const root = document.querySelector('#app');
  const modal = document.querySelector('#modal');
  const notice = document.querySelector('#notice');
  const sections = { dashboard: ['Dashboard', 'Visão geral da sua central de licenciamento', 'layout-dashboard'], clients: ['Clientes', 'Clientes cadastrados na central', 'users'], installations: ['Instalações', 'Instalações e suas últimas validações', 'monitor'], licenses: ['Licenças', 'Validade, tolerância e gestão administrativa', 'key-round'], events: ['Auditoria', 'Histórico de operações e validações', 'history'] };
  const statuses = ['ACTIVE', 'GRACE', 'SUSPENDED', 'EXPIRED', 'REVOKED'];
  sections.updates = ['Atualizações', 'Controle das versões por produto • DRY-RUN e REAL', 'download'];
  let releases = [], updateProduct = '', realPublicationEnabled = false;
  const eventTypes = ['INSTALLATION_CREATED', 'LICENSE_CREATED', 'LICENSE_RENEWED', 'LICENSE_SUSPENDED', 'LICENSE_REACTIVATED', 'LICENSE_REVOKED', 'LICENSE_VALIDATED'];
  let token = '', session = 0, generation = 0, expiryTimer, toastTimer, statusTimer;
  let view = 'dashboard', query = '', filter = '', page = 1, busy = false;
  let cache = { clients: [], products: [], installations: [], licenses: [] };
  let events = [], eventTotal = 0, eventFilters = {};
  const e = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const icon = name => `<i data-lucide="${name}" aria-hidden="true"></i>`;
  const icons = () => window.lucide?.createIcons();
  const date = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
  const badge = status => `<span class="badge ${e(status)}">${e(status)}</span>`;
  const lookup = (kind, id) => cache[kind].find(item => item.id === id);
  const installation = id => lookup('installations', id);
  const clientName = item => lookup('clients', item?.clientId)?.name ?? '—';
  const productName = item => lookup('products', item?.productId)?.name ?? '—';
  const errors = { INVALID_FILE_COUNT: 'Envie exatamente o instalador, latest.yml e blockmap.', INVALID_FILE_NAME: 'Nome de arquivo inv�lido. Evite pontos consecutivos e caracteres especiais.', INVALID_INSTALLER: 'O instalador deve ser um execut�vel Windows v�lido.', FILE_TOO_LARGE: 'Arquivo vazio ou maior que o limite permitido.', RELEASE_CHANGED: 'Rascunho alterado durante a opera��o. Atualize os dados e tente novamente.',  REAL_PUBLICATION_NOT_CONFIGURED: 'Publicação real desativada ou configuração GitHub incompleta.', REAL_PUBLICATION_FAILED: 'Publicação falhou. A versão permanece DRAFT; consulte a etapa segura no registro e tente novamente.', INVALID_UPDATE_METADATA: 'latest.yml divergente: confira versão, nome, SHA-512 e tamanho.', INVALID_BLOCKMAP: 'Blockmap inválido ou não corresponde ao instalador.', ASSET_SIZE_MISMATCH: 'Tamanho do arquivo divergente.', INVALID_CREDENTIALS: 'E-mail ou senha inválidos.', UNAUTHORIZED: 'Sua sessão expirou. Entre novamente.', RATE_LIMITED: 'Muitas solicitações. Aguarde um minuto e tente novamente.', VALIDATION_ERROR: 'Confira os campos e os limites informados.', CONFLICT: 'Este registro já existe ou a instalação já possui licença.', INVALID_RELATION: 'Cliente, produto ou instalação não encontrado.', INACTIVE_ENTITY: 'A instalação, cliente e produto precisam estar habilitados.', LICENSE_REVOKED: 'Licenças revogadas não permitem alterações.', ALREADY_SUSPENDED: 'Esta licença já está suspensa.', LICENSE_NOT_SUSPENDED: 'Esta licença não está suspensa.', NOT_FOUND: 'Registro não encontrado.', RETRY_OPERATION: 'Houve uma operação concorrente. Atualize e tente novamente.' };
  Object.assign(errors, { PRODUCT_NOT_FOUND: 'Produto não encontrado.', PRODUCT_MISMATCH: 'Produto não corresponde ao registro.', RELEASE_NOT_EDITABLE: 'Esta release não pode ser editada.', INVALID_RELEASE_STATE: 'O estado da release não permite esta ação.', RELEASE_CHANGED: 'A release mudou durante a operação. Atualize e tente novamente.', INVALID_FILE_COUNT: 'Envie exatamente instalador, latest.yml e blockmap.', INVALID_FILE_NAME: 'Nome de arquivo inválido.', INVALID_FILE_EXTENSION: 'Extensão de arquivo inválida.', INVALID_FILE_MIME: 'Tipo de arquivo inválido.', INVALID_INSTALLER: 'Instalador inválido: cabeçalho MZ ausente.', INVALID_UPDATE_METADATA: 'latest.yml não corresponde ao instalador e à versão.', BLOCKMAP_MISMATCH: 'O nome do blockmap deve ser o nome do instalador seguido de .blockmap.', FILE_TOO_LARGE: 'Arquivo vazio ou acima do limite permitido.', INVALID_UPLOAD: 'Upload incompleto ou inválido.' });
  const state = l => l?.adminState ?? { status: 'UNKNOWN', nivel: 'UNKNOWN', label: 'Sem licença' };
  const effectiveStatus = l => state(l).status;
  const labels = { ACTIVE: 'Ativas', SOON: 'Vencem em breve', TODAY: 'Vencem hoje', GRACE: 'Em carência', CRITICAL: 'Últimos 3 dias de carência', SUSPENDED: 'Suspensas', REVOKED: 'Revogadas', EXPIRED: 'Expiradas' };
  const licenseFor = item => view === 'installations' ? cache.licenses.find(l => l.installationId === item.id) : item;
  const matches = (l, f) => !f || (f === 'SOON' ? ['SOON', 'TODAY'].includes(state(l).nivel) : ['TODAY', 'CRITICAL'].includes(f) ? state(l).nivel === f : effectiveStatus(l) === f);
  const deadline = l => `<span class="badge ${e(state(l).nivel)}">${e(state(l).label)}</span>`;
  let ordering = 'expiresAt';
  function summary() {
    return `<div class="stats">${[['ACTIVE', 'Licenças ativas'], ['SOON', 'Vencem nos próximos 7 dias'], ['GRACE', 'Em carência'], ['SUSPENDED', 'Suspensas']].map(([key, label]) => `<button class="card summary-card" data-summary="${key}"><span class="stat-label">${label}</span><strong class="metric">${cache.licenses.filter(l => matches(l, key)).length}</strong></button>`).join('')}</div>`;
  }
  function toast(message) { notice.textContent = message; clearTimeout(toastTimer); toastTimer = setTimeout(() => { notice.textContent = ''; }, 6000); }
  function closeModal() { modal.close(); modal.replaceChildren(); }
  function logout(message = '') {
    releases = []; updateProduct = '';
    token = ''; session++; generation++; clearTimeout(expiryTimer); clearInterval(statusTimer);
    cache = { clients: [], products: [], installations: [], licenses: [] }; events = []; eventFilters = {}; eventTotal = 0;
    query = ''; filter = ''; page = 1; view = 'dashboard'; busy = false; closeModal(); login(message);
  }
  async function api(path, body, signal, method) {
    const current = session;
    const multipart = body instanceof FormData;
    const response = await fetch(`/api/v1/${path}`, { method: method || (body === undefined ? 'GET' : 'POST'), credentials: 'omit', cache: 'no-store', signal, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined && !multipart ? { 'Content-Type': 'application/json' } : {}) }, ...(body !== undefined ? { body: multipart ? body : JSON.stringify(body) } : {}) });
    if (current !== session) throw new Error('Sessão encerrada.');
    if (response.status === 401 && token) { logout('Sua sessão expirou. Entre novamente.'); throw new Error(errors.UNAUTHORIZED); }
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.success) throw new Error(errors[result?.error] ?? 'Não foi possível concluir a solicitação. Tente novamente.');
    return result;
  }
  async function all(kind) {
    const items = [];
    for (let p = 1; ; p++) {
      const result = await api(`${kind}?page=${p}&limit=100`);
      items.push(...result.data);
      if (items.length >= result.pagination.total || !result.data.length) return items;
    }
  }
  function login(message = '') {
    root.innerHTML = `<main class="login"><div class="card"><div class="brand">${icon('shield-check')}<span>Central de Licenças<small>ADMINISTRAÇÃO</small></span></div><h1>Acesse sua central</h1><p class="muted">Entre com sua conta de administrador.</p><form id="login"><label for="email">E-mail</label><input id="email" name="email" type="email" autocomplete="username" maxlength="254" required><label for="password">Senha</label><input id="password" name="password" type="password" autocomplete="current-password" required><p class="error" role="alert">${e(message)}</p><button class="primary" type="submit">${icon('log-in')} Entrar no painel</button></form><p class="muted"><small>Sessão protegida • Central de Licenças</small></p></div></main>`;
    icons();
    root.querySelector('form').addEventListener('submit', async event => {
      event.preventDefault(); const form = event.currentTarget, button = form.querySelector('button'), error = form.querySelector('.error');
      button.disabled = true; error.textContent = '';
      try {
        const data = new FormData(form);
        if (new TextEncoder().encode(String(data.get('password'))).length > 72) throw new Error('A senha deve ter no máximo 72 bytes.');
        const result = await api('auth/login', { email: String(data.get('email')).trim(), password: data.get('password') });
        form.reset(); token = result.token; session++;
        // JWT expiration is used only to discard the local session. Authorization remains on the API.
        const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
        expiryTimer = setTimeout(() => logout('Sua sessão expirou. Entre novamente.'), Math.max(0, payload.exp * 1000 - Date.now()));
        shell(); await load();
        statusTimer = setInterval(() => { if (token && !modal.open && !busy) { if (['dashboard', 'licenses', 'installations'].includes(view)) load(); } }, 60000);
      } catch (err) { error.textContent = err.message; }
      finally { button.disabled = false; }
    });
  }
  function shell() {
    root.innerHTML = `<div class="shell"><aside class="sidebar" aria-label="Navegação principal"><div class="brand">${icon('shield-check')}<span>Central de Licenças<small>PAINEL ADMINISTRATIVO</small></span></div><nav class="nav">${Object.entries(sections).map(([key, item]) => `<button data-view="${key}">${icon(item[2])}${item[0]}</button>`).join('')}</nav><footer><small>Acesso administrativo</small><button id="logout">${icon('log-out')} Sair da conta</button></footer></aside><main class="main"><header class="top"><button class="menu" id="menu" aria-label="Abrir menu" aria-expanded="false">${icon('menu')}</button><div><h1 id="title"></h1><p id="subtitle"></p></div><div class="actions"><button id="refresh">${icon('refresh-cw')} Atualizar</button><button id="create" class="primary"></button></div></header><div id="content"></div></main></div>`;
    root.querySelector('#logout').onclick = () => logout();
    root.querySelector('#menu').onclick = event => { const open = root.querySelector('.shell').classList.toggle('open'); event.currentTarget.setAttribute('aria-expanded', String(open)); };
    root.querySelector('#refresh').onclick = () => load();
    root.querySelector('#create').onclick = () => view === 'updates' ? updateForm() : formModal(view === 'installations' ? 'installation' : 'license');
    root.querySelectorAll('[data-view]').forEach(button => { button.onclick = () => {
      const wasBusy = busy;
      closeModal(); generation++; busy = false; root.querySelector('#refresh').disabled = false;
      view = button.dataset.view; query = ''; filter = ''; page = 1;
      root.querySelector('.shell').classList.remove('open'); root.querySelector('#menu').setAttribute('aria-expanded', 'false');
      content(); if (['events', 'updates'].includes(view) || wasBusy) load();
    }; });
    content();
  }
  async function load() {
    if (!token) return;
    const current = ++generation; busy = true;
    root.querySelector('#refresh').disabled = true;
    root.querySelector('#content').innerHTML = '<div class="loading" role="status">Carregando dados da central…</div>';
    try {
      if (view === 'events') {
        const params = new URLSearchParams({ page: String(page), limit: '20', ...eventFilters });
        const result = await api(`events?${params}`);
        if (current !== generation || !token) return;
        events = result.data; eventTotal = result.pagination.total;
      } else {
        const result = {};
        // Sequential requests avoid bursts against the existing API rate limiter.
        for (const kind of Object.keys(cache)) result[kind] = await all(kind);
        if (current !== generation || !token) return;
        cache = result;
        if (view === 'updates') { const config = await api('updates/configuration'); realPublicationEnabled = config.realPublicationEnabled === true; const items = await all('updates'); if (current !== generation || !token) return; releases = items; }
      }
      content();
    } catch (err) {
      if (current !== generation || !token) return;
      root.querySelector('#content').innerHTML = `<div class="card"><h2>Não foi possível carregar os dados</h2><p class="error" role="alert">${e(err.message)}</p><button id="retry">Tentar novamente</button></div>`;
      root.querySelector('#retry').onclick = load;
    } finally { if (current === generation && token) { busy = false; root.querySelector('#refresh').disabled = false; } }
  }
  function table(headings, rows) { return `<div class="table-wrap"><table><thead><tr>${headings.map(x => `<th scope="col">${x}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.join('') : `<tr><td colspan="${headings.length}" class="empty">Nenhum registro encontrado.</td></tr>`}</tbody></table></div>`; }
  function row(kind, item) {
    if (kind === 'clients') return `<tr><td>${e(item.name)}<small>${e(item.id)}</small></td><td>${e(item.document || '—')}</td><td>${e(item.email || '—')}<small>${e(item.phone || '')}</small></td><td>${badge(item.active ? 'ACTIVE' : 'SUSPENDED')}</td><td>${cache.installations.filter(i => i.clientId === item.id).length}</td></tr>`;
    if (kind === 'installations') return monitoringRow(item, cache.licenses.find(l => l.installationId === item.id));
    if (kind === 'events') return `<tr><td>${date(item.createdAt)}</td><td>${e(item.type)}</td><td>${e(installation(item.installationId)?.name ?? item.installationId)}</td><td class="wrap">${e(item.description)}</td><td>${e(item.licenseId || '—')}<small>${e(item.id)}</small></td></tr>`;
    return monitoringRow(installation(item.installationId), item);
  }
  function monitoringRow(inst, item) {
    return `<tr><td>${e(inst?.name || '—')}<small>${e(inst?.installationId || item?.installationId)}</small><small>${e(productName(inst))}</small></td><td>${e(clientName(inst))}</td><td>${badge(item ? effectiveStatus(item) : 'Sem licença')}</td><td>${date(item?.expiresAt)}</td><td>${date(item?.graceUntil)}</td><td>${deadline(item)}</td><td>${e(inst?.reportedVersion || '—')}</td><td>${date(inst?.lastValidationAt)}<small>Atualizações: ${date(inst?.lastUpdateCheckAt)}</small></td><td>${item && item.status !== 'REVOKED' ? `<button data-action="renew" data-id="${e(item.id)}">Renovar</button><button data-action="${item.status === 'SUSPENDED' ? 'reactivate' : 'suspend'}" data-id="${e(item.id)}">${item.status === 'SUSPENDED' ? 'Reativar' : 'Suspender'}</button>` : ''}<button data-audit="${e(inst?.id || item?.installationId)}">Auditoria</button>${item ? `<button data-details="${e(item.id)}">Detalhes</button>` : ''}</td></tr>`;
  }
  const headings = { clients: ['Cliente', 'Documento', 'Contato', 'Cadastro', 'Instalações'], installations: ['Instalação', 'Cliente', 'Produto', 'Cadastro', 'Última validação', 'Ações'], licenses: ['Instalação / licença', 'Cliente', 'Status estimado', 'Validade', 'Ações'], events: ['Data', 'Evento', 'Instalação', 'Descrição', 'Licença / evento'] };
  headings.installations = headings.licenses = ['Instalação', 'Cliente', 'Status', 'Vencimento', 'Carência até', 'Prazo', 'Versão informada', 'Último check de licença', 'Ações'];
  function content() {
    if (!token) return;
    root.querySelector('#title').textContent = sections[view][0]; root.querySelector('#subtitle').textContent = sections[view][1];
    root.querySelectorAll('[data-view]').forEach(b => { b.classList.toggle('selected', b.dataset.view === view); if (b.dataset.view === view) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    const create = root.querySelector('#create'); create.hidden = !['installations', 'licenses', 'updates'].includes(view); create.innerHTML = `${icon('plus')} ${view === 'updates' ? 'Publicar nova versão' : view === 'installations' ? 'Nova instalação' : 'Nova licença'}`;
    const area = root.querySelector('#content');
    if (view === 'updates') {
      updatesContent(area);
    } else if (view === 'dashboard') {
      const active = cache.licenses.filter(l => effectiveStatus(l) === 'ACTIVE').length;
      area.innerHTML = `<div class="stats">${[['Clientes', cache.clients.length, 'users'], ['Instalações', cache.installations.length, 'monitor'], ['Licenças', cache.licenses.length, 'key-round'], ['Licenças ativas', active, 'circle-check']].map(([label, value, name]) => `<div class="card"><div class="stat-label">${label}${icon(name)}</div><div class="metric">${value}</div><small>Base administrativa</small></div>`).join('')}</div><div class="card"><h2>Distribuição das licenças</h2><div class="statuses">${[...statuses, 'SOON', 'TODAY', 'CRITICAL'].map(s => `<button data-status="${s}">${e(labels[s] || s)} <strong>${cache.licenses.filter(l => matches(l, s)).length}</strong></button>`).join('')}</div><small>Status calculado pela política atual da Central. A validação assinada é emitida pela API.</small></div><div class="card" style="margin-top:20px"><h2>Licenças com vencimento próximo</h2>${table(headings.licenses, cache.licenses.filter(l => ['SOON', 'TODAY', 'GRACE', 'CRITICAL'].includes(state(l).nivel)).sort((a, b) => Date.parse(a.expiresAt) - Date.parse(b.expiresAt)).slice(0, 8).map(l => row('licenses', l)))}</div>`;
      area.querySelectorAll('[data-status]').forEach(b => { b.onclick = () => { view = 'licenses'; filter = b.dataset.status; page = 1; content(); }; });
    } else if (view === 'events') {
      area.innerHTML = `<div class="card"><form id="audit-filters"><div class="form-row"><div><label for="event-type">Tipo de evento</label><select name="type" id="event-type"><option value="">Todos os tipos</option>${eventTypes.map(t => `<option ${eventFilters.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div><div><label for="audit-installation">UUID da instalação</label><input name="installationId" id="audit-installation" value="${e(eventFilters.installationId || '')}" placeholder="Opcional" pattern="[0-9a-fA-F-]{36}"></div></div><div class="form-row"><div><label for="from">De</label><input type="datetime-local" id="from" name="from"></div><div><label for="to">Até</label><input type="datetime-local" id="to" name="to"></div></div><label for="audit-license">UUID da licença</label><input id="audit-license" name="licenseId" value="${e(eventFilters.licenseId || '')}" placeholder="Opcional" pattern="[0-9a-fA-F-]{36}"><div class="tools"><button class="primary" type="submit">${icon('filter')} Filtrar</button><button type="button" id="clear-audit">Limpar filtros</button></div><p class="error" role="alert"></p></form>${table(headings.events, events.map(item => row('events', item)))}${pager(eventTotal, 20)}</div>`;
      for (const key of ['from', 'to']) if (eventFilters[key]) { const d = new Date(eventFilters[key]); area.querySelector(`#${key}`).value = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
      area.querySelector('#audit-filters').onsubmit = event => {
        event.preventDefault(); const data = new FormData(event.currentTarget), next = {};
        for (const [key, value] of data) if (value) next[key] = ['from', 'to'].includes(key) ? new Date(value).toISOString() : String(value).trim();
        if (next.from && next.to && next.from > next.to) { event.currentTarget.querySelector('.error').textContent = 'A data inicial deve ser anterior à final.'; return; }
        eventFilters = next; page = 1; load();
      };
      area.querySelector('#clear-audit').onclick = () => { eventFilters = {}; page = 1; load(); };
    } else {
      const monitoring = ['licenses', 'installations'].includes(view);
      area.innerHTML = `${monitoring ? summary() : ''}<div class="card"><div class="tools"><input id="search" type="search" aria-label="Pesquisar registros" placeholder="Pesquisar por nome, identificador ou cliente…" value="${e(query)}"><select id="status-filter" aria-label="Filtrar status"><option value="">Todos</option>${(monitoring ? Object.keys(labels) : ['ACTIVE', 'SUSPENDED']).map(key => `<option value="${key}" ${filter === key ? 'selected' : ''}>${e(labels[key])}</option>`).join('')}</select>${monitoring ? `<select id="ordering" aria-label="Ordenar por"><option value="expiresAt">Vencimento · mais próximo</option><option value="status">Status · atenção primeiro</option><option value="client">Cliente · A–Z</option><option value="check">Último check · mais antigo</option></select><small>Prazos por dia em America/Fortaleza. Atualização a cada minuto.</small>` : ''}</div><div id="results"></div></div>`;
      area.querySelectorAll('[data-summary]').forEach(button => { button.onclick = () => { filter = button.dataset.summary; page = 1; content(); }; });
      if (monitoring) {
        area.querySelector('#ordering').value = ordering;
        area.querySelector('#ordering').onchange = event => { ordering = event.target.value; page = 1; results(); };
      }
      area.querySelector('#search').oninput = event => { query = event.target.value; page = 1; results(); };
      area.querySelector('#status-filter').onchange = event => { filter = event.target.value; page = 1; results(); };
      results();
    }
    bindRows(); icons();
  }
  function pager(total, limit) { const pages = Math.max(1, Math.ceil(total / limit)); return `<div class="pagination"><small>${total} registro(s) • Página ${page} de ${pages}</small><div><button data-page="-1" ${page <= 1 ? 'disabled' : ''}>Anterior</button><button data-page="1" ${page >= pages ? 'disabled' : ''}>Próxima</button></div></div>`; }
  function compareVersions(a, b) {
    const split = v => { const [main, pre] = v.split('-'); return [main.split('.').map(Number), pre?.split('.')]; };
    const [am, ap] = split(a), [bm, bp] = split(b);
    for (let i = 0; i < 3; i++) if (am[i] !== bm[i]) return am[i] - bm[i];
    if (!ap || !bp) return ap ? -1 : bp ? 1 : 0;
    for (let i = 0; i < Math.max(ap.length, bp.length); i++) {
      if (ap[i] === undefined || bp[i] === undefined) return ap[i] === undefined ? -1 : 1;
      if (ap[i] === bp[i]) continue;
      const an = /^\d+$/.test(ap[i]), bn = /^\d+$/.test(bp[i]);
      if (an && bn) return BigInt(ap[i]) < BigInt(bp[i]) ? -1 : 1;
      if (an !== bn) return an ? -1 : 1;
      return ap[i] < bp[i] ? -1 : 1;
    }
    return 0;
  }
  function updatesContent(area) {
    if (!cache.products.some(p => p.id === updateProduct)) updateProduct = cache.products.find(p => p.code === 'sistema-atendimento')?.id || cache.products[0]?.id || '';
    const items = releases.filter(r => r.productId === updateProduct);
    const latest = channel => items.filter(r => r.channel === channel && r.status === 'PUBLISHED' && !r.dryRun).sort((a, b) => compareVersions(b.version, a.version))[0];
    const published = items.filter(r => r.publishedAt).sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))[0];
    area.innerHTML = `<div class="card"><label for="update-product">Produto</label><select id="update-product">${options(cache.products, p => p.name)}</select><p class="info">${realPublicationEnabled ? "MODO DE PUBLICAÇÃO: REAL habilitado; DRY-RUN disponível." : "MODO DE PUBLICAÇÃO: DRY-RUN. Publicação REAL desativada no servidor."}</p><div class="stats">${[['Versão estável', latest('stable')?.version || '—'], ['Versão beta', latest('beta')?.version || '—'], ['Última publicação', date(published?.publishedAt)]].map(([label, value]) => `<div><small>${e(label)}</small><p><strong>${e(value)}</strong></p></div>`).join('')}</div><h2>Histórico de versões</h2>${table(['Versão', 'Canal', 'Status', 'Publicada em', 'Tipo', 'Ações'], items.map(r => `<tr><td>${e(r.version)}<small>${e(r.title)}</small>${r.publicationLog?.mode === "REAL" && r.publicationLog?.assets?.find(a => a.kind === "installer") ? `<small>Arquivo publicado: ${e(r.publicationLog.assets.find(a => a.kind === "installer").name)}</small>` : ""}${r.sha256 ? `<small>SHA-256: ${e(r.sha256)}</small>` : ''}</td><td>${e(r.channel)}</td><td>${badge(r.status)}<small>${e({ DRAFT: 'Rascunho', PUBLISHED: 'Publicada', DISABLED: 'Distribuição desabilitada' }[r.status] || r.status)}</small>${r.publicationLog?.failed ? `<small>Falha: ${e(r.publicationLog.stage)}. Release GitHub: ${e(r.publicationLog.releaseId || '—')}</small>` : ''}<small>${r.dryRun ? 'Teste / dry-run' : ''}</small></td><td>${date(r.publishedAt)}</td><td>${r.mandatory ? 'Obrigatória' : 'Opcional'}</td><td>${r.status === 'DRAFT' ? `<button data-edit-update="${e(r.id)}">Editar / simular / publicar</button>` : ''}${r.status !== 'DISABLED' ? `<button data-disable-update="${e(r.id)}">Desabilitar distribuição</button>` : ''}</td></tr>`))}</div><div class="card" style="margin-top:20px"><h2>Instalações e canais</h2>${table(['Instalação', 'Cliente', 'Canal permitido', 'Versão informada', 'Último check', 'Ações'], cache.installations.filter(i => i.productId === updateProduct).map(i => `<tr><td>${e(i.name)}</td><td>${e(clientName(i))}</td><td>${e(i.updateChannel || 'stable')}</td><td>${e(i.reportedVersion || '—')}</td><td>${date(i.lastUpdateCheckAt)}</td><td><button data-channel-installation="${e(i.id)}" data-channel="${i.updateChannel === 'beta' ? 'stable' : 'beta'}">${i.updateChannel === 'beta' ? 'Usar stable' : 'Habilitar beta'}</button></td></tr>`))}</div>`;
    area.querySelector('#update-product').value = updateProduct;
    area.querySelector('#update-product').onchange = event => { updateProduct = event.target.value; content(); };
    area.querySelectorAll('[data-edit-update]').forEach(b => { b.onclick = () => updateForm(releases.find(r => r.id === b.dataset.editUpdate)); });
    area.querySelectorAll('[data-disable-update], [data-channel-installation]').forEach(b => { b.onclick = async () => {
      b.disabled = true;
      try {
        if (b.dataset.disableUpdate) await api(`updates/${b.dataset.disableUpdate}/disable`, {});
        else await api(`installations/${b.dataset.channelInstallation}`, { updateChannel: b.dataset.channel }, undefined, 'PATCH');
        await load();
      } catch (err) { toast(err.message); } finally { if (b.isConnected) b.disabled = false; }
    }; });
  }
  function updateForm(item) {
    if (busy) { toast('Aguarde a atualização dos dados.'); return; }
    showModal('Publicar atualização', `<form id="update-form"><label for="release-product">Produto</label><select id="release-product" name="productId" required>${options(cache.products.filter(p => p.active), p => p.name)}</select><label for="release-version">Versão (SemVer)</label><input id="release-version" name="version" placeholder="1.0.1" maxlength="100" required><label for="release-channel">Canal</label><select id="release-channel" name="channel"><option value="stable">Estável</option><option value="beta">Beta</option></select><label for="release-mandatory">Tipo</label><select id="release-mandatory" name="mandatory"><option value="false">Opcional</option><option value="true">Obrigatória</option></select><label for="release-title">Título</label><input id="release-title" name="title" maxlength="200" required><label for="release-notes">Notas da versão</label><textarea id="release-notes" name="notes" maxlength="10000"></textarea><label for="release-installer">Setup.exe (até 250 MiB)</label><input id="release-installer" name="installer" type="file" accept=".exe"><label for="release-metadata">latest.yml (até 64 KiB)</label><input id="release-metadata" name="metadata" type="file" accept=".yml"><label for="release-blockmap">Setup.exe.blockmap (até 10 MiB)</label><input id="release-blockmap" name="blockmap" type="file" accept=".blockmap"><p class="info">O latest.yml deve corresponder à versão, nome, tamanho e SHA-512 do instalador. Arquivos são temporários e precisam ser reenviados em cada simulação ou publicação.</p><p class="error" role="alert"></p><div class="dialog-actions"><button type="button" data-close>Cancelar</button><button type="submit" name="intent" value="draft">Salvar draft</button><button class="primary" type="submit" name="intent" value="publish">Simular (DRY-RUN)</button><button class="primary" type="submit" name="intent" value="real" ${realPublicationEnabled ? "" : "disabled"}>Publicar versão (REAL)</button></div></form>`);
    const form = modal.querySelector('form');
    form.elements.productId.value = item?.productId || updateProduct;
    if (item) for (const key of ['version', 'channel', 'mandatory', 'title', 'notes']) form.elements[key].value = String(item[key]);
    if (item) form.elements.productId.disabled = true;
    let draftId = item?.id, submitting = false;
    const currentSession = session;
    form.onsubmit = async event => {
      event.preventDefault(); if (submitting) return;
      const real = event.submitter?.value === 'real';
      if (real && !realPublicationEnabled) return;
      const publish = real || event.submitter?.value === 'publish';
      const body = Object.fromEntries(['productId', 'version', 'channel', 'title', 'notes'].map(k => [k, form.elements[k].value]));
      body.mandatory = form.elements.mandatory.value === 'true';
      const files = new FormData();
      if (publish) for (const key of ['installer', 'metadata', 'blockmap']) {
        const file = form.elements[key].files[0];
        if (!file) { form.querySelector('.error').textContent = 'Selecione os três arquivos para simular a publicação.'; return; }
        files.append(key, file);
      }
      if (real) {
        const dialog = document.createElement('dialog');
        dialog.innerHTML = `<h2>PUBLICAÇÃO REAL</h2><p>Publicar a versão ${e(body.version)} no canal ${e(body.channel)}?</p><p>Após a publica??o, instalações elegíveis poderão receber esta atualização.</p><form method="dialog"><button value="cancel">Cancelar</button><button value="publish" class="primary">Publicar versão</button></form>`;
        document.body.append(dialog); dialog.showModal();
        const approved = await new Promise(resolve => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'publish'), { once: true }));
        dialog.remove(); if (!approved) return;
      }
      submitting = true; form.querySelectorAll('button').forEach(b => { b.disabled = true; });
      const preventClose = event => event.preventDefault(); modal.addEventListener('cancel', preventClose);
      modal.querySelector('.dialog-top button').disabled = true;
      try {
        const result = await api(draftId ? `updates/${draftId}` : 'updates', body, undefined, draftId ? 'PATCH' : 'POST');
        if (session !== currentSession || !token) return;
        draftId = result.data.id;
        form.elements.productId.disabled = true;
        if (publish) await api(`updates/${draftId}/${real ? "publish-real" : "publish"}`, files);
        if (session !== currentSession || !token) return;
        closeModal(); toast(real ? 'Versão publicada. Instalações elegíveis poderão recebê-la.' : publish ? 'Simulação concluída. Release permanece DRAFT e não é distribuída.' : 'Draft salvo.'); await load();
      } catch (err) { if (form.isConnected) form.querySelector('.error').textContent = `${draftId ? 'Draft salvo. ' : ''}${err.message}`; }
      finally { submitting = false; modal.removeEventListener('cancel', preventClose); if (form.isConnected) { form.querySelectorAll('button').forEach(b => { b.disabled = b.value === 'real' && !realPublicationEnabled; }); modal.querySelector('.dialog-top button').disabled = false; } }
    };
  }
  function results() {
    const text = query.toLocaleLowerCase('pt-BR');
    const items = cache[view].filter(item => {
      const inst = view === 'licenses' ? installation(item.installationId) : item;
      const values = [item.id, item.name, item.document, item.email, item.phone, item.installationId, clientName(inst), productName(inst), inst?.name, inst?.installationId];
      return values.some(v => String(v ?? '').toLocaleLowerCase('pt-BR').includes(text)) && (!filter || (['licenses', 'installations'].includes(view) ? matches(licenseFor(item), filter) : (item.active ? 'ACTIVE' : 'SUSPENDED') === filter));
    });
    if (['licenses', 'installations'].includes(view)) items.sort((a, b) => {
      const la = licenseFor(a), lb = licenseFor(b);
      const ia = view === 'licenses' ? installation(a.installationId) : a, ib = view === 'licenses' ? installation(b.installationId) : b;
      const timestamp = value => Number.isFinite(Date.parse(value)) ? Date.parse(value) : Infinity;
      if (ordering === 'client') return clientName(ia).localeCompare(clientName(ib), 'pt-BR');
      if (ordering === 'check') return timestamp(ia?.lastValidationAt) - timestamp(ib?.lastValidationAt);
      if (ordering === 'status') {
        const rank = ['CRITICAL', 'TODAY', 'SOON', 'GRACE', 'EXPIRED', 'SUSPENDED', 'REVOKED', 'ACTIVE', 'UNKNOWN'];
        return rank.indexOf(state(la).nivel) - rank.indexOf(state(lb).nivel);
      }
      return timestamp(la?.expiresAt) - timestamp(lb?.expiresAt);
    });
    page = Math.min(page, Math.max(1, Math.ceil(items.length / 20)));
    root.querySelector('#results').innerHTML = table(headings[view], items.slice((page - 1) * 20, page * 20).map(item => row(view, item))) + pager(items.length, 20);
    bindRows(); icons();
  }
  function bindRows() {
    root.querySelectorAll('[data-page]').forEach(b => { b.onclick = () => { page += Number(b.dataset.page); view === 'events' ? load() : results(); }; });
    root.querySelectorAll('[data-action]').forEach(b => { b.onclick = () => formModal(b.dataset.action, b.dataset.id); });
    root.querySelectorAll('[data-audit]').forEach(b => { b.onclick = () => { eventFilters = { installationId: b.dataset.audit, ...(b.dataset.license ? { licenseId: b.dataset.license } : {}) }; view = 'events'; page = 1; content(); load(); }; });
    root.querySelectorAll('[data-details]').forEach(b => { b.onclick = () => {
      const item = lookup('licenses', b.dataset.details);
      const inst = installation(item.installationId), info = state(item);
      showModal('Detalhes da licença', `<p><strong>Instalação:</strong> ${e(inst?.name)}</p><p><strong>Cliente:</strong> ${e(clientName(inst))}</p><p><strong>UUID:</strong> ${e(item.id)}</p><p><strong>Status atual:</strong> ${badge(info.status)} ${deadline(item)}</p><p><strong>Status administrativo:</strong> ${e(item.status)}</p><p><strong>Início:</strong> ${date(item.startsAt)}</p><p><strong>Vencimento:</strong> ${date(item.expiresAt)}</p><p><strong>Carência até:</strong> ${date(item.graceUntil)}</p><p><strong>Dias para vencer:</strong> ${e(info.diasParaVencer ?? '—')}</p><p><strong>Dias de carência restantes:</strong> ${e(info.diasCarenciaRestantes ?? '—')}</p><p><strong>Canal:</strong> ${e(inst?.updateChannel || '—')}</p><p><strong>Versão informada:</strong> ${e(inst?.reportedVersion || '—')}</p><p><strong>Último check de licença:</strong> ${date(inst?.lastValidationAt)}</p><p><strong>Último check de atualização:</strong> ${date(inst?.lastUpdateCheckAt)}</p><p><strong>Observa\u00e7\u00f5es:</strong> ${e(item.notes || '—')}</p><div class="dialog-actions"><button data-close>Fechar</button></div>`);
    }; });
  }
  function showModal(title, body) {
    closeModal(); modal.innerHTML = `<div class="dialog-top"><h2 id="modal-title">${e(title)}</h2><button data-close aria-label="Fechar">${icon('x')}</button></div>${body}`;
    modal.querySelectorAll('[data-close]').forEach(b => { b.onclick = closeModal; }); modal.showModal(); icons();
  }
  function options(items, label) { return items.map(item => `<option value="${e(item.id)}">${e(label(item))}</option>`).join(''); }
  function formModal(kind, id) {
    if (busy) { toast('Aguarde a atualização dos dados.'); return; }
    const item = lookup('licenses', id);
    const titles = { installation: 'Criar instalação', license: 'Criar licença', renew: 'Renovar licença', suspend: 'Suspender licença', reactivate: 'Reativar licença' };
    let fields = '';
    if (kind === 'installation') fields = `<label for="name">Nome da instalação</label><input id="name" name="name" maxlength="200" required><label for="clientId">Cliente</label><select id="clientId" name="clientId" required><option value="">Selecione um cliente</option>${options(cache.clients.filter(c => c.active), c => c.name)}</select><label for="productId">Produto</label><select id="productId" name="productId" required><option value="">Selecione um produto</option>${options(cache.products.filter(p => p.active), p => `${p.name} (${p.code})`)}</select><label for="installationId">Identificador <small>(opcional; gerado pela API)</small></label><input id="installationId" name="installationId" maxlength="100" pattern="[A-Za-z0-9][A-Za-z0-9_-]*"><p class="muted">Use letras, números, hífen ou sublinhado.</p>`;
    if (kind === 'license') {
      const eligible = cache.installations.filter(i => i.active && lookup('clients', i.clientId)?.active && lookup('products', i.productId)?.active && !cache.licenses.some(l => l.installationId === i.id));
      fields = `<label for="installationId">Instalação sem licença</label><select id="installationId" name="installationId" required><option value="">Selecione uma instalação</option>${options(eligible, i => `${i.name} • ${clientName(i)} • ${i.installationId}`)}</select>${!eligible.length ? '<p class="info">Não há instalações habilitadas sem licença. Crie uma instalação ou atualize os dados.</p>' : ''}`;
    }
    if (['license', 'renew'].includes(kind)) fields += `<div class="form-row"><div><label for="days">Dias de validade</label><input id="days" name="days" type="number" min="1" max="3650" step="1" value="30" required></div><div><label for="graceDays">Dias de tolerância</label><input id="graceDays" name="graceDays" type="number" min="0" max="365" step="1" value="5" required></div></div>`;
    if (kind === 'license') fields += '<label for="notes">Observações (opcional)</label><textarea id="notes" name="notes" maxlength="2000"></textarea>';
    if (kind === 'renew') fields += `<p class="info">A renovação adiciona dias a partir do vencimento atual ou da data do servidor, o que for posterior. Uma licença suspensa permanece suspensa.</p>`;
    if (['suspend', 'reactivate'].includes(kind)) fields += `<p class="info">${kind === 'suspend' ? 'A licença passará ao status administrativo SUSPENDED.' : 'O status administrativo voltará a ACTIVE. As datas de validade permanecem iguais.'}</p><label for="reason">Motivo (opcional)</label><textarea id="reason" name="reason" maxlength="500"></textarea>`;
    if (item) fields = `<p class="muted">${e(installation(item.installationId)?.name)} • ${e(item.id)}</p>` + fields;
    showModal(titles[kind], `<form id="operation">${fields}<p class="error" role="alert"></p><div class="dialog-actions"><button type="button" data-close>Cancelar</button><button class="primary" type="submit">${titles[kind]}</button></div></form>`);
    let submitting = false;
    modal.querySelector('form').onsubmit = async event => {
      event.preventDefault(); if (submitting) return;
      const form = event.currentTarget, data = new FormData(form), body = {};
      for (const [key, value] of data) if (String(value).trim()) body[key] = ['days', 'graceDays'].includes(key) ? Number(value) : String(value).trim();
      const path = kind === 'installation' ? 'installations' : kind === 'license' ? 'licenses' : `licenses/${id}/${kind}`;
      const currentSession = session; submitting = true;
      form.querySelectorAll('button').forEach(b => { b.disabled = true; });
      modal.querySelector('.dialog-top button').disabled = true;
      const blockCancel = event => event.preventDefault(); modal.addEventListener('cancel', blockCancel);
      try {
        const result = await api(path, body);
        if (!token || currentSession !== session) return;
        closeModal();
        if (kind === 'installation') {
          // The secret is placed only in this transient dialog, never in cache/storage/logs.
          showModal('Instalação criada', `<p class="info"><strong>IMPORTANTE</strong><br>Este segredo será exibido somente uma vez.<br>Guarde-o em local seguro antes de fechar esta janela.</p><label>Identificador da instalação</label><div class="secret">${e(result.installationId)}</div><label>installationSecret — exibição única</label><div class="secret">${e(result.installationSecret)}</div><div class="dialog-actions"><button data-close class="primary">Salvei o segredo • Fechar</button></div>`);
          delete result.installationSecret;
        } else toast('Operação concluída com sucesso.');
        await load();
      } catch (err) { if (form.isConnected) form.querySelector('.error').textContent = err.message; }
      finally {
        submitting = false; modal.removeEventListener('cancel', blockCancel);
        if (form.isConnected) { form.querySelectorAll('button').forEach(b => { b.disabled = b.value === 'real' && !realPublicationEnabled; }); modal.querySelector('.dialog-top button').disabled = false; }
      }
    };
  }
  modal.addEventListener('close', () => { if (!modal.open) modal.replaceChildren(); });
  modal.addEventListener('cancel', () => { setTimeout(() => { if (!modal.open) modal.replaceChildren(); }, 0); });
  window.addEventListener('pagehide', () => { token = ''; session++; modal.replaceChildren(); cache = {}; events = []; root.replaceChildren(); });
  window.addEventListener('pageshow', event => { if (event.persisted) logout(); });
  login();
})();
