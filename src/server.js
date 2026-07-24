const path = require('path');
const fs = require('fs');
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const { TikTokLive } = require('@tiktool/live');
const { ProfileStore, MAX_PROFILES } = require('./profileStore');
const { AppConfig } = require('./appConfig');
const DEFAULT_GIFTS = require('./defaultGifts');

function createServer({ userDataDir, port = 8420 }) {
  const app = express();
  app.use(express.json());

  const store = new ProfileStore(userDataDir);
  const config = new AppConfig(userDataDir);
  const giftsCacheFile = path.join(userDataDir, 'gifts-cache.json');

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  let tiktokConnection = null;
  let currentUsername = null;
  let connectionState = { connected: false, username: null, roomId: null, error: null };
  let lastEventAt = 0;
  let heartbeatCheckInterval = null;
  // Catálogo de regalos para el selector de eventos: arranca con el que haya
  // quedado guardado de una conexión anterior, o si nunca conectaste, con el
  // básico precargado (aproximado, sin imágenes).
  const cachedGifts = loadCachedGifts();
  let availableGifts = cachedGifts.list;
  let giftsSource = cachedGifts.source;

  function loadCachedGifts() {
    try {
      if (fs.existsSync(giftsCacheFile)) {
        const cached = JSON.parse(fs.readFileSync(giftsCacheFile, 'utf-8'));
        if (Array.isArray(cached) && cached.length > 0) {
          return { list: cached, source: 'account' };
        }
      }
    } catch (err) { /* si falla, usamos el básico */ }
    return { list: DEFAULT_GIFTS, source: 'default' };
  }

  function saveGiftsCache(list) {
    try { fs.writeFileSync(giftsCacheFile, JSON.stringify(list, null, 2), 'utf-8'); } catch (err) { /* noop */ }
  }

  // TikTool (plan gratis) no da el catálogo completo de regalos por API,
  // así que lo vamos armando con los regalos reales que van llegando en vivo.
  function learnGiftFromEvent(giftId, giftName, diamondCost) {
    if (!giftName) return;
    const idx = availableGifts.findIndex(g => g.name.toLowerCase() === giftName.toLowerCase());
    if (idx === -1) {
      // Si todavía estábamos mostrando la lista básica, arrancamos una real de cero
      if (giftsSource === 'default') availableGifts = [];
      availableGifts.push({ id: giftId, name: giftName, diamondCost, icon: '' });
      availableGifts.sort((a, b) => a.diamondCost - b.diamondCost);
      giftsSource = 'account';
      saveGiftsCache(availableGifts);
      broadcast('gifts', { source: giftsSource, gifts: availableGifts });
    }
  }

  const rankingTotals = new Map(); // uniqueId -> { user, diamonds }

  function broadcast(type, payload) {
    const msg = JSON.stringify({ type, payload });
    wss.clients.forEach(client => {
      if (client.readyState === 1) client.send(msg);
    });
  }

  function broadcastStatus() {
    broadcast('status', connectionState);
  }

  function broadcastProfile() {
    broadcast('profile', store.getActive());
  }

  // Envía el estado actual apenas un overlay/panel se conecta por WS
  wss.on('connection', ws => {
    ws.send(JSON.stringify({ type: 'status', payload: connectionState }));
    ws.send(JSON.stringify({ type: 'profile', payload: store.getActive() }));
    ws.send(JSON.stringify({ type: 'ranking', payload: getRankingArray() }));
    ws.send(JSON.stringify({ type: 'gifts', payload: { source: giftsSource, gifts: availableGifts } }));
  });

  function getRankingArray() {
    return Array.from(rankingTotals.values())
      .sort((a, b) => b.diamonds - a.diamonds)
      .slice(0, store.getActive().overlays.ranking.maxEntries || 5);
  }

  function resetRanking() {
    rankingTotals.clear();
    broadcast('ranking', getRankingArray());
  }

  function resolveText(template, vars) {
    return String(template || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
  }

  function fireAction(profile, actionId, vars) {
    const action = profile.actions.find(a => a.id === actionId);
    if (!action) return;
    broadcast('customAction', {
      text: resolveText(action.text, vars),
      accentColor: action.accentColor,
      duration: action.duration,
      soundUrl: action.soundUrl || ''
    });

    // Puente hacia el juego/mod: si la acción tiene un webhook configurado,
    // le pegamos un pedido HTTP. Del otro lado tiene que haber algo escuchando
    // (un mod con API local, un script propio, AutoHotkey con un mini-servidor, etc.)
    // — FiskLive solo manda la señal, no controla el juego directamente.
    if (action.webhookUrl) {
      const method = (action.webhookMethod || 'POST').toUpperCase();
      const opts = { method };
      if (method !== 'GET') {
        opts.headers = { 'Content-Type': 'application/json' };
        opts.body = JSON.stringify({ action: action.name, ...vars });
      }
      fetch(action.webhookUrl, opts).catch(err => {
        console.error(`Webhook de la acción "${action.name}" falló:`, err.message);
      });
    }
  }

  // Revisa los eventos configurados del perfil activo y dispara los que matcheen
  function checkEvents(triggerType, vars) {
    const profile = store.getActive();
    (profile.events || []).forEach(ev => {
      if (!ev.enabled || ev.triggerType !== triggerType || !ev.actionId) return;
      if (triggerType === 'gift') {
        const nameOk = !ev.giftName || (vars.gift || '').toLowerCase() === ev.giftName.toLowerCase();
        if (nameOk && vars.diamonds >= (ev.minCoins || 1)) fireAction(profile, ev.actionId, vars);
      } else if (triggerType === 'like') {
        if (vars.total >= (ev.minLikes || 100) && vars.total - vars.delta < (ev.minLikes || 100)) {
          fireAction(profile, ev.actionId, vars);
        }
      } else {
        // follow / subscribe: disparan siempre que llega el evento
        fireAction(profile, ev.actionId, vars);
      }
    });
  }

  let lastMilestoneSent = 0;

  function handleGiftEvent(event) {
    const profile = store.getActive();
    const cfg = profile.overlays.alert;
    // Mientras dura una racha de regalos, solo procesamos cuando termina (repeatEnd)
    if (!event.repeatEnd) return;

    const diamonds = (event.diamondCount || 0) * (event.repeatCount || 1);
    const displayName = event.user?.nickname || event.user?.uniqueId || 'Alguien';
    const giftName = event.giftName || 'un regalo';

    learnGiftFromEvent(event.giftId, event.giftName, event.diamondCount || 0);

    // Ranking
    const key = event.user?.uniqueId || displayName;
    const prev = rankingTotals.get(key) || { user: displayName, diamonds: 0 };
    prev.diamonds += diamonds;
    prev.user = displayName;
    rankingTotals.set(key, prev);
    if (profile.overlays.ranking.enabled) broadcast('ranking', getRankingArray());

    // Meta
    if (profile.overlays.goal.enabled) {
      const updated = store.addToGoal(profile.id, diamonds);
      broadcast('goal', updated.overlays.goal);
    }

    // Alerta
    if (cfg.enabled && diamonds >= (cfg.minDiamonds || 1) && cfg.showGifts) {
      broadcast('alert', {
        kind: 'gift',
        user: displayName,
        gift: giftName,
        count: event.repeatCount || 1,
        diamonds,
        text: cfg.giftText
          .replace('{user}', displayName)
          .replace('{gift}', giftName)
          .replace('{count}', event.repeatCount || 1)
      });
    }

    checkEvents('gift', { user: displayName, gift: giftName, count: event.repeatCount || 1, diamonds });
  }

  function handleFollowEvent(event) {
    const profile = store.getActive();
    const cfg = profile.overlays.alert;
    const displayName = event.user?.nickname || event.user?.uniqueId || 'Alguien';
    if (cfg.enabled && cfg.showFollows) {
      broadcast('alert', {
        kind: 'follow',
        user: displayName,
        text: cfg.followText.replace('{user}', displayName)
      });
    }
    checkEvents('follow', { user: displayName });
  }

  function handleSubscribeEvent(event) {
    const profile = store.getActive();
    const cfg = profile.overlays.alert;
    const displayName = event.user?.nickname || event.user?.uniqueId || 'Alguien';
    if (cfg.enabled && cfg.showSubs) {
      broadcast('alert', {
        kind: 'sub',
        user: displayName,
        text: cfg.subText.replace('{user}', displayName)
      });
    }
    checkEvents('subscribe', { user: displayName });
  }

  function handleLikeEvent(event) {
    const profile = store.getActive();
    const total = event.totalLikes || 0;
    const delta = event.likeCount || 1;
    broadcast('likes', { total, delta });
    checkEvents('like', { total, delta });

    const cfg = profile.overlays.alert;
    if (cfg.enabled && cfg.showLikeMilestones) {
      const step = cfg.likeMilestoneStep || 100;
      if (total - lastMilestoneSent >= step) {
        lastMilestoneSent = total;
        broadcast('alert', {
          kind: 'likeMilestone',
          text: `¡Llegaron a ${total} likes!`
        });
      }
    }
  }

  async function connectToTikTok(username) {
    if (tiktokConnection) {
      try { tiktokConnection.disconnect(); } catch (e) { /* noop */ }
      tiktokConnection = null;
    }
    currentUsername = username;

    const apiKey = config.get('apiKey');
    if (!apiKey) {
      connectionState = {
        connected: false, username, roomId: null,
        error: 'Falta configurar tu clave gratuita de conexión (TikTool). Tocá el ⚙️ de arriba y pegala ahí.'
      };
      broadcastStatus();
      return connectionState;
    }

    tiktokConnection = new TikTokLive({
      uniqueId: username,
      apiKey,
      autoReconnect: true,
      maxReconnectAttempts: 5
    });

    if (store.getActive().overlays.ranking.resetOnConnect) resetRanking();

    // "Latido": si estando conectados pasa mucho tiempo sin ningún evento
    // real (regalos, likes, viewers, etc.), lo más probable es que el vivo
    // haya terminado y la librería no nos avisó a tiempo. Lo detectamos solos.
    lastEventAt = Date.now();
    if (heartbeatCheckInterval) clearInterval(heartbeatCheckInterval);
    heartbeatCheckInterval = setInterval(() => {
      if (connectionState.connected && Date.now() - lastEventAt > 90000) {
        connectionState = { connected: false, username, roomId: null, error: 'El vivo terminó (sin actividad)' };
        broadcastStatus();
        try { tiktokConnection.disconnect(); } catch (e) { /* noop */ }
      }
    }, 15000);

    tiktokConnection.on('connected', () => {
      lastEventAt = Date.now();
      connectionState = { connected: true, username, roomId: tiktokConnection.roomId || null, error: null };
      broadcastStatus();
    });

    tiktokConnection.on('roomInfo', info => {
      connectionState.roomId = info.roomId;
      broadcastStatus();
    });

    tiktokConnection.on('disconnected', (code, reason) => {
      connectionState = { connected: false, username, roomId: null, error: reason || 'Desconectado' };
      broadcastStatus();
    });

    // action 3 y 4 son los códigos que usa TikTok para avisar que el live
    // terminó (los mismos que usaba la librería vieja).
    tiktokConnection.on('control', event => {
      if (event.action === 3 || event.action === 4) {
        connectionState = { connected: false, username, roomId: null, error: 'El vivo terminó' };
        broadcastStatus();
        try { tiktokConnection.disconnect(); } catch (e) { /* noop */ }
      }
    });

    tiktokConnection.on('error', err => {
      console.error('Error de conexión con TikTok:', err.message || err);
    });

    tiktokConnection.on('gift', event => { lastEventAt = Date.now(); handleGiftEvent(event); });

    tiktokConnection.on('social', event => {
      lastEventAt = Date.now();
      if (event.action !== 'follow') return; // 'share' no tiene overlay propio por ahora
      handleFollowEvent(event);
    });

    tiktokConnection.on('subscribe', event => { lastEventAt = Date.now(); handleSubscribeEvent(event); });

    tiktokConnection.on('like', event => { lastEventAt = Date.now(); handleLikeEvent(event); });

    tiktokConnection.on('roomUserSeq', event => {
      lastEventAt = Date.now();
      broadcast('viewers', { count: event.viewerCount || 0 });
    });

    connectionState = { connected: false, username, roomId: null, error: null, connecting: true };
    broadcastStatus();

    try {
      await tiktokConnection.connect();
      connectionState = { connected: true, username, roomId: tiktokConnection.roomId || null, error: null };
    } catch (err) {
      connectionState = { connected: false, username, roomId: null, error: err.message || String(err) };
    }
    broadcastStatus();
    return connectionState;
  }

  function disconnectFromTikTok() {
    if (heartbeatCheckInterval) {
      clearInterval(heartbeatCheckInterval);
      heartbeatCheckInterval = null;
    }
    if (tiktokConnection) {
      try { tiktokConnection.disconnect(); } catch (e) { /* noop */ }
      tiktokConnection = null;
    }
    connectionState = { connected: false, username: currentUsername, roomId: null, error: null };
    broadcastStatus();
  }

  // ---- API REST ----
  app.get('/api/status', (req, res) => res.json(connectionState));

  app.get('/api/config', (req, res) => res.json({ apiKey: config.get('apiKey') || '', lastUsername: config.get('lastUsername') || '' }));

  app.post('/api/config', (req, res) => {
    config.set('apiKey', (req.body.apiKey || '').trim());
    res.json({ ok: true });
  });

  app.get('/api/gifts', (req, res) => res.json({ source: giftsSource, gifts: availableGifts }));

  app.post('/api/connect', async (req, res) => {
    const { username } = req.body;
    if (!username) return res.status(400).json({ error: 'Falta username' });
    const clean = username.replace('@', '').trim();
    try {
      const state = await connectToTikTok(clean);
      res.json(state);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/disconnect', (req, res) => {
    disconnectFromTikTok();
    res.json({ ok: true });
  });

  app.get('/api/profiles', (req, res) => {
    res.json({ profiles: store.getAll(), activeProfileId: store.data.activeProfileId, max: MAX_PROFILES });
  });

  app.post('/api/profiles', (req, res) => {
    try {
      const profile = store.create(req.body.name);
      res.json(profile);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.put('/api/profiles/:id', (req, res) => {
    try {
      const profile = store.update(req.params.id, req.body);
      if (profile.id === store.data.activeProfileId) broadcastProfile();
      res.json(profile);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete('/api/profiles/:id', (req, res) => {
    try {
      store.remove(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/profiles/:id/activate', (req, res) => {
    try {
      const profile = store.setActive(req.params.id);
      if (profile.overlays.ranking.resetOnConnect) resetRanking();
      broadcastProfile();
      res.json(profile);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/profiles/:id/goal/reset', (req, res) => {
    const profile = store.resetGoal(req.params.id);
    if (profile.id === store.data.activeProfileId) broadcast('goal', profile.overlays.goal);
    res.json(profile);
  });

  // ---- Acciones ----
  app.post('/api/profiles/:id/actions', (req, res) => {
    try {
      res.json(store.createAction(req.params.id, req.body));
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  app.put('/api/profiles/:id/actions/:actionId', (req, res) => {
    try {
      res.json(store.updateAction(req.params.id, req.params.actionId, req.body));
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  app.delete('/api/profiles/:id/actions/:actionId', (req, res) => {
    try {
      store.removeAction(req.params.id, req.params.actionId);
      res.json({ ok: true });
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  // ---- Eventos ----
  app.post('/api/profiles/:id/events', (req, res) => {
    try {
      res.json(store.createEvent(req.params.id, req.body));
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  app.put('/api/profiles/:id/events/:eventId', (req, res) => {
    try {
      res.json(store.updateEvent(req.params.id, req.params.eventId, req.body));
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  app.delete('/api/profiles/:id/events/:eventId', (req, res) => {
    try {
      store.removeEvent(req.params.id, req.params.eventId);
      res.json({ ok: true });
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  app.post('/api/profiles/:id/events/:eventId/test', (req, res) => {
    const profile = store.data.profiles.find(p => p.id === req.params.id);
    if (!profile) return res.status(404).json({ error: 'Perfil no encontrado' });
    const event = profile.events.find(e => e.id === req.params.eventId);
    if (!event) return res.status(404).json({ error: 'Evento no encontrado' });
    if (!event.actionId) return res.status(400).json({ error: 'El evento no tiene una acción asignada' });

    const wasActive = profile.id === store.data.activeProfileId;
    if (!wasActive) return res.status(400).json({ error: 'Solo se puede probar un evento del perfil activo' });

    const syntheticUser = { nickname: 'Usuario_Prueba', uniqueId: 'Usuario_Prueba' };
    if (event.triggerType === 'gift') {
      handleGiftEvent({
        user: syntheticUser,
        giftId: 'prueba',
        giftName: event.giftName || 'Rosa',
        diamondCount: event.minCoins || 1,
        repeatCount: 1,
        repeatEnd: true
      });
    } else if (event.triggerType === 'like') {
      handleLikeEvent({ totalLikes: event.minLikes || 100, likeCount: event.minLikes || 100 });
    } else if (event.triggerType === 'follow') {
      handleFollowEvent({ user: syntheticUser });
    } else if (event.triggerType === 'subscribe') {
      handleSubscribeEvent({ user: syntheticUser });
    }
    res.json({ ok: true });
  });

  app.post('/api/test-alert/:kind', (req, res) => {
    const kind = req.params.kind;
    const body = req.body || {};
    const user = (body.user && body.user.trim()) || 'Usuario_Prueba';
    const syntheticUser = { nickname: user, uniqueId: user };

    if (kind === 'gift') {
      const giftName = (body.gift && body.gift.trim()) || 'Rosa';
      const count = Number(body.count) > 0 ? Number(body.count) : 1;
      const diamondCount = Number(body.diamonds) > 0 ? Number(body.diamonds) : 1;
      handleGiftEvent({
        user: syntheticUser,
        giftId: 'prueba',
        giftName,
        diamondCount,
        repeatCount: count,
        repeatEnd: true
      });
      return res.json({ ok: true });
    }

    if (kind === 'follow') {
      handleFollowEvent({ user: syntheticUser });
      return res.json({ ok: true });
    }

    if (kind === 'sub') {
      handleSubscribeEvent({ user: syntheticUser });
      return res.json({ ok: true });
    }

    if (kind === 'likeMilestone') {
      const total = Number(body.total) > 0 ? Number(body.total) : (lastMilestoneSent + 100);
      handleLikeEvent({ totalLikes: total, likeCount: total - lastMilestoneSent });
      return res.json({ ok: true });
    }

    res.status(400).json({ error: 'Tipo de prueba desconocido' });
  });

  app.post('/api/test-counter/:kind', (req, res) => {
    const kind = req.params.kind; // 'likes' | 'viewers'
    const body = req.body || {};
    if (kind === 'likes') {
      const total = Number(body.total) || Math.floor(Math.random() * 5000) + 100;
      handleLikeEvent({ totalLikes: total, likeCount: Number(body.delta) || 10 });
    } else if (kind === 'viewers') {
      const count = Number(body.count) || Math.floor(Math.random() * 200) + 5;
      broadcast('viewers', { count });
    }
    res.json({ ok: true });
  });

  // ---- Overlays y panel estáticos ----
  app.use('/overlay', express.static(path.join(__dirname, '..', 'overlays')));
  app.use('/', express.static(path.join(__dirname, '..', 'renderer')));

  server.listen(port, () => {
    console.log(`FiskLive escuchando en http://localhost:${port}`);
  });

  return { app, server, port, store };
}

module.exports = { createServer };
