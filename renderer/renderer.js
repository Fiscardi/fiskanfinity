const API = 'http://localhost:8420';
let profiles = [];
let activeProfileId = null;
let maxProfiles = 5;
let saveTimers = {};

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2200);
}

async function api(path, opts) {
  const res = await fetch(API + path, Object.assign({
    headers: { 'Content-Type': 'application/json' }
  }, opts));
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Error' }));
    throw new Error(err.error || 'Error de red');
  }
  return res.json();
}

function activeProfile() {
  return profiles.find(p => p.id === activeProfileId);
}

// ---------- Perfiles (sidebar) ----------
function renderProfiles() {
  const list = document.getElementById('profileList');
  list.innerHTML = '';
  profiles.forEach((p, idx) => {
    const tab = document.createElement('div');
    tab.className = 'profile-tab' + (p.id === activeProfileId ? ' active' : '');
    tab.innerHTML = `<span class="n">P${idx + 1}</span>
      <input value="${escapeHtml(p.name)}" data-id="${p.id}" />
      <button class="small ghost danger" data-remove="${p.id}" title="Eliminar" ${profiles.length <= 1 ? 'disabled style="opacity:.3"' : ''}>✕</button>`;
    tab.querySelector('input').addEventListener('click', e => e.stopPropagation());
    tab.querySelector('input').addEventListener('change', e => renameProfile(p.id, e.target.value));
    tab.querySelector('[data-remove]').addEventListener('click', e => {
      e.stopPropagation();
      removeProfile(p.id);
    });
    tab.addEventListener('click', () => activateProfile(p.id));
    list.appendChild(tab);
  });
  document.getElementById('addProfileBtn').disabled = profiles.length >= maxProfiles;
  document.getElementById('slotCount').textContent = `${profiles.length} / ${maxProfiles} perfiles`;
}

async function loadProfiles() {
  const data = await api('/api/profiles');
  profiles = data.profiles;
  activeProfileId = data.activeProfileId;
  maxProfiles = data.max;
  renderProfiles();
  renderCards();
  renderActionsAndEvents();
}

async function activateProfile(id) {
  activeProfileId = id;
  renderProfiles();
  renderCards();
  renderActionsAndEvents();
  await api(`/api/profiles/${id}/activate`, { method: 'POST' });
}

async function renameProfile(id, name) {
  await api(`/api/profiles/${id}`, { method: 'PUT', body: JSON.stringify({ name }) });
  await loadProfiles();
}

async function removeProfile(id) {
  if (!confirm('¿Eliminar este perfil?')) return;
  try {
    await api(`/api/profiles/${id}`, { method: 'DELETE' });
    await loadProfiles();
  } catch (err) { toast(err.message); }
}

document.getElementById('addProfileBtn').addEventListener('click', async () => {
  try {
    await api('/api/profiles', { method: 'POST', body: JSON.stringify({}) });
    await loadProfiles();
  } catch (err) { toast(err.message); }
});

