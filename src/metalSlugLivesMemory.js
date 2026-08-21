// metalSlugLivesMemory.js
// Módulo para leer/escribir las vidas (1UP) del jugador 1 en Metal Slug
// (Super Vehicle-001) corriendo en FinalBurn Neo, vía memoryjs.
//
// Usa la misma cadena de punteros que metalSlugBombsMemory.js (mismo base
// de memoria de trabajo del 68000), solo cambia el offset final.
//
// IMPORTANTE: 'memoryjs' se carga de forma perezosa (recién cuando se necesita),
// no apenas arranca la app. Así, si el módulo nativo falla por algún motivo de
// empaquetado, el resto de FiskLive sigue funcionando normal y solo esta
// función en particular tira error en consola.

const PROCESS_NAME = 'fbneo64.exe';

const BASE_OFFSET = 0x08EAFCE0;
const OFFSETS = [];
const FINAL_OFFSET = 0x376; // Candidato a confirmar con Cheat Engine

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

function resolveLivesAddress(processObject) {
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

function getLives() {
  const memoryjs = getMemoryjs();
  const processObject = openGameProcess();
  try {
    const livesAddress = resolveLivesAddress(processObject);
    return memoryjs.readMemory(processObject.handle, livesAddress, memoryjs.BYTE);
  } finally {
    memoryjs.closeProcess(processObject.handle);
  }
}

function setLives(value) {
  const memoryjs = getMemoryjs();
  const processObject = openGameProcess();
  try {
    const livesAddress = resolveLivesAddress(processObject);
    memoryjs.writeMemory(processObject.handle, livesAddress, value, memoryjs.BYTE);
  } finally {
    memoryjs.closeProcess(processObject.handle);
  }
}

function addLives(amount) {
  const memoryjs = getMemoryjs();
  const processObject = openGameProcess();
  try {
    const livesAddress = resolveLivesAddress(processObject);
    const current = memoryjs.readMemory(processObject.handle, livesAddress, memoryjs.BYTE);
    let next = current + amount;
    if (next < 0) next = 0;
    if (next > 255) next = 255;
    memoryjs.writeMemory(processObject.handle, livesAddress, next, memoryjs.BYTE);
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
