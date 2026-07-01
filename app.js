/* =========================================
   Compras por PIX — Bereguedê & Afins
   Sistema com contas, eventos, ingressos
   ========================================= */

// ===== SUPABASE =====
const SUPABASE_URL = 'https://vvcosbmpaqeojdpiuxuo.supabase.co';
const SUPABASE_KEY = 'sb_publishable_73g9eeTuBSjko9dk3mAx9Q_ErOfzsmj';
let db = null;

function initSupabase() {
    try {
        if (window.supabase && window.supabase.createClient) {
            db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
        }
    } catch (e) { console.warn('Supabase init failed:', e); }
}

function toSnake(obj) {
    const r = {};
    for (const [k, v] of Object.entries(obj)) {
        r[k.replace(/[A-Z]/g, c => '_' + c.toLowerCase())] = v;
    }
    return r;
}

function toCamel(obj) {
    const r = {};
    for (const [k, v] of Object.entries(obj)) {
        r[k.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] = v;
    }
    return r;
}

async function cloudPull() {
    if (!db) return false;
    try {
        const { data: users, error: ue } = await db.from('users').select('*');
        if (ue) throw ue;
        const { data: events, error: ee } = await db.from('events').select('*');
        if (ee) throw ee;
        const { data: guests, error: ge } = await db.from('guests').select('*');
        if (ge) throw ge;

        if (users) save(KEYS.USERS, users.map(toCamel));
        if (events) save(KEYS.EVENTS, events.map(toCamel));
        if (guests && events) {
            events.forEach(ev => {
                const eg = guests.filter(g => g.event_id === ev.id).map(g => {
                    const obj = toCamel(g);
                    delete obj.eventId;
                    return obj;
                });
                saveGuests(ev.id, eg);
            });
        }
        return true;
    } catch (e) {
        console.warn('Cloud pull failed:', e);
        return false;
    }
}

async function cloudMigrate() {
    if (!db) return;
    try {
        const { data: cloudUsers } = await db.from('users').select('id');
        if (cloudUsers && cloudUsers.length > 1) return;

        const localUsers = load(KEYS.USERS) || [];
        for (const u of localUsers) {
            await db.from('users').upsert(toSnake(u));
        }
        const localEvents = load(KEYS.EVENTS) || [];
        for (const ev of localEvents) {
            await db.from('events').upsert(toSnake(ev));
            const guests = loadGuests(ev.id);
            for (const g of guests) {
                await db.from('guests').upsert({ ...toSnake(g), event_id: ev.id });
            }
        }
    } catch (e) { console.warn('Migration failed:', e); }
}

async function dbPush(table, data) {
    if (!db) { queueSync({ action: 'upsert', table, data }); return false; }
    try {
        const { error } = await db.from(table).upsert(data);
        if (error) { queueSync({ action: 'upsert', table, data }); return false; }
        return true;
    } catch (e) { queueSync({ action: 'upsert', table, data }); return false; }
}

async function dbRemove(table, col, val) {
    if (!db) { queueSync({ action: 'delete', table, col, val }); return false; }
    try {
        const { error } = await db.from(table).delete().eq(col, val);
        if (error) { queueSync({ action: 'delete', table, col, val }); return false; }
        return true;
    } catch (e) { queueSync({ action: 'delete', table, col, val }); return false; }
}

// ===== SYNC QUEUE =====
function queueSync(item) {
    const queue = JSON.parse(localStorage.getItem('bga_sync_queue') || '[]');
    queue.push(item);
    localStorage.setItem('bga_sync_queue', JSON.stringify(queue));
    showSyncStatus(false);
}

async function processQueue() {
    if (!db) return;
    const queue = JSON.parse(localStorage.getItem('bga_sync_queue') || '[]');
    if (queue.length === 0) { showSyncStatus(true); return; }
    const remaining = [];
    for (const item of queue) {
        try {
            if (item.action === 'upsert') {
                const { error } = await db.from(item.table).upsert(item.data);
                if (error) { remaining.push(item); continue; }
            } else if (item.action === 'delete') {
                const { error } = await db.from(item.table).delete().eq(item.col, item.val);
                if (error) { remaining.push(item); continue; }
            }
        } catch (e) { remaining.push(item); }
    }
    localStorage.setItem('bga_sync_queue', JSON.stringify(remaining));
    showSyncStatus(remaining.length === 0);
    if (remaining.length > 0) showToast('Alguns dados aguardam sincronização');
}

function showSyncStatus(synced) {
    let el = document.getElementById('sync-status');
    if (!el) return;
    if (synced) {
        el.textContent = '☁️ Sincronizado';
        el.className = 'sync-status synced';
    } else {
        el.textContent = '⏳ Pendente';
        el.className = 'sync-status pending';
    }
}