// ---------- Guardado de config con debounce ----------
function scheduleSave(profileId, overlayKey, patch) {
  const profile = profiles.find(p => p.id === profileId);
  Object.assign(profile.overlays[overlayKey], patch);
  clearTimeout(saveTimers[profileId]);
  saveTimers[profileId] = setTimeout(async () => {
    try {
      await api(`/api/profiles/${profileId}`, {
        method: 'PUT',
        body: JSON.stringify({ overlays: { [overlayKey]: profile.overlays[overlayKey] } })
      });
    } catch (err) { toast(err.message); }
  }, 400);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- Tarjetas de overlays ----------
function overlayUrl(name) {
  return `${API}/overlay/${name}.html`;
}

function cardShell(icon, title, overlayKey, profile, bodyHtml, urlName) {
  const cfg = profile.overlays[overlayKey];
  return `
  <div class="card" data-card="${overlayKey}">
    <div class="card-head">
      <span class="led ${cfg.enabled ? 'on' : ''}"></span>
      <div class="card-title">${title}</div>
      <button class="switch ${cfg.enabled ? 'on' : ''}" data-toggle="${overlayKey}"></button>
    </div>
    ${bodyHtml}
    <div class="url-row">
      <code>${overlayUrl(urlName)}</code>
      <button class="small" data-copy="${overlayUrl(urlName)}">Copiar URL</button>
    </div>
  </div>`;
}

function renderCards() {
  const profile = activeProfile();
  if (!profile) return;
  const grid = document.getElementById('cardsGrid');

  const alert = profile.overlays.alert;
  const alertBody = `
    <div class="field-row"><span>Regalos</span><button class="switch small ${alert.showGifts ? 'on' : ''}" data-field="alert.showGifts" data-bool="1"></button></div>
    <div class="field-row"><span>Seguidores nuevos</span><button class="switch small ${alert.showFollows ? 'on' : ''}" data-field="alert.showFollows" data-bool="1"></button></div>
    <div class="field-row"><span>Suscripciones</span><button class="switch small ${alert.showSubs ? 'on' : ''}" data-field="alert.showSubs" data-bool="1"></button></div>
    <div class="field-row"><span>Hitos de likes</span><button class="switch small ${alert.showLikeMilestones ? 'on' : ''}" data-field="alert.showLikeMilestones" data-bool="1"></button></div>
    <div class="field-row"><span>Diamantes mínimos</span><input type="number" min="1" value="${alert.minDiamonds}" data-field="alert.minDiamonds" data-num="1" /></div>
    <div class="field-row"><span>Duración (ms)</span><input type="number" min="1000" step="500" value="${alert.duration}" data-field="alert.duration" data-num="1" /></div>`;

  const goal = profile.overlays.goal;
  const pct = Math.min(100, Math.round((goal.current / (goal.target || 1)) * 100));
  const goalBody = `
    <div class="field-row"><span>Título</span><input type="text" value="${escapeHtml(goal.label)}" data-field="goal.label" /></div>
    <div class="field-row"><span>Meta (💎)</span><input type="number" min="1" value="${goal.target}" data-field="goal.target" data-num="1" /></div>
    <div class="goal-bar"><div style="width:${pct}%"></div></div>
    <div class="goal-numbers"><span>${goal.current} 💎</span><span>${pct}%</span></div>
    <div class="card-actions"><button class="small" data-reset-goal="1">Reiniciar meta</button></div>`;

  const ranking = profile.overlays.ranking;
  const rankingBody = `
    <div class="field-row"><span>Título</span><input type="text" value="${escapeHtml(ranking.title)}" data-field="ranking.title" /></div>
    <div class="field-row"><span>Máx. de puestos</span><input type="number" min="1" max="10" value="${ranking.maxEntries}" data-field="ranking.maxEntries" data-num="1" /></div>
    <div class="field-row"><span>Reiniciar al conectar</span><button class="switch small ${ranking.resetOnConnect ? 'on' : ''}" data-field="ranking.resetOnConnect" data-bool="1"></button></div>`;

  const counter = profile.overlays.counter;
  const counterBody = `
    <div class="field-row"><span>Mostrar likes</span><button class="switch small ${counter.showLikes ? 'on' : ''}" data-field="counter.showLikes" data-bool="1"></button></div>
    <div class="field-row"><span>Mostrar espectadores</span><button class="switch small ${counter.showViewers ? 'on' : ''}" data-field="counter.showViewers" data-bool="1"></button></div>`;

  grid.innerHTML =
    cardShell('🎁', 'Alertas', 'alert', profile, alertBody, 'alert') +
    cardShell('🎯', 'Barra de meta', 'goal', profile, goalBody, 'goal') +
    cardShell('🏆', 'Top regalos', 'ranking', profile, rankingBody, 'ranking') +
    cardShell('📊', 'Contador en vivo', 'counter', profile, counterBody, 'counter') +
    eventsCard();

  wireCardEvents(profile);
  wireEventsCard();
}

function eventsCard() {
  return `
  <div class="card wide" id="eventsCard">
    <div class="card-head">
      <span class="led on"></span>
      <div class="card-title">Eventos y pruebas</div>
    </div>
    <p class="hint">Simulá eventos para chequear que las alertas y overlays reaccionen bien, sin necesidad de estar en vivo.</p>

    <div class="test-grid">
      <div class="test-form">
        <div class="field-row"><span>Usuario</span><input type="text" id="testUser" value="Usuario_Prueba" /></div>
        <div class="field-row"><span>Regalo</span><input type="text" id="testGift" value="Rosa" /></div>
        <div class="field-row"><span>Cantidad</span><input type="number" id="testCount" value="5" min="1" /></div>
        <div class="field-row"><span>Diamantes</span><input type="number" id="testDiamonds" value="5" min="1" /></div>
        <div class="field-row"><span>Sumar a meta y ranking</span><button class="switch small" id="testAffect"></button></div>
        <button class="primary" id="sendTestGift" style="width:100%; margin-top:4px;">🎁 Enviar regalo de prueba</button>
      </div>
      <div class="test-quick">
        <button data-quick="follow">➕ Probar seguidor nuevo</button>
        <button data-quick="sub">⭐ Probar suscripción</button>
        <button data-quick="likeMilestone">❤️ Probar hito de likes</button>
        <button data-quick="likes">📈 Simular tanda de likes</button>
        <button data-quick="viewers">👀 Simular espectadores</button>
        <button data-quick="clearlog" class="ghost">🧹 Limpiar log</button>
      </div>
    </div>

    <div class="event-log" id="eventLog">
      <div class="log-empty">Los eventos que vayan llegando (reales o de prueba) van a aparecer acá.</div>
    </div>
  </div>`;
}

let eventLogEntries = [];
function pushLog(icon, label, detail) {
  const time = new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  eventLogEntries.unshift({ time, icon, label, detail });
  eventLogEntries = eventLogEntries.slice(0, 40);
  renderLog();
}

function renderLog() {
  const box = document.getElementById('eventLog');
  if (!box) return;
  if (eventLogEntries.length === 0) {
    box.innerHTML = '<div class="log-empty">Los eventos que vayan llegando (reales o de prueba) van a aparecer acá.</div>';
    return;
  }
  box.innerHTML = eventLogEntries.map(e => `
    <div class="log-row">
      <span class="log-time mono">${e.time}</span>
      <span class="log-icon">${e.icon}</span>
      <span class="log-label">${escapeHtml(e.label)}</span>
      <span class="log-detail">${escapeHtml(e.detail || '')}</span>
    </div>`).join('');
}

function wireEventsCard() {
  const affectBtn = document.getElementById('testAffect');
  if (affectBtn) affectBtn.addEventListener('click', () => affectBtn.classList.toggle('on'));

  const sendGiftBtn = document.getElementById('sendTestGift');
  if (sendGiftBtn) {
    sendGiftBtn.addEventListener('click', async () => {
      const body = {
        user: document.getElementById('testUser').value,
        gift: document.getElementById('testGift').value,
        count: document.getElementById('testCount').value,
        diamonds: document.getElementById('testDiamonds').value,
        affectGoalAndRanking: document.getElementById('testAffect').classList.contains('on')
      };
      await api('/api/test-alert/gift', { method: 'POST', body: JSON.stringify(body) });
    });
  }

  document.querySelectorAll('[data-quick]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const kind = btn.dataset.quick;
      if (kind === 'clearlog') {
        eventLogEntries = [];
        renderLog();
        return;
      }
      if (kind === 'likes') {
        await api('/api/test-counter/likes', { method: 'POST', body: JSON.stringify({}) });
        return;
      }
      if (kind === 'viewers') {
        await api('/api/test-counter/viewers', { method: 'POST', body: JSON.stringify({}) });
        return;
      }
      await api(`/api/test-alert/${kind}`, { method: 'POST', body: JSON.stringify({}) });
    });
  });
}

