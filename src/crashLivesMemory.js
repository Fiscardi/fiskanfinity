// crashLivesMemory.js
// Módulo para leer/escribir las vidas de Crash Bandicoot N. Sane Trilogy vía memoryjs.
//
// IMPORTANTE: 'memoryjs' se carga de forma perezosa (recién cuando se necesita),
// no apenas arranca la app. Así, si el módulo nativo falla por algún motivo de
// empaquetado, el resto de FiskLive sigue funcionando normal y solo esta
// función en particular tira error en consola.

const PROCESS_NAME = 'CrashBandicootNSaneTrilogy.exe';

const BASE_OFFSET = 0x01A69698;
const OFFSETS = [0xA0, 0x40, 0x18, 0x40, 0x10, 0x28];
const FINAL_OFFSET = 0x420;

let _memoryjs = null;
function getMemoryjs() {
  if (!_memoryjs) {
    _memoryjs = require('memoryjs');
  }
  return _memoryjs;
}

function openGameProcess() {
  const memoryjs = getMemoryjs();
  let processObject;
  try {
    processObject = memoryjs.openProcess(PROCESS_NAME);
  } catch (err) {
    throw new Error(`No se pudo abrir ${PROCESS_NAME}. ¿El juego está corriendo?`);
  }
  return processObject;
}

function resolveLivesAddress(processObject) {
  const memoryjs = getMemoryjs();
  const modules = memoryjs.getModules(processObject.th32ProcessID);
  const mainModule = modules.find((m) =>
    m.szExePath.toLowerCase().endsWith('crashbandicootnsanetrilogy.exe')
  );

  if (!mainModule) {
    throw new Error('No se encontró el módulo principal del ejecutable.');
  }

  let address = mainModule.modBaseAddr + BASE_OFFSET;
  address = memoryjs.readMemory(processObject.handle, address, memoryjs.UINT64);

  for (const offset of OFFSETS) {
    address = memoryjs.readMemory(
      processObject.handle,
      Number(address) + offset,
      memoryjs.UINT64
    );
  }

  return Number(address) + FINAL_OFFSET;
}

function getLives() {
  const memoryjs = getMemoryjs();
  const processObject = openGameProcess();
  try {
    const livesAddress = resolveLivesAddress(processObject);
    return memoryjs.readMemory(processObject.handle, livesAddress, memoryjs.INT32);
  } finally {
    memoryjs.closeProcess(processObject.handle);
  }
}

function setLives(value) {
  const memoryjs = getMemoryjs();
  const processObject = openGameProcess();
  try {
    const livesAddress = resolveLivesAddress(processObject);
    memoryjs.writeMemory(processObject.handle, livesAddress, value, memoryjs.INT32);
  } finally {
    memoryjs.closeProcess(processObject.handle);
  }
}

function addLives(amount) {
  const memoryjs = getMemoryjs();
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
