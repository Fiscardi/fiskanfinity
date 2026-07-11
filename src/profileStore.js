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
    overlays: defaultOverlaysConfig()
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
}

module.exports = { ProfileStore, MAX_PROFILES, defaultOverlaysConfig };