function wireCardEvents(profile) {
  document.querySelectorAll('[data-toggle]').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.toggle;
      const newVal = !profile.overlays[key].enabled;
      scheduleSave(profile.id, key, { enabled: newVal });
      renderCards();
    });
  });

  document.querySelectorAll('[data-field]').forEach(el => {
    const [group, prop] = el.dataset.field.split('.');
    const isBool = el.dataset.bool;
    const isNum = el.dataset.num;
    const handler = () => {
      let val;
      if (isBool) {
        val = !profile.overlays[group][prop];
      } else if (isNum) {
        val = Number(el.value);
      } else {
        val = el.value;
      }
      scheduleSave(profile.id, group, { [prop]: val });
      if (isBool) renderCards();
      else if (group === 'goal') renderCards();
    };
    if (isBool) el.addEventListener('click', handler);
    else el.addEventListener('change', handler);
  });

  document.querySelectorAll('[data-copy]').forEach(btn => {
    btn.addEventListener('click', () => {
      navigator.clipboard.writeText(btn.dataset.copy);
      toast('URL copiada — pegala como Browser Source en OBS');
    });
  });

  document.querySelectorAll('[data-test]').forEach(btn => {
    btn.addEventListener('click', () => api(`/api/test-alert/${btn.dataset.test}`, { method: 'POST' }));
  });

  const resetGoalBtn = document.querySelector('[data-reset-goal]');
  if (resetGoalBtn) {
    resetGoalBtn.addEventListener('click', async () => {
      await api(`/api/profiles/${profile.id}/goal/reset`, { method: 'POST' });
      await loadProfiles();
      toast('Meta reiniciada');
    });
  }
}