// ===== STORAGE =====
const KEYS = { USERS: 'bga_users', EVENTS: 'bga_events', SESSION: 'bga_session' };

function load(key) { try { return JSON.parse(localStorage.getItem(key)) || null; } catch { return null; } }
function save(key, data) { localStorage.setItem(key, JSON.stringify(data)); }
function guestsKey(eventId) { return `bga_guests_${eventId}`; }
function loadGuests(eventId) { return load(guestsKey(eventId)) || []; }
function saveGuests(eventId, guests) { save(guestsKey(eventId), guests); }

// ===== INIT ADMIN =====
function ensureAdmin() {
    let users = load(KEYS.USERS) || [];
    const admin = users.find(u => u.role === 'admin');
    if (!admin) {
        const a = { id: 'admin001', username: 'caiobity', name: 'Caio Bity', email: 'caiobity88@gmail.com', password: '2602', role: 'admin', createdAt: Date.now() };
        users.push(a);
        dbPush('users', toSnake(a));
    } else {
        admin.username = 'caiobity';
        admin.email = 'caiobity88@gmail.com';
        admin.password = '2602';
        admin.name = 'Caio Bity';
        dbPush('users', toSnake(admin));
    }
    save(KEYS.USERS, users);
}

function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

// ===== SESSION =====
let currentUser = null;
let currentEventId = null;

function getSession() { return load(KEYS.SESSION); }
function setSession(user) { save(KEYS.SESSION, { userId: user.id }); currentUser = user; }
function clearSession() { localStorage.removeItem(KEYS.SESSION); currentUser = null; currentEventId = null; }

function restoreSession() {
    const session = getSession();
    if (!session) return false;
    const users = load(KEYS.USERS) || [];
    const user = users.find(u => u.id === session.userId);
    if (!user) { clearSession(); return false; }
    currentUser = user;
    return true;
}

// ===== SCREEN NAVIGATION =====
function showScreen(name) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const el = document.getElementById('screen-' + name);
    if (el) {
        el.classList.remove('active');
        void el.offsetWidth;
        el.classList.add('active');
    }

    if (name === 'events') {
        renderEvents();
        const nameEl = document.getElementById('user-name-display');
        if (nameEl && currentUser) nameEl.textContent = currentUser.name;
        document.getElementById('admin-section').style.display = currentUser?.role === 'admin' ? 'block' : 'none';
    }
    if (name === 'app') {
        const events = load(KEYS.EVENTS) || [];
        const ev = events.find(e => e.id === currentEventId);
        if (ev) document.getElementById('event-title-header').textContent = ev.name;
        switchTab('register');
        updateBadge();
    }
    if (name === 'admin') renderProducersList();
}

// ===== LOGIN =====
function doLogin(e) {
    e.preventDefault();
    const username = document.getElementById('login-user').value.trim().toLowerCase();
    const pass = document.getElementById('login-pass').value;
    const errorEl = document.getElementById('login-error');
    const users = load(KEYS.USERS) || [];
    const user = users.find(u => (u.username || u.name).toLowerCase() === username && u.password === pass);
    if (!user) { errorEl.textContent = 'Usuário ou senha incorretos'; return; }
    errorEl.textContent = '';
    setSession(user);
    showScreen('events');
}

function doLogout() {
    clearSession();
    showScreen('login');
    document.getElementById('login-user').value = '';
    document.getElementById('login-pass').value = '';
    document.getElementById('login-error').textContent = '';
}

// ===== EVENTS =====
function getUserEvents() {
    const events = load(KEYS.EVENTS) || [];
    if (!currentUser) return [];
    if (currentUser.role === 'admin') return events;
    return events.filter(ev => ev.producers && ev.producers.includes(currentUser.id));
}

function renderEvents() {
    const events = getUserEvents();
    const listEl = document.getElementById('events-list');
    const emptyEl = document.getElementById('events-empty');
    if (events.length === 0) {
        listEl.innerHTML = '';
        emptyEl.style.display = 'block';
        return;
    }
    emptyEl.style.display = 'none';
    listEl.innerHTML = events.map(ev => {
        const guests = loadGuests(ev.id);
        const dateStr = ev.date ? new Date(ev.date + 'T12:00:00').toLocaleDateString('pt-BR') : '';
        return `<div class="event-card">
            <div class="event-icon" onclick="enterEvent('${ev.id}')">🎉</div>
            <div class="event-info" onclick="enterEvent('${ev.id}')">
                <div class="event-name">${esc(ev.name)}</div>
                <div class="event-meta">${dateStr ? dateStr + ' · ' : ''}${guests.length} ingressos</div>
            </div>
            <div class="event-actions">
                <span class="event-badge">${guests.length}</span>
                <button class="btn-delete-event" onclick="event.stopPropagation();confirmDeleteEvent('${ev.id}','${esc(ev.name)}')" title="Excluir festa">🗑️</button>
            </div>
        </div>`;
    }).join('');
}

