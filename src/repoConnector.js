// Conector con el mod FiskLiveREPO (BepInEx) de R.E.P.O.
// El mod escucha por TCP local en el puerto 8422: recibe un JSON, responde "OK"
// y cierra la conexion. Por eso abrimos una conexion nueva por cada comando.
// Si el juego esta cerrado, el comando falla en silencio (solo se loguea, y
// como mucho una vez cada 30 segundos para no llenar la consola).
const net = require('net');

const HOST = '127.0.0.1';
const PORT = 8422;
const TIMEOUT_MS = 2000;

let lastErrorLog = 0;

function logOnce(msg) {
  const now = Date.now();
  if (now - lastErrorLog > 30000) {
    lastErrorLog = now;
    console.error(msg);
  }
}

function send(payload) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let done = false;

    const finish = (err, data) => {
      if (done) return;
      done = true;
      socket.destroy();
      if (err) {
        logOnce(`R.E.P.O.: no se pudo enviar "${payload.action}" (esta el juego abierto?): ${err.message}`);
        reject(err);
      } else {
        resolve(data);
      }
    };

    socket.setTimeout(TIMEOUT_MS);
    socket.once('timeout', () => finish(new Error('sin respuesta (timeout)')));
    socket.once('error', err => finish(err));
    socket.once('data', d => finish(null, d.toString('utf8')));
    socket.once('close', () => finish(null, ''));
    socket.connect(PORT, HOST, () => {
      socket.write(JSON.stringify(payload));
    });
  });
}

const repo = {
  // Apaga las luces por X segundos
  blackout: seconds =>
    send({ action: 'blackout', seconds: Math.round(Number(seconds)) || 10 }),

  // Camara lenta / rapida: scale 0.3 = lento, 1 = normal, 2 = rapido
  timeScale: (scale, seconds) =>
    send({ action: 'time_scale', scale: Number(scale), seconds: Math.round(Number(seconds)) || 10 }),

  // Gravedad: preset "invertida", "liviana" o "pesada"
  gravity: (preset, seconds) =>
    send({ action: 'gravity_set', preset: String(preset), seconds: Math.round(Number(seconds)) || 15 }),

  // Vuelve las luces a la normalidad
  restoreLighting: () =>
    send({ action: 'restore_lighting' })
};

module.exports = { repo };
