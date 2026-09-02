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

  const tts = profile.overlays.ttsChat;
  const ttsBody = `
    <div class="field-row"><span>Nivel mínimo de fan</span><input type="number" min="0" value="${tts.minLevel}" data-field="ttsChat.minLevel" data-num="1" /></div>
    <div class="field-row"><span>Voz</span><select id="ttsVoiceSelect" data-field="ttsChat.voiceName" style="background:var(--bg); border:1px solid var(--line); color:var(--text); border-radius:6px; padding:5px 8px; font-size:12px; max-width:190px;"><option value="">Cargando voces…</option></select></div>
    <div class="field-row"><span>Velocidad</span><input type="number" min="0.5" max="2" step="0.1" value="${tts.rate}" data-field="ttsChat.rate" data-num="1" /></div>
    <div class="field-row"><span>Tono</span><input type="number" min="0" max="2" step="0.1" value="${tts.pitch}" data-field="ttsChat.pitch" data-num="1" /></div>
    <div class="field-row"><span>Leer nombre de usuario</span><button class="switch small ${tts.readUsername ? 'on' : ''}" data-field="ttsChat.readUsername" data-bool="1"></button></div>
    <div class="field-row"><span>Ignorar mensajes con !comando</span><button class="switch small ${tts.ignoreCommands ? 'on' : ''}" data-field="ttsChat.ignoreCommands" data-bool="1"></button></div>
    <p class="av-hint" style="margin:6px 0 0;">El "nivel de fan" sale de las insignias que manda TikTok en el chat — todavía no lo probamos con un chat real, así que si algún mensaje que debería sonar no suena (o al revés), avisame para ajustarlo.</p>
    <div class="card-actions"><button class="small" data-test-tts="1">Probar</button></div>`;

  grid.innerHTML =
    cardShell('🎁', 'Alertas', 'alert', profile, alertBody, 'alert') +
    cardShell('🎯', 'Barra de meta', 'goal', profile, goalBody, 'goal') +
    cardShell('🏆', 'Top regalos', 'ranking', profile, rankingBody, 'ranking') +
    cardShell('📊', 'Contador en vivo', 'counter', profile, counterBody, 'counter') +
    cardShell('🗣️', 'TTS Chat', 'ttsChat', profile, ttsBody, 'ttschat') +
    eventsCard();

  wireCardEvents(profile);
  wireEventsCard();
  populateVoiceSelect(tts.voiceName);

  const testTtsBtn = document.querySelector('[data-test-tts]');
  if (testTtsBtn) {
    testTtsBtn.addEventListener('click', () => {
      api('/api/test-alert/chat', {
        method: 'POST',
        body: JSON.stringify({ user: 'Usuario_Prueba', comment: 'Este es un mensaje de prueba del chat', level: tts.minLevel || 0 })
      });
    });
  }
}

function populateVoiceSelect(selectedName) {
  const select = document.getElementById('ttsVoiceSelect');
  if (!select) return;
  const render = () => {
    const voices = speechSynthesis.getVoices();
    if (voices.length === 0) return;
    select.innerHTML = '<option value="">Automática (preferir español)</option>' +
      voices.map(v => `<option value="${escapeHtml(v.name)}" ${v.name === selectedName ? 'selected' : ''}>${escapeHtml(v.name)} (${v.lang})</option>`).join('');
  };
  render();
  speechSynthesis.onvoiceschanged = render;
}