function enterEvent(eventId) {
    currentEventId = eventId;
    showScreen('app');
}

function goBackToEvents() {
    currentEventId = null;
    showScreen('events');
}

function confirmDeleteEvent(eventId, eventName) {
    document.getElementById('modal-title').textContent = 'Excluir Festa';
    document.getElementById('modal-body').innerHTML = `<p>Tem certeza que deseja excluir <strong>${eventName}</strong> e todos os seus ingressos?</p>`;
    pendingModalAction = () => {
        let events = load(KEYS.EVENTS) || [];
        events = events.filter(e => e.id !== eventId);
        save(KEYS.EVENTS, events);
        localStorage.removeItem(guestsKey(eventId));
        dbRemove('guests', 'event_id', eventId);
        dbRemove('events', 'id', eventId);
        renderEvents();
        showToast('Festa excluída');
    };
    openOverlay('modal-overlay');
}

// ===== NEW EVENT MODAL =====
function openNewEventModal() {
    const users = load(KEYS.USERS) || [];
    const others = users.filter(u => u.id !== currentUser?.id);
    const container = document.getElementById('event-producers-checkboxes');
    if (others.length === 0) {
        container.innerHTML = '<p class="text-muted">Nenhum outro produtor cadastrado</p>';
    } else {
        container.innerHTML = others.map(p => {
            const roleTag = p.role === 'admin' ? ' (Admin)' : '';
            return `<div class="checkbox-producer">
                <input type="checkbox" id="ev-prod-${p.id}" value="${p.id}">
                <label for="ev-prod-${p.id}">${esc(p.name)}${roleTag}</label>
            </div>`;
        }).join('');
    }
    document.getElementById('new-event-name').value = '';
    document.getElementById('new-event-date').value = '';
    openOverlay('event-modal-overlay');
}
function closeEventModal() { closeOverlay('event-modal-overlay'); }

function doCreateEvent() {
    const name = document.getElementById('new-event-name').value.trim();
    if (!name) return;
    const date = document.getElementById('new-event-date').value;
    const checkboxes = document.querySelectorAll('#event-producers-checkboxes input[type="checkbox"]:checked');
    const producers = Array.from(checkboxes).map(cb => cb.value);
    if (currentUser && !producers.includes(currentUser.id)) producers.push(currentUser.id);
    const ev = { id: genId(), name, date, producers, createdBy: currentUser?.id, createdAt: Date.now() };
    const events = load(KEYS.EVENTS) || [];
    events.push(ev);
    save(KEYS.EVENTS, events);
    dbPush('events', toSnake(ev));
    closeEventModal();
    renderEvents();
    showToast('Festa criada!');
}

// ===== EDIT EVENT PRODUCERS =====
function openEditProducersModal() {
    if (!currentEventId) return;
    const events = load(KEYS.EVENTS) || [];
    const ev = events.find(e => e.id === currentEventId);
    if (!ev) return;
    const users = load(KEYS.USERS) || [];
    const container = document.getElementById('edit-producers-checkboxes');
    if (users.length === 0) {
        container.innerHTML = '<p class="text-muted">Nenhum produtor cadastrado</p>';
    } else {
        container.innerHTML = users.map(u => {
            const checked = ev.producers && ev.producers.includes(u.id) ? 'checked' : '';
            const roleTag = u.role === 'admin' ? ' (Admin)' : '';
            return `<div class="checkbox-producer">
                <input type="checkbox" id="ep-${u.id}" value="${u.id}" ${checked}>
                <label for="ep-${u.id}">${esc(u.name)}${roleTag}</label>
            </div>`;
        }).join('');
    }
    openOverlay('edit-producers-overlay');
}

function closeEditProducersModal() { closeOverlay('edit-producers-overlay'); }

function saveEventProducers() {
    if (!currentEventId) return;
    const events = load(KEYS.EVENTS) || [];
    const ev = events.find(e => e.id === currentEventId);
    if (!ev) return;
    const checkboxes = document.querySelectorAll('#edit-producers-checkboxes input[type="checkbox"]:checked');
    ev.producers = Array.from(checkboxes).map(cb => cb.value);
    save(KEYS.EVENTS, events);
    dbPush('events', toSnake(ev));
    closeEditProducersModal();
    showToast('Produtores atualizados!');
}

