const path = require('path');
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
// tiktok-live-connector/legacy es un módulo ESM: no se puede cargar con
// require() normal, hace falta un import() dinámico (funciona igual desde
// código CommonJS como este).
let WebcastPushConnection = null;
async function getWebcastPushConnection() {
  if (!WebcastPushConnection) {
    const mod = await import('tiktok-live-connector/legacy');
    WebcastPushConnection = mod.WebcastPushConnection;
  }
  return WebcastPushConnection;
}
const { ProfileStore, MAX_PROFILES } = require('./profileStore');

function createServer({ userDataDir, port = 8420 }) {
  const app = express();
  app.use(express.json());

  const store = new ProfileStore(userDataDir);

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  let tiktokConnection = null;
  let currentUsername = null;
  let connectionState = { connected: false, username: null, roomId: null, error: null };
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

  async function connectToTikTok(username) {
    if (tiktokConnection) {
      try { tiktokConnection.disconnect(); } catch (e) { /* noop */ }
      tiktokConnection = null;
    }
    currentUsername = username;
    const WebcastPushConnection = await getWebcastPushConnection();
    tiktokConnection = new WebcastPushConnection(username, {
      processInitialData: false,
      enableExtendedGiftInfo: true
    });

    if (store.getActive().overlays.ranking.resetOnConnect) resetRanking();

    tiktokConnection.on('connected', state => {
      connectionState = { connected: true, username, roomId: state.roomId, error: null };
      broadcastStatus();
    });

    tiktokConnection.on('disconnected', () => {
      connectionState = { connected: false, username, roomId: null, error: 'Desconectado' };
      broadcastStatus();
    });

    tiktokConnection.on('streamEnd', () => {
      connectionState = { connected: false, username, roomId: null, error: 'El vivo terminó' };
      broadcastStatus();
    });

    tiktokConnection.on('gift', data => {
      const profile = store.getActive();
      const cfg = profile.overlays.alert;
      // En una racha de regalos tipo1, solo procesamos cuando repeatEnd:true
      if (data.giftType === 1 && !data.repeatEnd) return;

      const diamonds = (data.diamondCount || 0) * (data.repeatCount || 1);
      const displayName = data.nickname || data.uniqueId || 'Alguien';

      // Ranking
      const key = data.uniqueId || displayName;
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
          gift: data.giftName || 'un regalo',
          count: data.repeatCount || 1,
          diamonds,
          text: cfg.giftText
            .replace('{user}', displayName)
            .replace('{gift}', data.giftName || 'un regalo')
            .replace('{count}', data.repeatCount || 1)
        });
      }

      checkEvents('gift', { user: displayName, gift: data.giftName || 'un regalo', count: data.repeatCount || 1, diamonds });
    });

    tiktokConnection.on('follow', data => {
      const profile = store.getActive();
      const cfg = profile.overlays.alert;
      if (!cfg.enabled || !cfg.showFollows) return;
      const displayName = data.nickname || data.uniqueId || 'Alguien';
      broadcast('alert', {
        kind: 'follow',
        user: displayName,
        text: cfg.followText.replace('{user}', displayName)
      });
      checkEvents('follow', { user: displayName });
    });

    tiktokConnection.on('subscribe', data => {
      const profile = store.getActive();
      const cfg = profile.overlays.alert;
      if (!cfg.enabled || !cfg.showSubs) return;
      const displayName = data.nickname || data.uniqueId || 'Alguien';
      broadcast('alert', {
        kind: 'sub',
        user: displayName,
        text: cfg.subText.replace('{user}', displayName)
      });
      checkEvents('subscribe', { user: displayName });
    });

    let likeAccum = 0;
    let lastMilestoneSent = 0;
    tiktokConnection.on('like', data => {
      const profile = store.getActive();
      likeAccum += data.likeCount || 1;
      const total = data.totalLikeCount || likeAccum;
      const delta = data.likeCount || 1;
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
    });

    tiktokConnection.on('roomUser', data => {
      broadcast('viewers', { count: data.viewerCount || 0 });
    });

    connectionState = { connected: false, username, roomId: null, error: null, connecting: true };
    broadcastStatus();

    try {
      const state = await tiktokConnection.connect();
      connectionState = { connected: true, username, roomId: state.roomId, error: null };
    } catch (err) {
      connectionState = { connected: false, username, roomId: null, error: err.message || String(err) };
    }
    broadcastStatus();
    return connectionState;
  }

  function disconnectFromTikTok() {
    if (tiktokConnection) {
      try { tiktokConnection.disconnect(); } catch (e) { /* noop */ }
      tiktokConnection = null;
    }
    connectionState = { connected: false, username: currentUsername, roomId: null, error: null };
    broadcastStatus();
  }

  // ---- API REST ----
  app.get('/api/status', (req, res) => res.json(connectionState));

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
    if (!event || !event.actionId) return res.status(400).json({ error: 'El evento no tiene una acción asignada' });
    const sampleVars = { user: 'Usuario_Prueba', gift: event.giftName || 'Rosa', count: 1, diamonds: event.minCoins || 1, total: event.minLikes || 100, delta: 1 };
    fireAction(profile, event.actionId, sampleVars);
    res.json({ ok: true });
  });

  app.post('/api/test-alert/:kind', (req, res) => {
    const kind = req.params.kind;
    const body = req.body || {};
    const user = (body.user && body.user.trim()) || 'Usuario_Prueba';
    const giftName = (body.gift && body.gift.trim()) || 'Rosa';
    const count = Number(body.count) > 0 ? Number(body.count) : 5;
    const diamonds = Number(body.diamonds) > 0 ? Number(body.diamonds) : count;
    const samples = {
      gift: { kind: 'gift', user, gift: giftName, count, diamonds, text: `${user} envió ${giftName} x${count}` },
      follow: { kind: 'follow', user, text: `${user} empezó a seguirte` },
      sub: { kind: 'sub', user, text: `${user} se suscribió` },
      likeMilestone: { kind: 'likeMilestone', text: `¡Llegaron a ${body.total || 1000} likes!` }
    };
    const alertPayload = samples[kind] || samples.gift;
    broadcast('alert', alertPayload);

    // Si es un regalo de prueba, también podemos simular su efecto en meta y ranking
    if (kind === 'gift' && body.affectGoalAndRanking) {
      const profile = store.getActive();
      if (profile.overlays.goal.enabled) {
        const updated = store.addToGoal(profile.id, diamonds);
        broadcast('goal', updated.overlays.goal);
      }
      if (profile.overlays.ranking.enabled) {
        const prev = rankingTotals.get(user) || { user, diamonds: 0 };
        prev.diamonds += diamonds;
        rankingTotals.set(user, prev);
        broadcast('ranking', getRankingArray());
      }
    }
    res.json({ ok: true, sent: alertPayload });
  });

  app.post('/api/test-counter/:kind', (req, res) => {
    const kind = req.params.kind; // 'likes' | 'viewers'
    const body = req.body || {};
    if (kind === 'likes') {
      const total = Number(body.total) || Math.floor(Math.random() * 5000) + 100;
      broadcast('likes', { total, delta: Number(body.delta) || 10 });
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
    console.log(`TikFinity Lite escuchando en http://localhost:${port}`);
  });

  return { app, server, port, store };
}

module.exports = { createServer };
