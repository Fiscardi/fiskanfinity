const fs = require('fs');
const path = require('path');

const MAX_PROFILES = 5;

function defaultOverlaysConfig() {
  return {
    alert: {
      enabled: true,
      minDiamonds: 1,
      duration: 6000,
      showGifts: true,
      showFollows: true,
      showSubs: true,
      showLikeMilestones: false,
      likeMilestoneStep: 100,
      accentColor: '#ff2d78',
      giftText: '{user} envió {gift} x{count}',
      followText: '{user} empezó a seguirte',
      subText: '{user} se suscribió'
    },
    goal: {
      enabled: true,
      label: 'Meta de diamantes',
      target: 1000,
      current: 0,
      accentColor: '#2dd4ff'
    },
    ranking: {
      enabled: true,
      title: 'Top regalos',
      maxEntries: 5,
      resetOnConnect: true
    },
    counter: {
      enabled: true,
      showLikes: true,
      showViewers: true
    }
  };
}

function makeDefaultProfile(n) {
  return {
    id: 'p' + Date.now() + '_' + n,
    name: 'Perfil ' + n,
    overlays: defaultOverlaysConfig(),
    actions: [],
    events: []
  };
}

function makeDefaultAction(n) {
  return {
    id: 'a' + Date.now() + '_' + n,
    name: 'Acción ' + n,
    text: '{user} activó "' + 'Acción ' + n + '"',
    accentColor: '#ffb648',
    duration: 5000,
    soundUrl: '',
    webhookUrl: '',
    webhookMethod: 'POST'
  };
}

class ProfileStore {
  constructor(userDataDir) {
    this.filePath = path.join(userDataDir, 'profiles.json');
    this.data = this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.profiles) && parsed.profiles.length > 0) {
          // Migración: perfiles guardados antes de que existieran acciones/eventos
          parsed.profiles.forEach(p => {
            if (!Array.isArray(p.actions)) p.actions = [];
            if (!Array.isArray(p.events)) p.events = [];
          });
          return parsed;
        }
      }
    } catch (err) {
      console.error('No se pudo leer profiles.json, se crea uno nuevo:', err.message);
    }
    const initial = { activeProfileId: null, profiles: [makeDefaultProfile(1)] };
    initial.activeProfileId = initial.profiles[0].id;
    this._save(initial);
    return initial;
  }

  _save(data) {
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  persist() {
    this._save(this.data);
  }

  getAll() {
    return this.data.profiles;
  }

  getActive() {
    return this.data.profiles.find(p => p.id === this.data.activeProfileId) || this.data.profiles[0];
  }

  setActive(id) {
    const exists = this.data.profiles.some(p => p.id === id);
    if (!exists) throw new Error('Perfil no encontrado');
    this.data.activeProfileId = id;
    this.persist();
    return this.getActive();
  }

  create(name) {
    if (this.data.profiles.length >= MAX_PROFILES) {
      throw new Error('Ya tenés el máximo de ' + MAX_PROFILES + ' perfiles');
    }
    const profile = makeDefaultProfile(this.data.profiles.length + 1);
    if (name) profile.name = name;
    this.data.profiles.push(profile);
    this.persist();
    return profile;
  }

  update(id, patch) {
    const profile = this.data.profiles.find(p => p.id === id);
    if (!profile) throw new Error('Perfil no encontrado');
    if (patch.name !== undefined) profile.name = patch.name;
    if (patch.overlays) {
      profile.overlays = Object.assign({}, profile.overlays, patch.overlays);
      for (const key of Object.keys(patch.overlays)) {
        profile.overlays[key] = Object.assign({}, (this.data.profiles.find(p => p.id === id).overlays[key] || {}), patch.overlays[key]);
      }
    }
    this.persist();
    return profile;
  }

  remove(id) {
    if (this.data.profiles.length <= 1) {
      throw new Error('Tiene que quedar al menos un perfil');
    }
    this.data.profiles = this.data.profiles.filter(p => p.id !== id);
    if (this.data.activeProfileId === id) {
      this.data.activeProfileId = this.data.profiles[0].id;
    }
    this.persist();
  }

  resetGoal(id) {
    const profile = this.data.profiles.find(p => p.id === id);
    if (!profile) throw new Error('Perfil no encontrado');
    profile.overlays.goal.current = 0;
    this.persist();
    return profile;
  }

  addToGoal(id, amount) {
    const profile = this.data.profiles.find(p => p.id === id);
    if (!profile) return;
    profile.overlays.goal.current = (profile.overlays.goal.current || 0) + amount;
    this.persist();
    return profile;
  }

  // ---- Acciones (librería reutilizable de "qué pasa" cuando dispara un evento) ----
  createAction(profileId, data) {
    const profile = this.data.profiles.find(p => p.id === profileId);
    if (!profile) throw new Error('Perfil no encontrado');
    const action = makeDefaultAction(profile.actions.length + 1);
    Object.assign(action, {
      name: data.name || action.name,
      text: data.text || action.text,
      accentColor: data.accentColor || action.accentColor,
      duration: data.duration || action.duration,
      soundUrl: data.soundUrl || '',
      webhookUrl: data.webhookUrl || '',
      webhookMethod: data.webhookMethod || 'POST'
    });
    profile.actions.push(action);
    this.persist();
    return action;
  }

  updateAction(profileId, actionId, patch) {
    const profile = this.data.profiles.find(p => p.id === profileId);
    if (!profile) throw new Error('Perfil no encontrado');
    const action = profile.actions.find(a => a.id === actionId);
    if (!action) throw new Error('Acción no encontrada');
    Object.assign(action, patch);
    this.persist();
    return action;
  }

  removeAction(profileId, actionId) {
    const profile = this.data.profiles.find(p => p.id === profileId);
    if (!profile) throw new Error('Perfil no encontrado');
    profile.actions = profile.actions.filter(a => a.id !== actionId);
    // Cualquier evento que usaba esta acción queda sin acción asignada
    profile.events.forEach(e => { if (e.actionId === actionId) e.actionId = null; });
    this.persist();
  }

  // ---- Eventos (disparadores: qué gatilla cada acción) ----
  createEvent(profileId, data) {
    const profile = this.data.profiles.find(p => p.id === profileId);
    if (!profile) throw new Error('Perfil no encontrado');
    const event = {
      id: 'e' + Date.now() + '_' + (profile.events.length + 1),
      enabled: true,
      triggerType: data.triggerType || 'gift',
      giftName: data.giftName || '',
      minCoins: data.minCoins || 1,
      minLikes: data.minLikes || 100,
      actionId: data.actionId || null
    };
    profile.events.push(event);
    this.persist();
    return event;
  }

  updateEvent(profileId, eventId, patch) {
    const profile = this.data.profiles.find(p => p.id === profileId);
    if (!profile) throw new Error('Perfil no encontrado');
    const event = profile.events.find(e => e.id === eventId);
    if (!event) throw new Error('Evento no encontrado');
    Object.assign(event, patch);
    this.persist();
    return event;
  }

  removeEvent(profileId, eventId) {
    const profile = this.data.profiles.find(p => p.id === profileId);
    if (!profile) throw new Error('Perfil no encontrado');
    profile.events = profile.events.filter(e => e.id !== eventId);
    this.persist();
  }
}

module.exports = { ProfileStore, MAX_PROFILES, defaultOverlaysConfig };