// ===== ADMIN: PRODUCERS =====
function openAdminPanel() { showScreen('admin'); }

function createProducer(e) {
    e.preventDefault();
    const username = document.getElementById('new-producer-username').value.trim();
    const name = document.getElementById('new-producer-name').value.trim();
    const email = document.getElementById('new-producer-email').value.trim().toLowerCase();
    const pass = document.getElementById('new-producer-pass').value;
    if (!username || !name || !email || !pass) return;
    const users = load(KEYS.USERS) || [];
    if (users.find(u => (u.username || u.name).toLowerCase() === username.toLowerCase())) { showToast('Nome de usuário já existe'); return; }
    if (users.find(u => u.email.toLowerCase() === email)) { showToast('E-mail já cadastrado'); return; }
    const user = { id: genId(), username, name, email, password: pass, role: 'producer', createdAt: Date.now() };
    users.push(user);
    save(KEYS.USERS, users);
    dbPush('users', toSnake(user));
    document.getElementById('new-producer-username').value = '';
    document.getElementById('new-producer-name').value = '';
    document.getElementById('new-producer-email').value = '';
    document.getElementById('new-producer-pass').value = '';
    renderProducersList();
    showToast('Produtor criado!');
}

function renderProducersList() {
    const users = load(KEYS.USERS) || [];
    const el = document.getElementById('producers-list');
    el.innerHTML = users.map(u => `<div class="producer-item">
        <div>
            <div class="producer-info-name">${esc(u.name)}</div>
            <div class="producer-info-email">@${esc(u.username || u.name)} · ${esc(u.email)}</div>
        </div>
        <div style="display:flex;align-items:center;gap:0.5rem">
            <span class="producer-role ${u.role === 'admin' ? 'role-admin' : 'role-producer'}">${u.role === 'admin' ? 'Admin' : 'Produtor'}</span>
            <button class="btn-action btn-edit" onclick="openEditProducerModal('${u.id}')" title="Editar">✏️</button>
            ${u.role !== 'admin' ? `<button class="btn-action btn-delete" onclick="deleteProducer('${u.id}')" title="Remover">🗑️</button>` : ''}
        </div>
    </div>`).join('');
}

function openEditProducerModal(id) {
    const users = load(KEYS.USERS) || [];
    const u = users.find(x => x.id === id);
    if (!u) return;
    document.getElementById('edit-producer-id').value = u.id;
    document.getElementById('edit-producer-username').value = u.username || u.name;
    document.getElementById('edit-producer-name').value = u.name;
    document.getElementById('edit-producer-email').value = u.email;
    document.getElementById('edit-producer-pass').value = '';
    openOverlay('edit-producer-overlay');
}

function closeEditProducerModal() { closeOverlay('edit-producer-overlay'); }

function saveProducerEdit() {
    const id = document.getElementById('edit-producer-id').value;
    const users = load(KEYS.USERS) || [];
    const u = users.find(x => x.id === id);
    if (!u) return;
    const newUsername = document.getElementById('edit-producer-username').value.trim();
    const newName = document.getElementById('edit-producer-name').value.trim();
    const newEmail = document.getElementById('edit-producer-email').value.trim().toLowerCase();
    const newPass = document.getElementById('edit-producer-pass').value;
    if (!newUsername || !newName || !newEmail) { showToast('Preencha todos os campos'); return; }
    const duplicate = users.find(x => x.id !== id && (x.username || x.name).toLowerCase() === newUsername.toLowerCase());
    if (duplicate) { showToast('Nome de usuário já existe'); return; }
    const emailDup = users.find(x => x.id !== id && x.email.toLowerCase() === newEmail);
    if (emailDup) { showToast('E-mail já cadastrado'); return; }
    u.username = newUsername;
    u.name = newName;
    u.email = newEmail;
    if (newPass) u.password = newPass;
    save(KEYS.USERS, users);
    dbPush('users', toSnake(u));
    closeEditProducerModal();
    renderProducersList();
    showToast('Produtor atualizado!');
}

function deleteProducer(id) {
    let users = load(KEYS.USERS) || [];
    users = users.filter(u => u.id !== id);
    save(KEYS.USERS, users);
    dbRemove('users', 'id', id);
    renderProducersList();
    showToast('Produtor removido');
}

// ===== TABS =====
function switchTab(tab) {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.tab-content').forEach(t => {
        if (t.id === 'tab-' + tab) {
            t.classList.remove('active');
            void t.offsetWidth;
            t.classList.add('active');
        } else {
            t.classList.remove('active');
        }
    });
    if (tab === 'list') renderFullList();
    if (tab === 'checkin') renderCheckinList();
    if (tab === 'dashboard') renderDashboard();
    if (tab === 'register') renderRecent();
}

