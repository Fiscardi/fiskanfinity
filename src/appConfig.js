const fs = require('fs');
const path = require('path');

class AppConfig {
  constructor(userDataDir) {
    this.filePath = path.join(userDataDir, 'config.json');
    this.data = this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this.filePath)) {
        return JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
      }
    } catch (err) { /* si falla, arrancamos en blanco */ }
    return { signApiKey: '' };
  }

  _save() {
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
  }

  get(key) {
    return this.data[key];
  }

  set(key, value) {
    this.data[key] = value;
    this._save();
  }
}

module.exports = { AppConfig };