function eventsCard() {
  return `
  <div class="card wide" id="eventsCard">
    <div class="card-head">
      <span class="led on"></span>
      <div class="card-title">Eventos y pruebas</div>
    </div>
    <p class="hint">Simulá eventos para chequear que las alertas, la meta, el ranking y tus Acciones/Eventos configurados reaccionen bien, sin necesidad de estar en vivo.</p>

    <div class="test-grid">
      <div class="test-form">
        <div class="field-row"><span>Usuario</span><input type="text" id="testUser" value="Usuario_Prueba" /></div>
        <div class="field-row"><span>Regalo</span><input type="text" id="testGift" value="Rosa" /></div>
        <div class="field-row"><span>Cantidad (combo)</span><input type="number" id="testCount" value="1" min="1" /></div>
        <div class="field-row"><span>Diamantes (por unidad)</span><input type="number" id="testDiamonds" value="5" min="1" /></div>
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
  const sendGiftBtn = document.getElementById('sendTestGift');
  if (sendGiftBtn) {
    sendGiftBtn.addEventListener('click', async () => {
      const body = {
        user: document.getElementById('testUser').value,
        gift: document.getElementById('testGift').value,
        count: document.getElementById('testCount').value,
        diamonds: document.getElementById('testDiamonds').value
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

// ---------- Navegación (Overlays / General / cada juego) ----------
let currentNav = 'overlays'; // 'overlays' | 'general' | id de un juego

document.querySelectorAll('.nav-item[data-nav]').forEach(btn => {
  btn.addEventListener('click', () => switchNav(btn.dataset.nav));
});

function switchNav(nav) {
  currentNav = nav;
  document.querySelectorAll('.nav-item[data-nav], .nav-item[data-game-nav]').forEach(btn => {
    const key = btn.dataset.nav || btn.dataset.gameNav;
    btn.classList.toggle('active', key === nav);
  });
  document.getElementById('cardsGrid').style.display = nav === 'overlays' ? 'grid' : 'none';
  document.getElementById('gameDetailView').style.display = nav === 'overlays' ? 'none' : 'block';
  if (nav !== 'overlays') renderActionsAndEvents();
}

function currentGameFilterId() {
  return currentNav === 'general' ? null : currentNav;
}

// ---------- Acciones (librería) ----------
function renderActionsAndEvents() {
  const profile = activeProfile();
  if (!profile) return;
  renderGameMetaBox();
  renderActionsList(profile);
  renderEventsTable(profile);
}

function renderActionsList(profile) {
  const list = document.getElementById('actionsList');
  const gameId = currentGameFilterId();
  const actions = profile.actions.filter(a => (a.gameId || null) === gameId);
  if (actions.length === 0) {
    list.innerHTML = '<p class="av-hint">Todavía no creaste ninguna acción acá.</p>';
    return;
  }
  list.innerHTML = actions.map(a => `
    <div class="action-card" data-action-id="${a.id}">
      <div class="ac-top">
        <input class="ac-name" type="text" value="${escapeHtml(a.name)}" data-a-field="name" />
        <button class="small ghost danger" data-a-remove="${a.id}">✕</button>
      </div>
      <div class="field-row"><span>Texto (usá {user})</span><input type="text" value="${escapeHtml(a.text)}" data-a-field="text" /></div>
      <div class="field-row"><span>Sonido (URL .mp3, opcional)</span><input type="text" value="${escapeHtml(a.soundUrl || '')}" data-a-field="soundUrl" placeholder="https://..." /></div>
      <div class="field-row"><span>Webhook hacia el juego/mod (opcional)</span><input type="text" value="${escapeHtml(a.webhookUrl || '')}" data-a-field="webhookUrl" placeholder="http://localhost:PUERTO/..." /></div>
      <div class="field-row"><span>Comando de Minecraft (RCON, opcional)</span><input type="text" value="${escapeHtml(a.minecraftCommand || '')}" data-a-field="minecraftCommand" placeholder="give {user} diamond 5" /></div>
      <div class="field-row"><span>Vidas Crash Bandicoot (número, negativo = quita, opcional)</span><input type="number" step="1" value="${a.crashBandicootLives || 0}" data-a-field="crashBandicootLives" placeholder="1 o -1" /></div>
      <div class="field-row"><span>Máscaras Aku Aku Crash (0 a 3, valor exacto, opcional)</span><input type="number" step="1" min="0" max="3" value="${a.crashBandicootMasks !== undefined ? a.crashBandicootMasks : ''}" data-a-field="crashBandicootMasks" placeholder="0, 1, 2 o 3" /></div>
      <div class="field-row"><span>Bombas Metal Slug (número, negativo = quita, opcional)</span><input type="number" step="1" value="${a.metalSlugBombs || 0}" data-a-field="metalSlugBombs" placeholder="1 o -1" /></div>
      <div class="field-row"><span>Vidas Metal Slug (número, negativo = quita, opcional)</span><input type="number" step="1" value="${a.metalSlugLives || 0}" data-a-field="metalSlugLives" placeholder="1 o -1" /></div>
      <div class="field-row"><span>GTA: Spawnear vehículo (nombre modelo o "random", opcional)</span><input type="text" value="${escapeHtml(a.gtaSpawnVehicle || '')}" data-a-field="gtaSpawnVehicle" placeholder="adder, zentorno, random..." /></div>
      <div class="field-row"><span>GTA: Reemplazar el vehículo anterior en vez de sumar otro (1 = si, 0 = no)</span><input type="number" step="1" min="0" max="1" value="${a.gtaReplaceVehicle || 0}" data-a-field="gtaReplaceVehicle" placeholder="1 o 0" /></div>
      <div class="field-row"><span>GTA: Dar arma (nombre oficial, opcional)</span><input type="text" value="${escapeHtml(a.gtaGiveWeapon || '')}" data-a-field="gtaGiveWeapon" placeholder="WEAPON_MINIGUN, WEAPON_PISTOL..." /></div>
      <div class="field-row"><span>GTA: Nivel de búsqueda (0 a 5, opcional)</span><input type="number" step="1" min="0" max="5" value="${a.gtaWanted !== undefined ? a.gtaWanted : ''}" data-a-field="gtaWanted" placeholder="0 a 5" /></div>
      <div class="field-row"><span>GTA: Vida del personaje (0-200, opcional)</span><input type="number" step="1" min="0" max="200" value="${a.gtaHealth !== undefined ? a.gtaHealth : ''}" data-a-field="gtaHealth" placeholder="100" /></div>
      <div class="field-row"><span>GTA: Armadura del personaje (0-100, opcional)</span><input type="number" step="1" min="0" max="100" value="${a.gtaArmor !== undefined ? a.gtaArmor : ''}" data-a-field="gtaArmor" placeholder="100" /></div>
      <div class="field-row"><span>GTA: Explosión cerca (1 = si, 0 = no, opcional)</span><input type="number" step="1" min="0" max="1" value="${a.gtaExplode || 0}" data-a-field="gtaExplode" placeholder="1 o 0" /></div>
      <div class="field-row"><span>GTA: Cambiar clima (opcional)</span><input type="text" value="${escapeHtml(a.gtaWeather || '')}" data-a-field="gtaWeather" placeholder="THUNDER, RAIN, CLEAR, FOGGY..." /></div>
      <div class="field-row"><span>GTA: Teletransporte random (1 = si, 0 = no, opcional)</span><input type="number" step="1" min="0" max="1" value="${a.gtaTeleport || 0}" data-a-field="gtaTeleport" placeholder="1 o 0" /></div>
      <div class="field-row"><span>GTA: Golpe fantasma / ragdoll (1 = si, 0 = no, opcional)</span><input type="number" step="1" min="0" max="1" value="${a.gtaRagdoll || 0}" data-a-field="gtaRagdoll" placeholder="1 o 0" /></div>
      <div class="field-row"><span>GTA: Enemigos de caos (cantidad, opcional)</span><input type="number" step="1" min="0" value="${a.gtaChaosCount || 0}" data-a-field="gtaChaosCount" placeholder="5" /></div>
      <div class="ac-row2">
        <select data-a-field="webhookMethod" title="Método del webhook" style="background:var(--bg); border:1px solid var(--line); color:var(--text); border-radius:6px; font-size:12px; padding:5px;">
          <option value="POST" ${(a.webhookMethod || 'POST') === 'POST' ? 'selected' : ''}>POST</option>
          <option value="GET" ${a.webhookMethod === 'GET' ? 'selected' : ''}>GET</option>
        </select>
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
      await api(`/api/profiles/${profile.id}/events`, { method: 'POST', body: JSON.stringify({ triggerType: 'follow', actionId: action.id, gameId: action.gameId || null }) })
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
  await api(`/api/profiles/${profile.id}/actions`, { method: 'POST', body: JSON.stringify({ gameId: currentGameFilterId() }) });
  await loadProfiles();
  renderActionsAndEvents();
});