// ===== GUESTS (scoped to currentEventId) =====
function getGuests() { return currentEventId ? loadGuests(currentEventId) : []; }
function setGuests(g) { if (currentEventId) saveGuests(currentEventId, g); }

function addGuest(e) {
    e.preventDefault();
    if (!currentEventId) return;
    const name = document.getElementById('guest-name').value.trim();
    const lote = document.getElementById('guest-lote').value;
    const value = parseMoneyInput(document.getElementById('guest-value').value);
    const hasDiscount = document.getElementById('guest-discount').checked;
    const discountValue = hasDiscount ? parseMoneyInput(document.getElementById('guest-discount-info').value) : 0;
    const finalValue = Math.max(0, value - discountValue);

    if (!name) return;
    const guest = { id: genId(), name, lote, value: finalValue, originalValue: value, hasDiscount, discountValue, checkedIn: false, createdAt: Date.now() };
    const guests = getGuests();
    guests.push(guest);
    setGuests(guests);

    document.getElementById('form-register').reset();
    hideDiscountField();
    updateBadge();
    renderRecent();

    const ok = await dbPush('guests', { ...toSnake(guest), event_id: currentEventId });
    if (ok) {
        showToast(`${name} registrado e sincronizado!`);
    } else {
        showToast(`${name} salvo localmente — sincroniza quando houver conexão`);
    }
}

function formatMoneyInput(el) {
    let digits = el.value.replace(/\D/g, '');
    if (!digits) { el.value = ''; return; }
    let cents = parseInt(digits, 10);
    el.value = 'R$ ' + (cents / 100).toFixed(2).replace('.', ',');
}

function parseMoneyInput(str) {
    if (!str) return 0;
    let digits = str.replace(/\D/g, '');
    return digits ? parseInt(digits, 10) / 100 : 0;
}

function formatMoney(v) { return 'R$ ' + (v || 0).toFixed(2).replace('.', ','); }

function toggleDiscountField() {
    const checked = document.getElementById('guest-discount').checked;
    const group = document.getElementById('discount-info-group');
    if (checked) {
        group.style.display = 'block';
        group.classList.remove('hidden');
        requestAnimationFrame(() => group.classList.add('visible'));
    } else {
        hideDiscountField();
    }
}
function hideDiscountField() {
    const group = document.getElementById('discount-info-group');
    group.classList.remove('visible');
    group.classList.add('hidden');
    setTimeout(() => { group.style.display = 'none'; group.classList.remove('hidden'); }, 350);
}

// ===== BADGE =====
function updateBadge() {
    const el = document.getElementById('header-count');
    const count = getGuests().length;
    el.textContent = count;
    el.classList.add('pop');
    setTimeout(() => el.classList.remove('pop'), 300);
}

// ===== RECENT =====
function renderRecent() {
    const guests = getGuests();
    const card = document.getElementById('recent-card');
    const list = document.getElementById('recent-list');
    const recent = guests.slice().sort((a, b) => b.createdAt - a.createdAt).slice(0, 5);
    if (recent.length === 0) { card.style.display = 'none'; return; }
    card.style.display = 'block';
    list.innerHTML = recent.map(g => `<div class="recent-item">
        <div>
            <div class="recent-name">${esc(g.name)}</div>
            <div class="recent-detail">${esc(g.lote)}${g.hasDiscount && g.discountValue ? ` · -${formatMoney(g.discountValue)}` : ''}</div>
        </div>
        <span class="recent-value">${formatMoney(g.value)}</span>
    </div>`).join('');
}

// ===== FULL LIST =====
function renderFullList() {
    const guests = getGuests();
    const search = (document.getElementById('search-list')?.value || '').toLowerCase();
    const clearBtn = document.getElementById('btn-clear-list');
    if (clearBtn) clearBtn.style.display = search ? 'flex' : 'none';
    const filtered = guests.filter(g => g.name.toLowerCase().includes(search));
    const sorted = filtered.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    document.getElementById('list-count').textContent = `${filtered.length} ingresso${filtered.length !== 1 ? 's' : ''}`;
    const listEl = document.getElementById('full-list');
    const emptyEl = document.getElementById('empty-list');
    if (sorted.length === 0) { listEl.innerHTML = ''; emptyEl.style.display = 'block'; return; }
    emptyEl.style.display = 'none';

    let html = '';
    let lastLetter = '';
    sorted.forEach(g => {
        const letter = g.name.charAt(0).toUpperCase();
        if (letter !== lastLetter) { html += `<div class="letter-header">${letter}</div>`; lastLetter = letter; }
        html += guestItemHTML(g, 'list');
    });
    listEl.innerHTML = html;
}