// ---------- Conexión a TikTok ----------
function setOnAir(status) {
  const el = document.getElementById('onair');
  const text = document.getElementById('onairText');
  const btn = document.getElementById('connectBtn');
  if (status.connected) {
    el.classList.add('live');
    text.textContent = `EN VIVO — @${status.username}`;
    btn.textContent = 'Desconectar';
  } else if (status.connecting) {
    el.classList.remove('live');
    text.textContent = `Conectando a @${status.username}…`;
    btn.textContent = 'Conectando…';
  } else {
    el.classList.remove('live');
    text.textContent = status.error ? `Error: ${status.error}` : 'Desconectado';
    btn.textContent = 'Conectar';
  }
}

document.getElementById('connectForm').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = document.getElementById('connectBtn');
  if (btn.textContent === 'Desconectar') {
    await api('/api/disconnect', { method: 'POST' });
    return;
  }
  const username = document.getElementById('usernameInput').value.trim();
  if (!username) return;
  try {
    await api('/api/connect', { method: 'POST', body: JSON.stringify({ username }) });
  } catch (err) {
    toast(err.message);
  }
});

// ---------- WebSocket para estado en vivo ----------
function connectWs() {
  const ws = new WebSocket('ws://localhost:8420/ws');
  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'status') setOnAir(msg.payload);
    if (msg.type === 'goal') {
      const p = activeProfile();
      if (p) { p.overlays.goal = msg.payload; renderCards(); }
    }
    if (msg.type === 'gifts') {
      giftsCatalog = msg.payload.gifts;
      giftsSource = msg.payload.source;
    }
    logIncoming(msg);
  };
  ws.onclose = () => setTimeout(connectWs, 1500);
}

function logIncoming(msg) {
  switch (msg.type) {
    case 'alert': {
      const icons = { gift: '🎁', follow: '➕', sub: '⭐', likeMilestone: '❤️' };
      pushLog(icons[msg.payload.kind] || '✨', 'Alerta: ' + msg.payload.kind, msg.payload.text || '');
      break;
    }
    case 'goal':
      pushLog('🎯', 'Meta actualizada', `${msg.payload.current} / ${msg.payload.target} 💎`);
      break;
    case 'ranking':
      if (Array.isArray(msg.payload) && msg.payload.length) {
        pushLog('🏆', 'Ranking actualizado', msg.payload.map(r => `${r.user} (${r.diamonds}💎)`).join(', '));
      }
      break;
    case 'likes':
      pushLog('❤️', 'Likes', `total ${msg.payload.total}`);
      break;
    case 'viewers':
      pushLog('👀', 'Espectadores', `${msg.payload.count}`);
      break;
    case 'status':
      if (msg.payload.connected) pushLog('🟢', 'Conectado', '@' + msg.payload.username);
      else if (msg.payload.error) pushLog('🔴', 'Estado', msg.payload.error);
      break;
    default:
      break;
  }
}

// ---------- Pestañas ----------
document.getElementById('tabOverlays').addEventListener('click', () => switchTab('overlays'));
document.getElementById('tabActions').addEventListener('click', () => switchTab('actions'));
function switchTab(tab) {
  document.getElementById('tabOverlays').classList.toggle('active', tab === 'overlays');
  document.getElementById('tabActions').classList.toggle('active', tab === 'actions');
  document.getElementById('cardsGrid').style.display = tab === 'overlays' ? 'grid' : 'none';
  document.getElementById('actionsView').style.display = tab === 'actions' ? 'grid' : 'none';
}

