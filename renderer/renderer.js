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
}

async function activateProfile(id) {
  activeProfileId = id;
  renderProfiles();
  renderCards();
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
    <div class="field-row"><span>Duración (ms)</span><input type="number" min="1000" step="500" value="${alert.duration}" data-field="alert.duration" data-num="1" /></div>
    <div class="card-actions">
      <button class="small" data-test="gift">Probar regalo</button>
      <button class="small" data-test="follow">Probar follow</button>
      <button class="small" data-test="sub">Probar sub</button>
    </div>`;

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
    cardShell('📊', 'Contador en vivo', 'counter', profile, counterBody, 'counter');

  wireCardEvents(profile);
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
  };
  ws.onclose = () => setTimeout(connectWs, 1500);
}

(async function init() {
  await loadProfiles();
  const status = await api('/api/status');
  setOnAir(status);
  connectWs();
})();