function guestItemHTML(g, context) {
    const discountTag = g.hasDiscount && g.discountValue ? `<span class="discount-badge">-${formatMoney(g.discountValue)}</span>` : '';
    const badges = `<span class="lote-badge">${esc(g.lote)}</span>${discountTag}`;
    const avatar = g.name.charAt(0).toUpperCase();
    const checkedClass = g.checkedIn ? ' checked-in' : '';
    let actions = '';
    if (context === 'list') {
        actions = `<button class="btn-action btn-edit" onclick="openEditModal('${g.id}')" title="Editar">✏️</button>
                   <button class="btn-action btn-delete" onclick="confirmDelete('${g.id}')" title="Remover">🗑️</button>`;
    } else if (context === 'checkin') {
        actions = g.checkedIn
            ? `<button class="btn-action btn-checkin done" onclick="toggleCheckin('${g.id}')" title="Desfazer">✅</button>`
            : `<button class="btn-action btn-checkin" onclick="toggleCheckin('${g.id}')" title="Check-in">⬜</button>`;
    }
    return `<div class="guest-item${checkedClass}" id="guest-${g.id}">
        <div class="guest-avatar">${avatar}</div>
        <div class="guest-info">
            <div class="guest-name">${esc(g.name)}</div>
            <div class="guest-meta">${formatMoney(g.value)} · ${badges}</div>
        </div>
        <div class="guest-actions">${actions}</div>
    </div>`;
}

// ===== CHECKIN =====
function renderCheckinList() {
    const guests = getGuests();
    const search = (document.getElementById('search-checkin')?.value || '').toLowerCase();
    const clearBtn = document.getElementById('btn-clear-checkin');
    if (clearBtn) clearBtn.style.display = search ? 'flex' : 'none';

    const allPending = guests.filter(g => !g.checkedIn);
    const allDone = guests.filter(g => g.checkedIn);

    const doneEl = document.getElementById('checkin-done');
    const pendEl = document.getElementById('checkin-pending');
    if (doneEl) doneEl.textContent = allDone.length;
    if (pendEl) pendEl.textContent = allPending.length;

    const pendingFiltered = (search ? allPending.filter(g => g.name.toLowerCase().includes(search)) : allPending)
        .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    const doneFiltered = (search ? allDone.filter(g => g.name.toLowerCase().includes(search)) : allDone)
        .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

    const listEl = document.getElementById('checkin-list');
    const doneSection = document.getElementById('checkin-done-section');
    const doneListEl = document.getElementById('checkin-done-list');
    const emptyEl = document.getElementById('empty-checkin');

    if (pendingFiltered.length === 0 && doneFiltered.length === 0) {
        listEl.innerHTML = '';
        doneSection.style.display = 'none';
        emptyEl.style.display = 'block';
        return;
    }
    emptyEl.style.display = 'none';
    listEl.innerHTML = pendingFiltered.map(g => guestItemHTML(g, 'checkin')).join('');

    if (doneFiltered.length > 0) {
        doneSection.style.display = 'block';
        doneListEl.innerHTML = doneFiltered.map(g => guestItemHTML(g, 'checkin')).join('');
    } else {
        doneSection.style.display = 'none';
    }
}

function toggleCheckin(id) {
    const guests = getGuests();
    const g = guests.find(x => x.id === id);
    if (!g) return;
    g.checkedIn = !g.checkedIn;
    setGuests(guests);
    dbPush('guests', { ...toSnake(g), event_id: currentEventId });
    renderCheckinList();
    updateBadge();
    bumpStat('checkin-done');
    bumpStat('checkin-pending');
}

function bumpStat(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.add('bump');
    setTimeout(() => el.classList.remove('bump'), 300);
}

// ===== SEARCH CLEAR =====
function clearSearch(inputId, callback) {
    const input = document.getElementById(inputId);
    if (input) { input.value = ''; input.focus(); }
    if (callback) callback();
}

// ===== EDIT =====
function openEditModal(id) {
    const guests = getGuests();
    const g = guests.find(x => x.id === id);
    if (!g) return;
    document.getElementById('edit-id').value = g.id;
    document.getElementById('edit-name').value = g.name;
    document.getElementById('edit-lote').value = g.lote;
    const editVal = g.originalValue || g.value;
    document.getElementById('edit-value').value = 'R$ ' + editVal.toFixed(2).replace('.', ',');
    document.getElementById('edit-discount').checked = g.hasDiscount;
    document.getElementById('edit-discount-info').value = g.discountValue ? 'R$ ' + g.discountValue.toFixed(2).replace('.', ',') : '';
    openOverlay('edit-overlay');
}
function closeEditModal() { closeOverlay('edit-overlay'); }

