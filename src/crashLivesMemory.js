// crashLivesMemory.js
// Módulo para leer/escribir las vidas de Crash Bandicoot N. Sane Trilogy
// usando la cadena de punteros obtenida con Cheat Engine.
//
// Requiere: npm install memoryjs --save
// IMPORTANTE: FiskLive (Electron) debe ejecutarse como Administrador,
// igual que necesitabas Cheat Engine en modo Admin para leer el proceso del juego.

const memoryjs = require('memoryjs');

const PROCESS_NAME = 'CrashBandicootNSaneTrilogy.exe';

// Cadena de punteros obtenida en Cheat Engine:
// exe+BASE_OFFSET -> +OFFSETS[0] -> +OFFSETS[1] -> ... -> +FINAL_OFFSET (valor final)
const BASE_OFFSET = 0x01A69698;
const OFFSETS = [0xA0, 0x40, 0x18, 0x40, 0x10, 0x28]; // cada uno se dereferencia
const FINAL_OFFSET = 0x420; // offset final, NO se dereferencia (ahí está el int de vidas)

/**
 * Abre el proceso del juego y encuentra el módulo base del .exe.
 * Lanza error si el juego no está corriendo.
 */
function openGameProcess() {
  let processObject;
  try {
    processObject = memoryjs.openProcess(PROCESS_NAME);
  } catch (err) {
    throw new Error(`No se pudo abrir ${PROCESS_NAME}. ¿El juego está corriendo?`);
  }
  return processObject;
}

/**
 * Resuelve la cadena de punteros y devuelve la dirección final de memoria
 * donde vive el valor de vidas (int32).
 */
function resolveLivesAddress(processObject) {
  const modules = memoryjs.getModules(processObject.th32ProcessID);
  const mainModule = modules.find((m) =>
    m.szExePath.toLowerCase().endsWith('crashbandicootnsanetrilogy.exe')
  );

  if (!mainModule) {
    throw new Error('No se encontró el módulo principal del ejecutable.');
  }

  // Primer paso: base del módulo + offset base, dereferenciado
  let address = mainModule.modBaseAddr + BASE_OFFSET;
  address = memoryjs.readMemory(processObject.handle, address, memoryjs.UINT64);

  // Pasos intermedios: cada uno se dereferencia
  for (const offset of OFFSETS) {
    address = memoryjs.readMemory(
      processObject.handle,
      Number(address) + offset,
      memoryjs.UINT64
    );
  }

  // Offset final: NO se dereferencia, es la dirección de los datos
  return Number(address) + FINAL_OFFSET;
}

/**
 * Lee el valor actual de vidas.
 */
function getLives() {
  const processObject = openGameProcess();
  try {
    const livesAddress = resolveLivesAddress(processObject);
    return memoryjs.readMemory(processObject.handle, livesAddress, memoryjs.INT32);
  } finally {
    memoryjs.closeProcess(processObject.handle);
  }
}

/**
 * Escribe un valor exacto de vidas.
 */
function setLives(value) {
  const processObject = openGameProcess();
  try {
    const livesAddress = resolveLivesAddress(processObject);
    memoryjs.writeMemory(processObject.handle, livesAddress, value, memoryjs.INT32);
  } finally {
    memoryjs.closeProcess(processObject.handle);
  }
}

/**
 * Suma (o resta, con número negativo) vidas al valor actual.
 * Ideal para engancharlo directo a un evento de regalo de TikTok.
 */
function addLives(amount) {
  const processObject = openGameProcess();
  try {
    const livesAddress = resolveLivesAddress(processObject);
    const current = memoryjs.readMemory(processObject.handle, livesAddress, memoryjs.INT32);
    const next = current + amount;
    memoryjs.writeMemory(processObject.handle, livesAddress, next, memoryjs.INT32);
    return next;
  } finally {
    memoryjs.closeProcess(processObject.handle);
  }
}

module.exports = {
  getLives,
  setLives,
  addLives,
};