// ---------- Eventos (tabla de disparadores) ----------
const triggerLabels = { gift: 'Regalo', like: 'Likes', follow: 'Follow', subscribe: 'Suscripción' };

function renderEventsTable(profile) {
  const body = document.getElementById('eventsBody');
  const gameId = currentGameFilterId();
  const events = profile.events.filter(ev => (ev.gameId || null) === gameId);
  const actionsInGame = profile.actions.filter(a => (a.gameId || null) === gameId);
  if (events.length === 0) {
    body.innerHTML = `<tr><td colspan="4" class="av-hint">Todavía no creaste ningún evento acá.</td></tr>`;
    return;
  }
  body.innerHTML = events.map(ev => `
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
            <input type="number" min="1" value="${ev.minLikes}" data-e-field="minLikes" title="Dispara cada esta cantidad de likes (ej. 100 = dispara en 100, 200, 300...)" />` : ''}
        </div>
      </td>
      <td>
        <select data-e-field="actionId">
          <option value="">— sin acción —</option>
          ${actionsInGame.map(a => `<option value="${a.id}" ${ev.actionId === a.id ? 'selected' : ''}>${escapeHtml(a.name)}</option>`).join('')}
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
  await api(`/api/profiles/${profile.id}/events`, { method: 'POST', body: JSON.stringify({ triggerType: 'gift', gameId: currentGameFilterId() }) });
  await loadProfiles();
  renderActionsAndEvents();
});

