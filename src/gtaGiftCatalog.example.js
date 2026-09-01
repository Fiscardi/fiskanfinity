// EJEMPLO de integracion - gtaGiftCatalog.js
//
// Esto es solo un ejemplo de como conectar tu catalogo de gifts con las
// acciones de gta. Adaptalo a como esta armado tu sistema de gift handlers
// actual (el mismo lugar donde ya disparas las acciones de Minecraft/Metal Slug).

const { gta } = require('./gtaConnector');

// Mapeo gift -> accion. Ajusta los nombres de gift exactos a los que usa
// tu integracion de TikTok (@tiktool/live), y los valores de "coins" si
// queres graduar la intensidad segun el valor del regalo.
const GTA_GIFT_MAP = {
  'Rosa': () => gta.giveWeapon('WEAPON_PISTOL'),
  'Corazon': () => gta.setHealth(100),
  'Universo': () => gta.spawnVehicle('adder'),
  'Leon': () => gta.spawnChaos(6),
  'Cohete': () => gta.explodeNearby(),
  'Rayo': () => gta.setWeather('THUNDER'),
  'Sirena Policia': () => gta.setWanted(5),
  'Fantasma': () => gta.ragdoll(),
  'Portal': () => gta.teleportRandom(),
};

/**
 * Llama a esto desde donde ya proceses los gifts entrantes de TikTok.
 * @param {string} giftName - nombre del gift tal cual llega del SDK
 */
async function handleGtaGift(giftName) {
  const action = GTA_GIFT_MAP[giftName];
  if (!action) return; // este gift no dispara nada en GTA

  const ok = await action();
  if (!ok) {
    console.warn(`[gtaGiftCatalog] No se pudo ejecutar la accion de GTA para el gift "${giftName}" (GTA no esta corriendo o el mod no cargo)`);
  }
}

module.exports = { handleGtaGift, GTA_GIFT_MAP };
