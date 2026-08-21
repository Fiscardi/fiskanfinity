// metalSlugBombsMemory.js
// Módulo para leer/escribir las bombas de Metal Slug (Super Vehicle-001)
// corriendo en FinalBurn Neo, vía memoryjs.
//
// IMPORTANTE: 'memoryjs' se carga de forma perezosa (recién cuando se necesita),
// no apenas arranca la app. Así, si el módulo nativo falla por algún motivo de
// empaquetado, el resto de FiskLive sigue funcionando normal y solo esta
// función en particular tira error en consola.

const PROCESS_NAME = 'fbneo64.exe';

const BASE_OFFSET = 0x08EAFCE0;
const OFFSETS = []; // Metal Slug solo necesitó un nivel de puntero, a diferencia de Crash
const FINAL_OFFSET = 0x4C1;

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
    throw new Error(`No se pudo abrir ${PROCESS_NAME}. ¿FinalBurn Neo está corriendo?`);
  }
  return processObject;
}

function resolveBombsAddress(processObject) {
  const memoryjs = getMemoryjs();
  const modules = memoryjs.getModules(processObject.th32ProcessID);
  const mainModule = modules.find((m) =>
    m.szExePath.toLowerCase().endsWith('fbneo64.exe')
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

function getBombs() {
  const memoryjs = getMemoryjs();
  const processObject = openGameProcess();
  try {
    const bombsAddress = resolveBombsAddress(processObject);
    return memoryjs.readMemory(processObject.handle, bombsAddress, memoryjs.BYTE);
  } finally {
    memoryjs.closeProcess(processObject.handle);
  }
}

function setBombs(value) {
  const memoryjs = getMemoryjs();
  const processObject = openGameProcess();
  try {
    const bombsAddress = resolveBombsAddress(processObject);
    memoryjs.writeMemory(processObject.handle, bombsAddress, value, memoryjs.BYTE);
  } finally {
    memoryjs.closeProcess(processObject.handle);
  }
}

function addBombs(amount) {
  const memoryjs = getMemoryjs();
  const processObject = openGameProcess();
  try {
    const bombsAddress = resolveBombsAddress(processObject);
    const current = memoryjs.readMemory(processObject.handle, bombsAddress, memoryjs.BYTE);
    // Byte sin signo (0-255): recortamos para no dar la vuelta si restan de más.
    let next = current + amount;
    if (next < 0) next = 0;
    if (next > 255) next = 255;
    memoryjs.writeMemory(processObject.handle, bombsAddress, next, memoryjs.BYTE);
    return next;
  } finally {
    memoryjs.closeProcess(processObject.handle);
  }
}

module.exports = {
  getBombs,
  setBombs,
  addBombs,
};
