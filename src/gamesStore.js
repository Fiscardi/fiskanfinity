const fs = require('fs');
const path = require('path');

class GamesStore {
  constructor(userDataDir) {
    this.filePath = path.join(userDataDir, 'games.json');
    this.data = this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
        if (Array.isArray(parsed.games)) return parsed;
      }
    } catch (err) { /* arrancamos vacío si algo falla */ }
    return { games: [] };
  }

  _save() {
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
  }

  getAll() {
    return this.data.games;
  }

  create(data) {
    const game = {
      id: 'g' + Date.now(),
      name: data.name || 'Juego sin nombre',
      description: data.description || '',
      downloadUrl: data.downloadUrl || '',
      instructions: data.instructions || ''
    };
    this.data.games.push(game);
    this._save();
    return game;
  }

  update(id, patch) {
    const game = this.data.games.find(g => g.id === id);
    if (!game) throw new Error('Juego no encontrado');
    Object.assign(game, patch);
    this._save();
    return game;
  }

  remove(id) {
    this.data.games = this.data.games.filter(g => g.id !== id);
    this._save();
  }
}

module.exports = { GamesStore };