// ---------- Acciones (librería) ----------
function renderActionsAndEvents() {
  const profile = activeProfile();
  if (!profile) return;
  renderActionsList(profile);
  renderEventsTable(profile);
}

function renderActionsList(profile) {
  const list = document.getElementById('actionsList');
  if (profile.actions.length === 0) {
    list.innerHTML = '<p class="av-hint">Todavía no creaste ninguna acción.</p>';
    return;
  }
  list.innerHTML = profile.actions.map(a => `
    <div class="action-card" data-action-id="${a.id}">
      <div class="ac-top">
        <input class="ac-name" type="text" value="${escapeHtml(a.name)}" data-a-field="name" />
        <button class="small ghost danger" data-a-remove="${a.id}">✕</button>
      </div>
      <div class="field-row"><span>Texto (usá {user})</span><input type="text" value="${escapeHtml(a.text)}" data-a-field="text" /></div>
      <div class="field-row"><span>Sonido (URL .mp3, opcional)</span><input type="text" value="${escapeHtml(a.soundUrl || '')}" data-a-field="soundUrl" placeholder="https://..." /></div>
      <div class="ac-row2">
        <input type="color" value="${a.accentColor}" data-a-field="accentColor" title="Color" />
        <input type="number" min="1000" step="500" value="${a.duration}" data-a-field="duration" title="Duración (ms)" />
        <button class="small" data-a-test="${a.id}">Probar</button>
      </div>
    </div>`).join('');

  list.querySelectorAll('[data-a-field]').forEach(el => {
    const card = el.closest('.action-card');
    const actionId = card.dataset.actionId;
    const field = el.dataset.aField;
    const isNum = el.type === 'number';
    const handler = () => saveAction(profile.id, actionId, { [field]: isNum ? Number(el.value) : el.value });
    el.addEventListener(el.type === 'color' || isNum ? 'change' : 'change', handler);
  });
  list.querySelectorAll('[data-a-remove]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('¿Eliminar esta acción? Los eventos que la usan quedarán sin acción.')) return;
      await api(`/api/profiles/${profile.id}/actions/${btn.dataset.aRemove}`, { method: 'DELETE' });
      await loadProfiles();
      renderActionsAndEvents();
    });
  });
  list.querySelectorAll('[data-a-test]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const action = profile.actions.find(a => a.id === btn.dataset.aTest);
      await api(`/api/profiles/${profile.id}/events`, { method: 'POST', body: JSON.stringify({ triggerType: 'follow', actionId: action.id }) })
        .then(async ev => {
          await api(`/api/profiles/${profile.id}/events/${ev.id}/test`, { method: 'POST' });
          await api(`/api/profiles/${profile.id}/events/${ev.id}`, { method: 'DELETE' });
        });
    });
  });
}

let actionSaveTimers = {};
function saveAction(profileId, actionId, patch) {
  const profile = profiles.find(p => p.id === profileId);
  const action = profile.actions.find(a => a.id === actionId);
  Object.assign(action, patch);
  clearTimeout(actionSaveTimers[actionId]);
  actionSaveTimers[actionId] = setTimeout(async () => {
    try {
      await api(`/api/profiles/${profileId}/actions/${actionId}`, { method: 'PUT', body: JSON.stringify(patch) });
      renderEventsTable(profile); // por si cambió el nombre, refresca los selects
    } catch (err) { toast(err.message); }
  }, 400);
}

document.getElementById('addActionBtn').addEventListener('click', async () => {
  const profile = activeProfile();
  await api(`/api/profiles/${profile.id}/actions`, { method: 'POST', body: JSON.stringify({}) });
  await loadProfiles();
  renderActionsAndEvents();
});

// ---------- Eventos (tabla de disparadores) ----------
const triggerLabels = { gift: 'Regalo', like: 'Likes', follow: 'Follow', subscribe: 'Suscripción' };

