const path = require('path');
const os = require('os');
const fs = require('fs');
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const { TikTokLive } = require('@tiktool/live');
const { Rcon } = require('rcon-client');
const { ProfileStore, MAX_PROFILES } = require('./profileStore');
const { AppConfig } = require('./appConfig');
const { GamesStore } = require('./gamesStore');
const { templates } = require('./templates');
const DEFAULT_GIFTS = require('./defaultGifts');
const crashLives = require('./crashLivesMemory');
const crashMasks = require('./crashMasksMemory');
const metalSlugBombs = require('./metalSlugBombsMemory');
const metalSlugLives = require('./metalSlugLivesMemory');
const { gta } = require('./gtaConnector');
// Libreria externa solo para RESOLVER "nombre de cancion" -> videoId de
// YouTube (busqueda de texto). El control real de reproduccion (poner la
// cancion en la cola) va siempre por la API local de la app de YouTube
// Music, nunca por esta libreria.
const YouTube = require('youtube-sr').default;

function createServer({ userDataDir, port = 8420 }) {
  const app = express();
  app.use(express.json());

  const store = new ProfileStore(userDataDir);
  const config = new AppConfig(userDataDir);
  const gamesStore = new GamesStore(userDataDir);
  const giftsCacheFile = path.join(userDataDir, 'gifts-cache.json');
  const giftImagesDir = path.join(__dirname, '..', 'assets', 'gifts');

  // Busca, por nombre exacto (sin mayúsculas/minúsculas), si el usuario puso
  // una imagen local para ese regalo en assets/gifts. Se relee cada vez
  // porque la carpeta es chica y así el usuario puede agregar imágenes
  // nuevas sin tener que reiniciar la app.
  function findLocalGiftImage(giftName) {
    if (!giftName) return '';
    try {
      const files = fs.readdirSync(giftImagesDir);
      const target = giftName.trim().toLowerCase();
      const match = files.find(f => {
        const base = f.replace(/\.(png|jpg|jpeg|webp)$/i, '');
        return base.trim().toLowerCase() === target;
      });
      return match ? `/gift-images/${encodeURIComponent(match)}` : '';
    } catch (err) {
      return '';
    }
  }

  function withLocalIcons(list) {
    return list.map(g => ({ ...g, icon: findLocalGiftImage(g.name) || g.icon || '' }));
  }

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  let tiktokConnection = null;
  let currentUsername = null;
  let connectionState = { connected: false, username: null, roomId: null, error: null };
  let lastEventAt = 0;
  let heartbeatCheckInterval = null;

  // ---- Conexión RCON a un servidor de Minecraft (opcional, aparte de TikTok) ----
  let mcRcon = null;
  let mcStatus = { connected: false, host: null, error: null };

  async function connectMinecraft(host, port, password) {
    if (mcRcon) {
      try { await mcRcon.end(); } catch (e) { /* noop */ }
      mcRcon = null;
    }
    try {
      mcRcon = await Rcon.connect({ host, port: Number(port) || 25575, password, timeout: 5000 });
      mcRcon.on('end', () => {
        mcStatus = { connected: false, host, error: 'Se cerró la conexión' };
      });
      mcStatus = { connected: true, host, error: null };
    } catch (err) {
      mcRcon = null;
      mcStatus = { connected: false, host, error: err.message || String(err) };
    }
    return mcStatus;
  }

  async function disconnectMinecraft() {
    if (mcRcon) {
      try { await mcRcon.end(); } catch (e) { /* noop */ }
      mcRcon = null;
    }
    mcStatus = { connected: false, host: null, error: null };
  }

  async function sendMinecraftCommand(command) {
    if (!mcRcon || !mcStatus.connected) return;
    try {
      await mcRcon.send(command);
    } catch (err) {
      console.error('Comando RCON de Minecraft falló:', err.message);
    }
  }

  // ---- YouTube Music (Pear Desktop / th-ch), para pedidos de canciones del chat ----
  // La app expone una API local (plugin "Servidor API") en 127.0.0.1:<puerto>.
  // El pareo es una sola vez: pedimos un token con POST /auth/{id}, eso hace
  // aparecer un popup "Permitir acceso" DENTRO de la app de YouTube Music, y
  // una vez aceptado nos devuelve un token que guardamos y reusamos siempre
  // (no hay que volver a aceptar el popup salvo que se revoque el acceso).
  let ytMusicStatus = { connected: false, error: null };
  const songRequestCooldowns = new Map(); // uniqueId de TikTok -> timestamp del ultimo pedido

  function ytMusicClientId() {
    let id = config.get('ytMusicClientId');
    if (!id) {
      id = 'fisklive-' + Math.random().toString(36).slice(2, 10);
      config.set('ytMusicClientId', id);
    }
    return id;
  }

  async function ytMusicPair(port) {
    const p = Number(port) || config.get('ytMusicPort') || 26538;
    const id = ytMusicClientId();
    let resp;
    try {
      resp = await fetch(`http://127.0.0.1:${p}/auth/${id}`, { method: 'POST' });
    } catch (err) {
      ytMusicStatus = { connected: false, error: 'No se pudo conectar a YouTube Music en ese puerto (¿está abierta la app y el plugin "Servidor API" habilitado?)' };
      throw new Error(ytMusicStatus.error);
    }
    if (resp.status === 403) {
      ytMusicStatus = { connected: false, error: 'Se rechazó el pedido de acceso en la app de YouTube Music' };
      throw new Error(ytMusicStatus.error);
    }
    if (!resp.ok) {
      ytMusicStatus = { connected: false, error: `YouTube Music respondió con error ${resp.status}` };
      throw new Error(ytMusicStatus.error);
    }
    const data = await resp.json();
    config.set('ytMusicPort', p);
    config.set('ytMusicToken', data.accessToken);
    ytMusicStatus = { connected: true, error: null };
    return ytMusicStatus;
  }

  async function ytMusicCall(path, method = 'GET', body) {
    const port = config.get('ytMusicPort') || 26538;
    const token = config.get('ytMusicToken');
    if (!token) {
      throw new Error('YouTube Music todavía no está emparejado');
    }
    const resp = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: body ? JSON.stringify(body) : undefined
    });
    if (resp.status === 401 || resp.status === 403) {
      ytMusicStatus = { connected: false, error: 'El token venció o fue revocado, hay que volver a emparejar' };
      throw new Error(ytMusicStatus.error);
    }
    if (!resp.ok && resp.status !== 204) {
      throw new Error(`YouTube Music respondió con error ${resp.status}`);
    }
    if (resp.status === 204) return null;
    const text = await resp.text();
    return text ? JSON.parse(text) : null;
  }

  // Extrae el videoId directo si mandaron un link de YouTube/YouTube Music,
  // asi evitamos una busqueda de texto innecesaria (y mas confiable: no
  // depende de que la busqueda encuentre justo ESE video).
  function extractYoutubeVideoId(text) {
    const match = String(text).match(/(?:youtu\.be\/|[?&]v=|\/shorts\/)([a-zA-Z0-9_-]{11})/);
    return match ? match[1] : null;
  }

  async function ytMusicRequestSong(query) {
    const directId = extractYoutubeVideoId(query);
    let videoId = directId;
    let title = query;

    if (!videoId) {
      const results = await YouTube.search(query, { limit: 1, type: 'video' });
      if (!results || !results.length) {
        throw new Error('No encontré ninguna canción con ese nombre');
      }
      videoId = results[0].id;
      title = results[0].title || query;
    }

    await ytMusicCall('/api/v1/queue', 'POST', {
      videoId,
      insertPosition: 'INSERT_AFTER_CURRENT_VIDEO'
    });

    return { videoId, title };
  }

  async function handleSongRequestCommand(event) {
    if (!config.get('ytMusicEnabled')) return;

    const prefix = (config.get('ytMusicCommandPrefix') || '!play').toLowerCase();
    const raw = (event.comment || '').trim();
    if (!raw.toLowerCase().startsWith(prefix)) return;

    const query = raw.slice(prefix.length).trim();
    const displayNameEarly = event.user?.nickname || event.user?.uniqueId || 'Alguien';
    if (!query) {
      broadcast('songRequest', { ok: false, requestedBy: displayNameEarly, error: 'Escribiste el comando pero sin nombre de canción' });
      return;
    }

    // Antes esto se descartaba en silencio: si el nivel no alcanzaba, no
    // había forma de saberlo desde la app. Ahora lo avisamos igual, para
    // poder diagnosticar de una si el problema es el nivel del viewer.
    const level = extractLevelFromBadges(event.user?.badges);
    const minLevel = config.get('ytMusicMinLevel') || 0;
    if (level < minLevel) {
      console.log(`[ytmusic] Pedido de ${displayNameEarly} ignorado: nivel ${level} < mínimo ${minLevel}`);
      broadcast('songRequest', {
        ok: false,
        requestedBy: displayNameEarly,
        error: `Nivel insuficiente (tiene ${level}, hace falta ${minLevel})`
      });
      return;
    }

    const userId = event.user?.uniqueId || event.user?.nickname || 'anon';
    const displayName = event.user?.nickname || userId;
    const now = Date.now();
    const cooldownMs = (config.get('ytMusicCooldownSeconds') ?? 15) * 1000;
    if (now - (songRequestCooldowns.get(userId) || 0) < cooldownMs) {
      console.log(`[ytmusic] Pedido de ${displayName} ignorado: todavía en cooldown`);
      return; // el cooldown sí queda mudo a propósito, para no llenar el log de spam
    }
    songRequestCooldowns.set(userId, now);

    console.log(`[ytmusic] Procesando pedido de ${displayName}: "${query}"`);
    try {
      const result = await ytMusicRequestSong(query);
      console.log(`[ytmusic] OK: se agregó "${result.title}" (${result.videoId})`);
      broadcast('songRequest', { ok: true, title: result.title, requestedBy: displayName });
    } catch (err) {
      console.error(`[ytmusic] Falló el pedido de ${displayName}:`, err.message);
      broadcast('songRequest', { ok: false, error: err.message, requestedBy: displayName, query });
    }
  }

  // Catálogo de regalos para el selector de eventos: arranca con el que haya
  // quedado guardado de una conexión anterior, o si nunca conectaste, con el
  // básico precargado (aproximado, sin imágenes).
 function loadCachedGifts() {
  try {
    if (fs.existsSync(giftsCacheFile)) {
      const cached = JSON.parse(
        fs.readFileSync(giftsCacheFile, 'utf-8')
      );

      if (Array.isArray(cached) && cached.length > 0) {

  const imageGifts = loadGiftsFromImages();

  const merged = [...cached];

  imageGifts.forEach(imgGift => {
    const exists = merged.some(
      g => g.name.toLowerCase() === imgGift.name.toLowerCase()
    );

    if (!exists) {
      merged.push(imgGift);
    }
  });

  return {
    list: merged,
    source: 'account'
        };
      }
    }
  } catch (err) {
    // si falla usamos el catálogo básico
  }

  const imageGifts = loadGiftsFromImages();

  const merged = [...DEFAULT_GIFTS];

  imageGifts.forEach(imgGift => {
    const exists = merged.some(
      g => g.name.toLowerCase() === imgGift.name.toLowerCase()
    );

    if (!exists) {
      merged.push(imgGift);
    }
  });

  return {
    list: merged,
    source: 'default'
  };
}

