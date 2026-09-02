// gtaConnector.js
// Conector TCP para que FiskLive le mande comandos al mod FiskLiveGTA (C#)
// que corre dentro de GTA V Enhanced. No requiere ninguna dependencia externa,
// usa el modulo 'net' que ya viene con Node.js.

const net = require('net');

const GTA_HOST = '127.0.0.1';
const GTA_PORT = 8421;
const CONNECT_TIMEOUT_MS = 1500;

/**
 * Manda un comando al mod de GTA V.
 * Abre una conexion nueva, manda el JSON, espera el "OK" de confirmacion, y cierra.
 * Esto matchea como esta armado el servidor TCP del lado de C# (una conexion = un comando).
 *
 * @param {string} action - nombre de la accion (ej. "spawn_vehicle")
 * @param {object} params - parametros extra de la accion (ej. { model: "adder" })
 * @returns {Promise<boolean>} true si se mando y confirmo bien, false si hubo error
 */
function sendGtaCommand(action, params = {}) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const finish = (success, reason) => {
      if (settled) return;
      settled = true;
      if (!success && reason) {
        console.warn(`[gtaConnector] ${action} fallo: ${reason}`);
      }
      socket.destroy();
      resolve(success);
    };

    socket.setTimeout(CONNECT_TIMEOUT_MS);

    socket.on('timeout', () => finish(false, 'timeout (GTA no responde o el mod no esta corriendo)'));
    socket.on('error', (err) => finish(false, err.message));

    socket.connect(GTA_PORT, GTA_HOST, () => {
      const payload = JSON.stringify({ action, ...params }) + '\n';
      socket.write(payload);
    });

    socket.on('data', () => {
      // El mod contesta "OK\n" apenas procesa el comando
      finish(true);
    });

    socket.on('close', () => {
      // Si se cerro sin recibir 'data', tratalo como fallo silencioso
      finish(false, 'conexion cerrada sin confirmacion');
    });
  });
}

// ---------- Helpers para cada accion (mas comodo de llamar desde el resto de FiskLive) ----------

const gta = {
  spawnVehicle: (model = 'adder') => sendGtaCommand('spawn_vehicle', { model }),
  spawnVehicleMilestone: (model = 'random') => sendGtaCommand('spawn_vehicle_milestone', { model }),
  giveWeapon: (weapon = 'WEAPON_PISTOL') => sendGtaCommand('give_weapon', { weapon }),
  setWanted: (level = 3) => sendGtaCommand('set_wanted', { level }),
  setHealth: (value = 100) => sendGtaCommand('set_health', { value }),
  setArmor: (value = 100) => sendGtaCommand('set_armor', { value }),
  explodeNearby: () => sendGtaCommand('explode_nearby'),
  setWeather: (type = 'THUNDER') => sendGtaCommand('set_weather', { type }),
  teleportRandom: () => sendGtaCommand('teleport_random'),
  ragdoll: () => sendGtaCommand('ragdoll'),
  spawnChaos: (count = 5) => sendGtaCommand('spawn_ped_chaos', { count }),
};

module.exports = { sendGtaCommand, gta };