function renderEventsTable(profile) {
  const body = document.getElementById('eventsBody');
  if (profile.events.length === 0) {
    body.innerHTML = `<tr><td colspan="4" class="av-hint">Todavía no creaste ningún evento.</td></tr>`;
    return;
  }
  body.innerHTML = profile.events.map(ev => `
    <tr data-event-id="${ev.id}">
      <td><button class="switch small ${ev.enabled ? 'on' : ''}" data-e-toggle="1" title="Activo"></button></td>
      <td>
        <div class="trigger-cell">
          <select data-e-field="triggerType">
            ${Object.entries(triggerLabels).map(([v, l]) => `<option value="${v}" ${ev.triggerType === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
          ${ev.triggerType === 'gift' ? `
            <button class="gift-picker-btn" data-e-gift-picker="1">
              ${giftThumbHtml(ev.giftName)}<span>${ev.giftName ? escapeHtml(ev.giftName) : 'Cualquier regalo'}</span>
            </button>
            <input type="number" min="1" value="${ev.minCoins}" data-e-field="minCoins" title="Monedas mínimas" />` : ''}
          ${ev.triggerType === 'like' ? `
            <input type="number" min="1" value="${ev.minLikes}" data-e-field="minLikes" title="Likes mínimos" />` : ''}
        </div>
      </td>
      <td>
        <select data-e-field="actionId">
          <option value="">— sin acción —</option>
          ${profile.actions.map(a => `<option value="${a.id}" ${ev.actionId === a.id ? 'selected' : ''}>${escapeHtml(a.name)}</option>`).join('')}
        </select>
      </td>
      <td>
        <div class="row-actions">
          <button class="small" data-e-test="1" ${!ev.actionId ? 'disabled' : ''}>Probar</button>
          <button class="small ghost danger" data-e-remove="1">✕</button>
        </div>
      </td>
    </tr>`).join('');

  body.querySelectorAll('tr').forEach(row => {
    const eventId = row.dataset.eventId;

    row.querySelector('[data-e-toggle]').addEventListener('click', () => {
      const ev = profile.events.find(e => e.id === eventId);
      saveEvent(profile.id, eventId, { enabled: !ev.enabled });
    });

    row.querySelectorAll('[data-e-field]').forEach(el => {
      el.addEventListener('change', () => {
        const field = el.dataset.eField;
        const val = el.tagName === 'SELECT' && field === 'actionId' ? (el.value || null) : (el.type === 'number' ? Number(el.value) : el.value);
        saveEvent(profile.id, eventId, { [field]: val }, field === 'triggerType');
      });
    });

    const giftPickerBtn = row.querySelector('[data-e-gift-picker]');
    if (giftPickerBtn) giftPickerBtn.addEventListener('click', () => openGiftModal(profile.id, eventId));

    const testBtn = row.querySelector('[data-e-test]');
    if (testBtn) testBtn.addEventListener('click', async () => {
      try {
        await api(`/api/profiles/${profile.id}/events/${eventId}/test`, { method: 'POST' });
        toast('Probando acción…');
      } catch (err) { toast(err.message); }
    });

    row.querySelector('[data-e-remove]').addEventListener('click', async () => {
      await api(`/api/profiles/${profile.id}/events/${eventId}`, { method: 'DELETE' });
      await loadProfiles();
      renderActionsAndEvents();
    });
  });
}

async function saveEvent(profileId, eventId, patch, needsRerender) {
  const profile = profiles.find(p => p.id === profileId);
  const ev = profile.events.find(e => e.id === eventId);
  Object.assign(ev, patch);
  try {
    await api(`/api/profiles/${profileId}/events/${eventId}`, { method: 'PUT', body: JSON.stringify(patch) });
    if (needsRerender) renderEventsTable(profile);
  } catch (err) { toast(err.message); }
}

document.getElementById('addEventBtn').addEventListener('click', async () => {
  const profile = activeProfile();
  await api(`/api/profiles/${profile.id}/events`, { method: 'POST', body: JSON.stringify({ triggerType: 'gift' }) });
  await loadProfiles();
  renderActionsAndEvents();
});

// ---------- Catálogo de regalos reales + selector emergente ----------
let giftsCatalog = [];
let giftsSource = 'default';
let giftModalTarget = null; // { profileId, eventId }

function giftThumbHtml(giftName) {
  if (!giftName) return '<span class="gift-thumb gift-thumb-empty">🎁</span>';
  const g = giftsCatalog.find(x => x.name.toLowerCase() === giftName.toLowerCase());
  return g && g.icon
    ? `<img class="gift-thumb" src="${escapeHtml(g.icon)}" alt="" />`
    : '<span class="gift-thumb gift-thumb-empty">🎁</span>';
}

async function loadGifts() {
  try {
    const data = await api('/api/gifts');
    giftsCatalog = data.gifts;
    giftsSource = data.source;
  } catch (err) { /* noop */ }
}

function openGiftModal(profileId, eventId) {
  giftModalTarget = { profileId, eventId };
  document.getElementById('giftSearchInput').value = '';
  renderGiftGrid('');
  document.getElementById('giftModal').style.display = 'flex';
  document.getElementById('giftSearchInput').focus();
}

function closeGiftModal() {
  document.getElementById('giftModal').style.display = 'none';
  giftModalTarget = null;
}

function renderGiftGrid(filterText) {
  const grid = document.getElementById('giftGrid');
  const banner = document.getElementById('giftSourceBanner');
  if (giftsSource === 'default') {
    banner.style.display = 'block';
    banner.textContent = '⚠️ Todavía no te conectaste nunca: esta es una lista básica aproximada, sin imágenes. Conectate una vez en un vivo para traer el catálogo real de tu cuenta (con fotos y costos exactos).';
  } else {
    banner.style.display = 'none';
  }

  const filtered = giftsCatalog.filter(g => g.name.toLowerCase().includes(filterText.toLowerCase()));

  const anyTile = !filterText ? `
    <button class="gift-tile gift-tile-any" data-gift-name="" data-gift-coins="1">
      <div class="gift-tile-noicon">✨</div>
      <span class="gt-name">Cualquier regalo</span>
      <span class="gt-coins">sin filtro</span>
    </button>` : '';

  if (filtered.length === 0) {
    grid.innerHTML = anyTile + '<p class="av-hint">No hay regalos que coincidan con la búsqueda.</p>';
  } else {
    grid.innerHTML = anyTile + filtered.map(g => `
      <button class="gift-tile" data-gift-name="${escapeHtml(g.name)}" data-gift-coins="${g.diamondCost}">
        ${g.icon ? `<img src="${escapeHtml(g.icon)}" alt="" />` : '<div class="gift-tile-noicon">🎁</div>'}
        <span class="gt-name">${escapeHtml(g.name)}</span>
        <span class="gt-coins">${g.diamondCost} 💎</span>
      </button>`).join('');
  }

  grid.querySelectorAll('[data-gift-name]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!giftModalTarget) return;
      const { profileId, eventId } = giftModalTarget;
      saveEvent(profileId, eventId, { giftName: btn.dataset.giftName, minCoins: Number(btn.dataset.giftCoins) || 1 }, true);
      closeGiftModal();
    });
  });
}

document.getElementById('closeGiftModal').addEventListener('click', closeGiftModal);
document.getElementById('giftModal').addEventListener('click', e => {
  if (e.target.id === 'giftModal') closeGiftModal();
});
document.getElementById('giftSearchInput').addEventListener('input', e => renderGiftGrid(e.target.value));

// ---------- Configuración (clave de Euler Stream) ----------
document.getElementById('openSettingsBtn').addEventListener('click', async () => {
  try {
    const cfg = await api('/api/config');
    document.getElementById('signApiKeyInput').value = cfg.apiKey || '';
  } catch (err) { /* noop */ }
  document.getElementById('settingsModal').style.display = 'flex';
});
document.getElementById('closeSettingsModal').addEventListener('click', () => {
  document.getElementById('settingsModal').style.display = 'none';
});
document.getElementById('settingsModal').addEventListener('click', e => {
  if (e.target.id === 'settingsModal') document.getElementById('settingsModal').style.display = 'none';
});
document.getElementById('saveSettingsBtn').addEventListener('click', async () => {
  const apiKey = document.getElementById('signApiKeyInput').value.trim();
  try {
    await api('/api/config', { method: 'POST', body: JSON.stringify({ apiKey }) });
    document.getElementById('settingsModal').style.display = 'none';
    toast('Clave guardada. Probá conectar de nuevo.');
  } catch (err) { toast(err.message); }
});

(async function init() {
  await loadProfiles();
  const status = await api('/api/status');
  setOnAir(status);
  await loadGifts();
  connectWs();
})();