function saveEdit() {
    const id = document.getElementById('edit-id').value;
    const guests = getGuests();
    const g = guests.find(x => x.id === id);
    if (!g) return;
    g.name = document.getElementById('edit-name').value.trim();
    g.lote = document.getElementById('edit-lote').value;
    const rawValue = parseMoneyInput(document.getElementById('edit-value').value);
    g.hasDiscount = document.getElementById('edit-discount').checked;
    g.discountValue = g.hasDiscount ? parseMoneyInput(document.getElementById('edit-discount-info').value) : 0;
    g.originalValue = rawValue;
    g.value = Math.max(0, rawValue - g.discountValue);
    setGuests(guests);
    dbPush('guests', { ...toSnake(g), event_id: currentEventId });
    closeEditModal();
    renderFullList();
    renderDashboard();
    updateBadge();
    showToast('Ingresso atualizado!');
}

// ===== DELETE =====
let pendingModalAction = null;

function confirmDelete(id) {
    const guests = getGuests();
    const g = guests.find(x => x.id === id);
    if (!g) return;
    document.getElementById('modal-title').textContent = 'Remover Ingresso';
    document.getElementById('modal-body').innerHTML = `<p>Tem certeza que deseja remover <strong>${esc(g.name)}</strong>?</p>`;
    pendingModalAction = () => {
        const gs = getGuests().filter(x => x.id !== id);
        setGuests(gs);
        dbRemove('guests', 'id', id);
        renderFullList();
        updateBadge();
        showToast('Ingresso removido');
    };
    openOverlay('modal-overlay');
}

function confirmClearAll() {
    document.getElementById('modal-title').textContent = 'Limpar Todos os Dados';
    document.getElementById('modal-body').innerHTML = `<p>Isso removerá <strong>todos os ingressos</strong> desta festa. Tem certeza?</p>`;
    pendingModalAction = () => {
        setGuests([]);
        dbRemove('guests', 'event_id', currentEventId);
        renderFullList();
        renderCheckinList();
        renderDashboard();
        updateBadge();
        showToast('Todos os dados foram limpos');
    };
    openOverlay('modal-overlay');
}

function modalConfirmAction() {
    if (pendingModalAction) pendingModalAction();
    pendingModalAction = null;
    closeModal();
}
function closeModal() { closeOverlay('modal-overlay'); }

// ===== OVERLAY HELPERS =====
function openOverlay(id) {
    const el = document.getElementById(id);
    el.style.display = 'flex';
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));
}
function closeOverlay(id) {
    const el = document.getElementById(id);
    el.classList.remove('show');
    setTimeout(() => { el.style.display = 'none'; }, 300);
}

// ===== DASHBOARD =====
function renderDashboard() {
    const guests = getGuests();
    const total = guests.length;
    const revenue = guests.reduce((s, g) => s + g.value, 0);
    const checked = guests.filter(g => g.checkedIn).length;
    document.getElementById('stat-total').textContent = total;
    document.getElementById('stat-revenue').textContent = formatMoney(revenue);
    document.getElementById('stat-checkedin').textContent = checked;
    document.getElementById('stat-pending').textContent = total - checked;

    const lotes = {};
    guests.forEach(g => { lotes[g.lote] = (lotes[g.lote] || 0) + 1; });
    const breakdown = document.getElementById('lote-breakdown');
    const entries = Object.entries(lotes).sort((a, b) => b[1] - a[1]);
    breakdown.innerHTML = entries.length === 0
        ? '<p class="text-muted" style="text-align:center;padding:1rem">Nenhum dado ainda</p>'
        : entries.map(([name, count]) => `<div class="lote-row"><span class="lote-row-name">${esc(name)}</span><span class="lote-row-count">${count}</span></div>`).join('');
}

// ===== EXPORT =====
function exportList() {
    const guests = getGuests();
    if (guests.length === 0) { showToast('Nenhum ingresso para exportar'); return; }
    const events = load(KEYS.EVENTS) || [];
    const ev = events.find(e => e.id === currentEventId);
    const evName = ev ? ev.name : 'Festa';
    const sorted = guests.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    let text = `📋 ${evName} — Lista de Ingressos\n${'─'.repeat(30)}\n\n`;
    sorted.forEach((g, i) => {
        text += `${i + 1}. ${g.name}\n   ${g.lote} · ${formatMoney(g.value)}${g.hasDiscount ? ` · Desconto: ${g.discountInfo}` : ''}${g.checkedIn ? ' ✅' : ''}\n\n`;
    });
    text += `${'─'.repeat(30)}\nTotal: ${guests.length} ingressos · ${formatMoney(guests.reduce((s, g) => s + g.value, 0))}`;
    if (navigator.share) {
        navigator.share({ title: evName, text }).catch(() => copyText(text));
    } else {
        copyText(text);
    }
}