function loadGiftsFromImages() {
  try {
    const files = fs.readdirSync(giftImagesDir);

    return files
      .filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f))
      .map((file, index) => ({
        id: 100000 + index,
        name: file.replace(/\.(png|jpg|jpeg|webp)$/i, ''),
        diamondCost: 1,
        icon: ''
      }));
  } catch (err) {
    return [];
  }
}
  
  const cachedGifts = loadCachedGifts();
let availableGifts = cachedGifts.list;
let giftsSource = cachedGifts.source;
  
  function saveGiftsCache(list) {
    try { fs.writeFileSync(giftsCacheFile, JSON.stringify(list, null, 2), 'utf-8'); } catch (err) { /* noop */ }
  }

  // TikTool (plan gratis) no da el catálogo completo de regalos por API,
  // así que lo vamos armando con los regalos reales que van llegando en vivo.
  function learnGiftFromEvent(giftId, giftName, diamondCost) {
    if (!giftName) return;
    const idx = availableGifts.findIndex(g => g.name.toLowerCase() === giftName.toLowerCase());
    if (idx === -1) {
      // Sumamos el regalo real a la lista (no borramos la básica: cuantos
      // más regalos conozcamos, mejor para elegir en el selector).
      availableGifts.push({ id: giftId, name: giftName, diamondCost, icon: '' });
      availableGifts.sort((a, b) => a.diamondCost - b.diamondCost);
      giftsSource = 'account';
      saveGiftsCache(availableGifts);
      broadcast('gifts', { source: giftsSource, gifts: withLocalIcons(availableGifts) });
    } else if (availableGifts[idx].diamondCost !== diamondCost) {
      // Si ya lo conocíamos pero con un costo distinto (ej. era de la lista
      // básica aproximada), actualizamos al valor real.
      availableGifts[idx].diamondCost = diamondCost;
      giftsSource = 'account';
      saveGiftsCache(availableGifts);
      broadcast('gifts', { source: giftsSource, gifts: withLocalIcons(availableGifts) });
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
    ws.send(JSON.stringify({ type: 'gifts', payload: { source: giftsSource, gifts: withLocalIcons(availableGifts) } }));
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

  // Vidas de Crash Bandicoot (escritura de memoria vía pointer de Cheat Engine)
    if (action.crashBandicootLives) {
      try {
        crashLives.addLives(Number(action.crashBandicootLives));
      } catch (err) {
        console.error('No se pudo escribir en la memoria de Crash Bandicoot (¿está el juego abierto?):', err.message);
        try {
          const logPath = path.join(os.homedir(), 'Desktop', 'fisklive-crash-debug.log');
          fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${err.stack || err.message}\n`);
        } catch (logErr) { /* noop */ }
      }
    }
    // Máscaras de Aku Aku de Crash Bandicoot (0 a 3, valor exacto)
    if (action.crashBandicootMasks !== undefined && action.crashBandicootMasks !== '') {
      try {
        crashMasks.setMasks(Number(action.crashBandicootMasks));
      } catch (err) {
        console.error('No se pudo escribir las máscaras de Crash Bandicoot (¿está el juego abierto?):', err.message);
        try {
          const logPath = path.join(os.homedir(), 'Desktop', 'fisklive-crash-debug.log');
          fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${err.stack || err.message}\n`);
        } catch (logErr) { /* noop */ }
      }
    }
    // Bombas de Metal Slug / Super Vehicle-001 (FinalBurn Neo)
    if (action.metalSlugBombs) {
      try {
        metalSlugBombs.addBombs(Number(action.metalSlugBombs));
      } catch (err) {
        console.error('No se pudo escribir en la memoria de Metal Slug (¿está FBNeo abierto?):', err.message);
        try {
          const logPath = path.join(os.homedir(), 'Desktop', 'fisklive-crash-debug.log');
          fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${err.stack || err.message}\n`);
        } catch (logErr) { /* noop */ }
      }
    }
    // Vidas (1UP) de Metal Slug / Super Vehicle-001 (FinalBurn Neo)
    if (action.metalSlugLives) {
      try {
        metalSlugLives.addLives(Number(action.metalSlugLives));
      } catch (err) {
        console.error('No se pudo escribir las vidas de Metal Slug (¿está FBNeo abierto?):', err.message);
        try {
          const logPath = path.join(os.homedir(), 'Desktop', 'fisklive-crash-debug.log');
          fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${err.stack || err.message}\n`);
        } catch (logErr) { /* noop */ }
      }
    }

       // Comando de Minecraft por RCON (oficial, no requiere hackear nada)
       if (action.minecraftCommand) {
         const mcVars = { ...vars, player: config.get('mcPlayerName') || '' };
         sendMinecraftCommand(resolveText(action.minecraftCommand, mcVars));
         
       }
     
         // ---------- GTA V (FiskLiveGTA mod, via TCP local puerto 8421) ----------
    // Todas estas llamadas son async pero no bloqueamos fireAction esperandolas;
    // si falla (GTA cerrado, mod no cargado), solo lo logueamos, no rompe el resto.

    if (action.gtaSpawnVehicle) {
      if (action.gtaReplaceVehicle) {
        gta.spawnVehicleMilestone(action.gtaSpawnVehicle).catch(() => {});
      } else {
        gta.spawnVehicle(action.gtaSpawnVehicle).catch(() => {});
      }
    }
    if (action.gtaGiveWeapon) {
      gta.giveWeapon(action.gtaGiveWeapon).catch(() => {});
    }
    if (action.gtaWanted !== undefined && action.gtaWanted !== '') {
      gta.setWanted(Number(action.gtaWanted)).catch(() => {});
    }
    if (action.gtaHealth !== undefined && action.gtaHealth !== '') {
      gta.setHealth(Number(action.gtaHealth)).catch(() => {});
    }
    if (action.gtaArmor !== undefined && action.gtaArmor !== '') {
      gta.setArmor(Number(action.gtaArmor)).catch(() => {});
    }
    if (action.gtaExplode) {
      gta.explodeNearby().catch(() => {});
    }
    if (action.gtaWeather) {
      gta.setWeather(action.gtaWeather).catch(() => {});
    }
    if (action.gtaTeleport) {
      gta.teleportRandom().catch(() => {});
    }
    if (action.gtaRagdoll) {
      gta.ragdoll().catch(() => {});
    }
    if (action.gtaChaosCount) {
      gta.spawnChaos(Number(action.gtaChaosCount)).catch(() => {});
    }
    if (action.gtaBoulderCount) {
      gta.spawnBoulders(Number(action.gtaBoulderCount)).catch(() => {});
    }
    if (action.gtaGiantBallCount) {
      gta.spawnGiantBalls(Number(action.gtaGiantBallCount)).catch(() => {});
    }
    if (action.gtaCarRainSeconds) {
      gta.carRain(Number(action.gtaCarRainSeconds)).catch(() => {});
    }
    if (action.gtaBreakVehicle) {
      gta.breakVehicle().catch(() => {});
    }
    if (action.gtaBlindingFog) {
      gta.blindingFog(Number(action.gtaBlindingFog)).catch(() => {});
    }
    if (action.gtaApocalypse) {
      gta.apocalypse(Number(action.gtaApocalypse)).catch(() => {});
    }
    if (action.gtaBlackHole) {
      gta.blackHole(Number(action.gtaBlackHole)).catch(() => {});
    }
    if (action.gtaKillerMonkeys) {
      gta.killerMonkeys(Number(action.gtaKillerMonkeys)).catch(() => {});
    }
    if (action.gtaChiliadStart) {
      gta.chiliadStart().catch(() => {});
    }
    if (action.gtaChiliadStop) {
      gta.chiliadStop().catch(() => {});
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
        // Dispara cada vez que se cruza un multiplo del paso configurado
        // (ej. minLikes=100 -> dispara en 100, 200, 300, etc, no solo la primera vez)
        const step = ev.minLikes || 100;
        const before = Math.floor((vars.total - vars.delta) / step);
        const after = Math.floor(vars.total / step);
        if (after > before) {
          fireAction(profile, ev.actionId, vars);
        }
      } else {
        // follow / subscribe: disparan siempre que llega el evento
        fireAction(profile, ev.actionId, vars);
      }
    });
  }

  let lastMilestoneSent = 0;
  const giftDebugLogFile = path.join(userDataDir, 'gift-debug.log');

  function logGiftDebug(event) {
    try {
      const line = `[${new Date().toISOString()}] giftName="${event.giftName}" giftId=${event.giftId} giftType=${event.giftType} diamondCount=${event.diamondCount} repeatCount=${event.repeatCount} repeatEnd=${event.repeatEnd}\n`;
      fs.appendFileSync(giftDebugLogFile, line, 'utf-8');
    } catch (err) { /* noop */ }
  }

  function handleGiftEvent(event) {
    logGiftDebug(event);

    const profile = store.getActive();
    const cfg = profile.overlays.alert;

    // Solo los regalos "combeables" (giftType === 1, como la rosa, que se
    // pueden mandar en racha) usan repeatEnd para avisar que la racha
    // terminó — hay que esperarlo para no contar el combo de a poquito.
    // Los regalos NO combeables (la mayoría) llegan en un solo evento, y
    // según la versión de la librería de TikTok, ese evento puede traer
    // repeatEnd en false/undefined porque no hay ninguna racha que cerrar.
    // Si esperáramos ese flag ahí, esos regalos nunca se procesarían -
    // que es justo lo que pasaba con el apocalipsis (y cualquier otra
    // acción atada a un regalo no combeable).
    const isStreakable = event.giftType === 1;
    if (isStreakable && !event.repeatEnd) return;

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
        icon: findLocalGiftImage(giftName),
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

  // Busca un número de "nivel" dentro de las insignias del usuario.
  // No tenemos forma de confirmar el formato exacto sin un chat real de
  // prueba, así que por ahora agarra el primer número que aparezca en
  // cualquiera de las insignias (ej. "fan_club_level_3" -> 3). Si en la
  // práctica viene distinto, se ajusta esta función nada más.
  function extractLevelFromBadges(badges) {
    if (!Array.isArray(badges) || badges.length === 0) return 0;
    let max = 0;
    for (const b of badges) {
      const match = String(b).match(/(\d+)/);
      if (match) max = Math.max(max, parseInt(match[1], 10));
    }
    return max;
  }

  function handleChatEvent(event) {
    const profile = store.getActive();
    const cfg = profile.overlays.ttsChat;
    if (!cfg.enabled) return;

    let comment = (event.comment || '').trim();
    if (!comment) return;
    if (cfg.ignoreCommands && comment.startsWith('!')) return;
    if (cfg.maxLength && comment.length > cfg.maxLength) comment = comment.slice(0, cfg.maxLength);

    const level = extractLevelFromBadges(event.user?.badges);
    if (level < (cfg.minLevel || 0)) return;

    const displayName = event.user?.nickname || event.user?.uniqueId || 'Alguien';
    broadcast('chat', {
      user: displayName,
      comment,
      level,
      readUsername: cfg.readUsername,
      voiceName: cfg.voiceName,
      rate: cfg.rate,
      pitch: cfg.pitch,
      volume: cfg.volume
    });
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

    tiktokConnection.on('chat', event => {
      lastEventAt = Date.now();
      handleChatEvent(event);
      handleSongRequestCommand(event).catch(err => {
        console.error('Error procesando pedido de cancion:', err.message);
      });
    });

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

  app.get('/api/gifts', (req, res) => res.json({ source: giftsSource, gifts: withLocalIcons(availableGifts) }));

  // ---- Biblioteca de juegos/mods ----
  // ---- Minecraft (RCON) ----
  app.get('/api/minecraft/status', (req, res) => res.json(mcStatus));

  app.get('/api/minecraft/config', (req, res) => res.json({
    host: config.get('mcRconHost') || '',
    port: config.get('mcRconPort') || 25575,
    password: config.get('mcRconPassword') || '',
    playerName: config.get('mcPlayerName') || ''
  }));

  app.post('/api/minecraft/player-name', (req, res) => {
    config.set('mcPlayerName', (req.body.playerName || '').trim());
    res.json({ ok: true });
  });

  // ---- YouTube Music (pedidos de canciones por chat) ----
  app.get('/api/ytmusic/status', (req, res) => res.json({
    ...ytMusicStatus,
    paired: !!config.get('ytMusicToken')
  }));

  app.get('/api/ytmusic/config', (req, res) => res.json({
    enabled: !!config.get('ytMusicEnabled'),
    port: config.get('ytMusicPort') || 26538,
    commandPrefix: config.get('ytMusicCommandPrefix') || '!play',
    minLevel: config.get('ytMusicMinLevel') || 0,
    cooldownSeconds: config.get('ytMusicCooldownSeconds') ?? 15,
    paired: !!config.get('ytMusicToken')
  }));

  app.post('/api/ytmusic/config', (req, res) => {
    const { enabled, port, commandPrefix, minLevel, cooldownSeconds } = req.body;
    if (enabled !== undefined) config.set('ytMusicEnabled', !!enabled);
    if (port) config.set('ytMusicPort', Number(port) || 26538);
    if (commandPrefix) config.set('ytMusicCommandPrefix', String(commandPrefix).trim());
    if (minLevel !== undefined) config.set('ytMusicMinLevel', Number(minLevel) || 0);
    if (cooldownSeconds !== undefined) config.set('ytMusicCooldownSeconds', Number(cooldownSeconds) || 0);
    res.json({ ok: true });
  });

  // Dispara el popup de "Permitir acceso" dentro de la app de YouTube Music.
  // Solo hace falta una vez; el token queda guardado para siempre.
  app.post('/api/ytmusic/pair', async (req, res) => {
    try {
      const status = await ytMusicPair(req.body.port);
      res.json(status);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/ytmusic/test', async (req, res) => {
    try {
      const result = await ytMusicRequestSong(req.body.query || 'Never Gonna Give You Up Rick Astley');
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ---- Plantillas ----
  app.get('/api/templates', (req, res) => {
    res.json(templates.map(t => ({
      id: t.id, name: t.name, imageUrl: t.imageUrl, description: t.description,
      requires: t.requires, actionCount: t.actions.length
    })));
  });

  app.post('/api/profiles/:id/apply-template/:templateId', (req, res) => {
    const template = templates.find(t => t.id === req.params.templateId);
    if (!template) return res.status(404).json({ error: 'Plantilla no encontrada' });
    try {
      let game = gamesStore.getAll().find(g => g.name.toLowerCase() === template.name.toLowerCase());
      if (!game) {
        game = gamesStore.create({ name: template.name, description: template.description, imageUrl: template.imageUrl });
      }
      const createdActions = template.actions.map(a => store.createAction(req.params.id, { ...a, gameId: game.id }));
      template.events.forEach(e => {
        const action = createdActions[e.actionIndex];
        store.createEvent(req.params.id, { ...e, actionId: action ? action.id : null, gameId: game.id });
      });
      if (req.params.id === store.data.activeProfileId) broadcastProfile();
      res.json({ ok: true, gameId: game.id, actionsCreated: createdActions.length, eventsCreated: template.events.length });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/minecraft/connect', async (req, res) => {
    const { host, port, password } = req.body;
    if (!host) return res.status(400).json({ error: 'Falta el host' });
    config.set('mcRconHost', host);
    config.set('mcRconPort', port || 25575);
    config.set('mcRconPassword', password || '');
    const status = await connectMinecraft(host, port, password);
    res.json(status);
  });

  app.post('/api/minecraft/disconnect', async (req, res) => {
    await disconnectMinecraft();
    res.json({ ok: true });
  });

  app.post('/api/minecraft/test', async (req, res) => {
    if (!mcStatus.connected) return res.status(400).json({ error: 'No estás conectado al servidor' });
    try {
      const result = await mcRcon.send(req.body.command || 'list');
      res.json({ ok: true, result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/games', (req, res) => res.json(gamesStore.getAll()));

  app.post('/api/games', (req, res) => {
    try { res.json(gamesStore.create(req.body)); }
    catch (err) { res.status(400).json({ error: err.message }); }
  });

  app.put('/api/games/:id', (req, res) => {
    try { res.json(gamesStore.update(req.params.id, req.body)); }
    catch (err) { res.status(400).json({ error: err.message }); }
  });

  app.delete('/api/games/:id', (req, res) => {
    try { gamesStore.remove(req.params.id); res.json({ ok: true }); }
    catch (err) { res.status(400).json({ error: err.message }); }
  });

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

    if (kind === 'chat') {
      const level = Number(body.level) || 0;
      handleChatEvent({
        user: { nickname: user, uniqueId: user, badges: level > 0 ? [`fan_club_level_${level}`] : [] },
        comment: (body.comment && body.comment.trim()) || 'Este es un mensaje de prueba del chat'
      });
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

  // Recibe el estado del desafio Monte Chiliad desde el mod de GTA (FiskLiveGTA.dll)
  // y lo reenvia por WebSocket a cualquier overlay conectado.
  app.post('/api/gta/chiliad-status', (req, res) => {
    broadcast('chiliadChallenge', req.body || {});
    res.json({ ok: true });
  });

  // ---- Overlays y panel estáticos ----
  app.use('/overlay', express.static(path.join(__dirname, '..', 'overlays')));
  app.use('/gift-images', express.static(giftImagesDir));
  app.use('/', express.static(path.join(__dirname, '..', 'renderer')));

  server.listen(port, () => {
    console.log(`FiskLive escuchando en http://localhost:${port}`);
  });

  return { app, server, port, store };
}

module.exports = { createServer };