// ---------- Catálogo de regalos reales + selector emergente ----------
let giftsCatalog = [];
let giftsSource = 'default';
let giftModalTarget = null; // { profileId, eventId }

// TikTool (plan gratis) no manda imágenes de regalos, así que usamos un
// emoji representativo por nombre como respaldo visual, mejor que un
// ícono genérico siempre igual. Si no reconocemos el nombre, cae en 🎁.
const GIFT_EMOJI = {
  rose: '🌹', rosa: '🌹', gg: '🎮', heart: '❤️', 'finger heart': '🫰',
  tiktok: '🎵', 'ice cream cone': '🍦', 'thumbs up': '👍', coffee: '☕',
  'lightning bolt': '⚡', pandas: '🐼', mic: '🎤', 'drama queen': '🎭',
  'tiny dino': '🦖', 'hand heart': '💗', 'dog bone': '🦴', raccoon: '🦝',
  perfume: '🧴', 'baby fox': '🦊', capybara: '🐹', doughnut: '🍩',
  'i love you': '💌', origami: '🕊️', cap: '🧢', 'paper crane': '🪽',
  confetti: '🎊', 'bear love': '🧸', butterfly: '🦋', corgi: '🐕',
  galaxy: '🌌', fireworks: '🎆', 'sports car': '🏎️', 'sam the whale': '🐋',
  lion: '🦁', 'tiktok universe': '🌠'
};

function guessGiftEmoji(giftName) {
  if (!giftName) return '🎁';
  return GIFT_EMOJI[giftName.toLowerCase()] || '🎁';
}