function shareWhatsApp() {
    const guests = getGuests();
    if (guests.length === 0) { showToast('Nenhum dado para compartilhar'); return; }
    const events = load(KEYS.EVENTS) || [];
    const ev = events.find(e => e.id === currentEventId);
    const evName = ev ? ev.name : 'Festa';
    const sorted = guests.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    let text = `🎫 *${evName}*\n${sorted.length} ingressos\n\n`;
    sorted.forEach((g, i) => { text += `${i + 1}. ${g.name} — ${g.lote} (${formatMoney(g.value)})${g.checkedIn ? ' ✅' : ''}\n`; });
    window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
}

function copyText(text) {
    navigator.clipboard.writeText(text).then(() => showToast('Copiado!')).catch(() => showToast('Erro ao copiar'));
}

// ===== TOAST =====
let toastTimer = null;
function showToast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('visible'), 2500);
}

// ===== UTILS =====
function esc(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ===== FLOATING LOGOS =====
function createFloatingLogos() {
    const container = document.getElementById('floating-logos');
    if (!container) return;
    container.innerHTML = '';
    const count = 35;
    for (let i = 0; i < count; i++) {
        const img = document.createElement('img');
        img.src = 'logo.png';
        img.className = 'float-logo';
        img.alt = '';
        const size = 30 + Math.random() * 50;
        const left = Math.random() * 100;
        const top = Math.random() * 100;
        const duration = 18 + Math.random() * 25;
        const delay = -(Math.random() * duration);
        const rng = () => (Math.random() - 0.5) * 2;
        img.style.cssText = `
            width:${size}px; left:${left}%; top:${top}%;
            --dx1:${rng() * 80}px; --dy1:${rng() * 80}px; --r1:${rng() * 15}deg; --s1:${0.85 + Math.random() * 0.3};
            --dx2:${rng() * 100}px; --dy2:${rng() * 100}px; --r2:${rng() * 20}deg;
            --dx3:${rng() * 80}px; --dy3:${rng() * 80}px; --r3:${rng() * 15}deg;
            animation: floatDrift ${duration}s ${delay}s ease-in-out infinite;
        `;
        container.appendChild(img);
    }
}

// ===== SERVICE WORKER =====
function registerSW() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js').catch(() => {});
    }
}

// ===== ADMIN TABS =====
function switchAdminTab(tab) {
    document.querySelectorAll('#screen-admin .nav-btn').forEach(b => b.classList.toggle('active', b.dataset.admintab === tab));
    document.querySelectorAll('.admin-tab').forEach(t => {
        if (t.id === 'tab-' + tab) {
            t.classList.remove('active');
            void t.offsetWidth;
            t.classList.add('active');
        } else {
            t.classList.remove('active');
        }
    });
    if (tab === 'admin-list') renderProducersList();
}

// ===== SWIPE TABS =====
const TABS = ['register', 'list', 'checkin', 'dashboard'];
let swipeStartX = 0;
let swipeStartY = 0;
let swiping = false;

function getCurrentTab() {
    const active = document.querySelector('.nav-btn.active');
    return active ? active.dataset.tab : 'register';
}

function initSwipe() {
    const appScreen = document.getElementById('screen-app');
    if (!appScreen) return;
    appScreen.addEventListener('touchstart', (e) => {
        swipeStartX = e.touches[0].clientX;
        swipeStartY = e.touches[0].clientY;
        swiping = true;
    }, { passive: true });

    appScreen.addEventListener('touchend', (e) => {
        if (!swiping) return;
        swiping = false;
        const dx = e.changedTouches[0].clientX - swipeStartX;
        const dy = e.changedTouches[0].clientY - swipeStartY;
        if (Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx)) return;
        const cur = TABS.indexOf(getCurrentTab());
        if (dx < 0 && cur < TABS.length - 1) switchTab(TABS[cur + 1]);
        else if (dx > 0 && cur > 0) switchTab(TABS[cur - 1]);
    }, { passive: true });
}

// ===== BOOT =====
document.addEventListener('DOMContentLoaded', async () => {
    initSupabase();
    createFloatingLogos();
    registerSW();
    initSwipe();

    await cloudMigrate();
    await cloudPull();
    await processQueue();

    ensureAdmin();

    if (restoreSession()) {
        showScreen('events');
    } else {
        showScreen('login');
    }

    setInterval(processQueue, 30000);
});