function giftThumbHtml(giftName) {
  if (!giftName) return '<span class="gift-thumb gift-thumb-empty">🎁</span>';
  const g = giftsCatalog.find(x => x.name.toLowerCase() === giftName.toLowerCase());
  if (g && g.icon) return `<img class="gift-thumb" src="${escapeHtml(g.icon)}" alt="" />`;
  return `<span class="gift-thumb gift-thumb-empty">${guessGiftEmoji(giftName)}</span>`;
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
  document.getElementById('giftValueFilter').value = 'all';
  renderGiftGrid();
  document.getElementById('giftModal').style.display = 'flex';
  document.getElementById('giftSearchInput').focus();
}

function closeGiftModal() {
  document.getElementById('giftModal').style.display = 'none';
  giftModalTarget = null;
}

function renderGiftGrid() {
  const filterText = document.getElementById('giftSearchInput').value;
  const valueFilter = document.getElementById('giftValueFilter').value;
  const grid = document.getElementById('giftGrid');
  const banner = document.getElementById('giftSourceBanner');
  if (giftsSource === 'default') {
    banner.style.display = 'block';
    banner.textContent = '⚠️ Todavía no te conectaste nunca: esta es una lista básica aproximada, sin imágenes. Conectate una vez en un vivo para traer el catálogo real de tu cuenta (con fotos y costos exactos).';
  } else {
    banner.style.display = 'none';
  }

  let [minCoins, maxCoins] = valueFilter === 'all' ? [0, Infinity] : valueFilter.split('-').map(Number);
  const filtered = giftsCatalog.filter(g =>
    g.name.toLowerCase().includes(filterText.toLowerCase()) &&
    g.diamondCost >= minCoins && g.diamondCost <= maxCoins
  );

  const showAnyTile = !filterText && valueFilter === 'all';
  const anyTile = showAnyTile ? `
    <button class="gift-tile gift-tile-any" data-gift-name="" data-gift-coins="1">
      <div class="gift-tile-noicon">✨</div>
      <span class="gt-name">Cualquier regalo</span>
      <span class="gt-coins">sin filtro</span>
    </button>` : '';

  if (filtered.length === 0) {
    grid.innerHTML = anyTile + '<p class="av-hint">No hay regalos que coincidan con la búsqueda/filtro.</p>';
  } else {
    grid.innerHTML = anyTile + filtered.map(g => `
      <button class="gift-tile" data-gift-name="${escapeHtml(g.name)}" data-gift-coins="${g.diamondCost}">
        ${g.icon ? `<img src="${escapeHtml(g.icon)}" alt="" />` : `<div class="gift-tile-noicon">${guessGiftEmoji(g.name)}</div>`}
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
document.getElementById('giftSearchInput').addEventListener('input', () => renderGiftGrid());
document.getElementById('giftValueFilter').addEventListener('change', () => renderGiftGrid());

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

// ---------- Modal de Plantillas y Minecraft ----------
document.getElementById('openTemplatesBtn').addEventListener('click', () => {
  document.getElementById('templatesModal').style.display = 'flex';
  loadMcConfig();
  loadTemplates();
});
document.getElementById('closeTemplatesModal').addEventListener('click', () => {
  document.getElementById('templatesModal').style.display = 'none';
});
document.getElementById('templatesModal').addEventListener('click', e => {
  if (e.target.id === 'templatesModal') document.getElementById('templatesModal').style.display = 'none';
});

// ---------- Minecraft (RCON) ----------
async function loadMcConfig() {
  try {
    const cfg = await api('/api/minecraft/config');
    document.getElementById('mcHost').value = cfg.host || '';
    document.getElementById('mcPort').value = cfg.port || 25575;
    document.getElementById('mcPassword').value = cfg.password || '';
    document.getElementById('mcPlayerName').value = cfg.playerName || '';
  } catch (err) { /* noop */ }
  refreshMcStatus();
}

document.getElementById('mcSavePlayerBtn').addEventListener('click', async () => {
  const playerName = document.getElementById('mcPlayerName').value.trim();
  try {
    await api('/api/minecraft/player-name', { method: 'POST', body: JSON.stringify({ playerName }) });
    toast('Nombre de usuario guardado');
  } catch (err) { toast(err.message); }
});

async function refreshMcStatus() {
  try {
    const status = await api('/api/minecraft/status');
    setMcStatus(status);
  } catch (err) { /* noop */ }
}

function setMcStatus(status) {
  const led = document.getElementById('mcLed');
  const text = document.getElementById('mcStatusText');
  const btn = document.getElementById('mcConnectBtn');
  led.classList.toggle('on', status.connected);
  if (status.connected) {
    text.textContent = `Conectado a ${status.host}`;
    btn.textContent = 'Desconectar';
  } else {
    text.textContent = status.error ? `Error: ${status.error}` : 'Desconectado';
    btn.textContent = 'Conectar';
  }
}

document.getElementById('mcConnectBtn').addEventListener('click', async () => {
  const btn = document.getElementById('mcConnectBtn');
  if (btn.textContent === 'Desconectar') {
    await api('/api/minecraft/disconnect', { method: 'POST' });
    refreshMcStatus();
    return;
  }
  const host = document.getElementById('mcHost').value.trim();
  const port = document.getElementById('mcPort').value.trim();
  const password = document.getElementById('mcPassword').value;
  if (!host) { toast('Escribí la IP o dominio del servidor'); return; }
  btn.textContent = 'Conectando…';
  try {
    const status = await api('/api/minecraft/connect', { method: 'POST', body: JSON.stringify({ host, port, password }) });
    setMcStatus(status);
    if (status.connected) toast('Conectado al servidor de Minecraft');
  } catch (err) { toast(err.message); }
});

// ---------- Plantillas por juego ----------
async function loadTemplates() {
  try {
    const list = await api('/api/templates');
    renderTemplates(list);
  } catch (err) { /* noop */ }
}

function renderTemplates(list) {
  const container = document.getElementById('templatesList');
  container.innerHTML = list.map(t => `
    <div class="game-card template-card">
      ${t.imageUrl ? `<img class="game-thumb" src="${escapeHtml(t.imageUrl)}" alt="" />` : '<div class="game-thumb game-thumb-empty">🎮</div>'}
      <div class="game-body">
        <div class="ac-top"><strong>${escapeHtml(t.name)}</strong></div>
        <p class="av-hint" style="margin:4px 0 8px;">${escapeHtml(t.description)}</p>
        <p class="av-hint" style="margin:0 0 8px; color:var(--amber);">Necesita: ${escapeHtml(t.requires)}</p>
        <div class="card-actions">
          <button class="small primary" data-apply-template="${t.id}">Aplicar al perfil activo (${t.actionCount} acciones)</button>
        </div>
      </div>
    </div>`).join('');

  container.querySelectorAll('[data-apply-template]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const profile = activeProfile();
      if (!profile) return;
      if (!confirm(`Esto agrega ${btn.textContent.match(/\d+/)[0]} acciones nuevas y sus eventos al perfil "${profile.name}". ¿Seguimos?`)) return;
      try {
        const result = await api(`/api/profiles/${profile.id}/apply-template/${btn.dataset.applyTemplate}`, { method: 'POST' });
        toast('Plantilla aplicada');
        document.getElementById('templatesModal').style.display = 'none';
        await loadProfiles();
        await loadGames();
        switchNav(result.gameId);
      } catch (err) { toast(err.message); }
    });
  });
}

// ---------- Juegos (barra lateral) ----------
let gamesList = [];

async function loadGames() {
  try {
    gamesList = await api('/api/games');
    renderGamesNav();
  } catch (err) { /* noop */ }
}

function renderGamesNav() {
  const container = document.getElementById('gamesNavList');
  container.innerHTML = gamesList.map(g => `
    <button class="nav-item" data-game-nav="${g.id}">
      <span class="nav-item-name">🎮 ${escapeHtml(g.name)}</span>
      <span class="nav-item-remove" data-g-remove="${g.id}">✕</span>
    </button>`).join('');

  container.querySelectorAll('[data-game-nav]').forEach(btn => {
    btn.addEventListener('click', e => {
      if (e.target.dataset.gRemove) return; // el click de borrar no navega
      switchNav(btn.dataset.gameNav);
    });
  });
  container.querySelectorAll('[data-g-remove]').forEach(el => {
    el.addEventListener('click', async e => {
      e.stopPropagation();
      if (!confirm('¿Eliminar este juego? Sus acciones y eventos quedan sin juego asignado, en "General".')) return;
      await api(`/api/games/${el.dataset.gRemove}`, { method: 'DELETE' });
      if (currentNav === el.dataset.gRemove) switchNav('general');
      await loadGames();
    });
  });
}

function renderGameMetaBox() {
  const box = document.getElementById('gameMetaBox');
  if (currentNav === 'general') {
    box.innerHTML = `<p class="av-hint" style="margin-bottom:10px;">Acciones y eventos generales, sin ligar a ningún juego puntual.</p>`;
    return;
  }
  const game = gamesList.find(g => g.id === currentNav);
  if (!game) { box.innerHTML = ''; return; }
  box.innerHTML = `
    <div class="game-card" style="margin-bottom:16px; flex-direction:row; align-items:stretch;">
      ${game.imageUrl ? `<img class="game-thumb" src="${escapeHtml(game.imageUrl)}" alt="" style="width:120px; height:auto;" />` : '<div class="game-thumb game-thumb-empty" style="width:120px;">🎮</div>'}
      <div class="game-body" style="flex:1;">
        <div class="field-row"><span>Nombre</span><input type="text" value="${escapeHtml(game.name)}" data-gm-field="name" /></div>
        <div class="field-row"><span>Imagen (URL)</span><input type="text" value="${escapeHtml(game.imageUrl || '')}" data-gm-field="imageUrl" placeholder="https://..." /></div>
        <div class="field-row"><span>Link de descarga (mod/parche)</span><input type="text" value="${escapeHtml(game.downloadUrl || '')}" data-gm-field="downloadUrl" placeholder="https://..." /></div>
        <div class="field-row"><span>Notas</span><input type="text" value="${escapeHtml(game.instructions || '')}" data-gm-field="instructions" /></div>
        ${game.downloadUrl ? `<div class="card-actions"><a href="${escapeHtml(game.downloadUrl)}" target="_blank" rel="noopener"><button class="small primary">Descargar</button></a></div>` : ''}
      </div>
    </div>`;

  box.querySelectorAll('[data-gm-field]').forEach(el => {
    el.addEventListener('change', () => saveGame(game.id, { [el.dataset.gmField]: el.value }));
  });
}

let gameSaveTimers = {};
function saveGame(gameId, patch) {
  const game = gamesList.find(g => g.id === gameId);
  if (game) Object.assign(game, patch);
  clearTimeout(gameSaveTimers[gameId]);
  gameSaveTimers[gameId] = setTimeout(async () => {
    try {
      await api(`/api/games/${gameId}`, { method: 'PUT', body: JSON.stringify(patch) });
      renderGamesNav();
    } catch (err) { toast(err.message); }
  }, 400);
}

document.getElementById('addGameBtn').addEventListener('click', async () => {
  const game = await api('/api/games', { method: 'POST', body: JSON.stringify({ name: 'Juego nuevo' }) });
  await loadGames();
  switchNav(game.id);
});

(async function init() {
  await loadProfiles();
  const status = await api('/api/status');
  setOnAir(status);
  await loadGifts();
  await loadGames();
  connectWs();
})();
