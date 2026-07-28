// Plantillas de Acciones + Eventos ya armadas por juego.
//
// {player} se resuelve automáticamente con el nombre de usuario de Minecraft
// que cargues en la pestaña Juegos (el del streamer) — no es el nombre de
// quien manda el regalo, porque para eso hace falta un sistema de vinculación
// de cuentas que todavía no existe. O sea: estas acciones le pasan cosas al
// PERSONAJE DEL STREAMER, como en la mayoría de estos formatos "chat vs juego".
const MINECRAFT_TEMPLATE = {
  id: 'minecraft',
  name: 'Minecraft',
  imageUrl: '',
  description: 'Le pasan cosas a tu personaje cuando llegan regalos: buffs, mobs, clima, rayos. Usa comandos oficiales por RCON.',
  requires: 'Servidor de Minecraft Java Edition con RCON activado (ver pestaña Juegos) y tu nombre de usuario cargado.',
  actions: [
    { name: 'Curar', text: '{user} te curó', accentColor: '#35d488', minecraftCommand: 'effect give {player} minecraft:instant_health 1 5' },
    { name: 'Velocidad', text: '{user} te dio velocidad', accentColor: '#2dd4ff', minecraftCommand: 'effect give {player} minecraft:speed 30 1' },
    { name: 'Manzana dorada', text: '{user} te regaló una manzana dorada', accentColor: '#ffb648', minecraftCommand: 'give {player} golden_apple 1' },
    { name: 'Ceguera', text: '{user} te dejó ciego un rato', accentColor: '#ff2d78', minecraftCommand: 'effect give {player} minecraft:blindness 10 1' },
    { name: 'Zombie sorpresa', text: '{user} te mandó un zombie', accentColor: '#ff2d78', minecraftCommand: 'execute at {player} run summon zombie ~ ~ ~2' },
    { name: 'Rayo', text: '{user} te tiró un rayo', accentColor: '#ffb648', minecraftCommand: 'execute at {player} run summon lightning_bolt ~ ~ ~' },
    { name: 'Tormenta', text: '{user} trajo la tormenta', accentColor: '#8890a6', minecraftCommand: 'weather thunder 60' },
    { name: 'Noche', text: '{user} adelantó la noche', accentColor: '#8890a6', minecraftCommand: 'time set night' },
    { name: 'Catapulta', text: '{user} te mandó a volar', accentColor: '#ff2d78', minecraftCommand: 'execute at {player} run tp {player} ~ ~15 ~' }
  ],
  // Cada evento referencia una acción por índice (posición en el array de arriba)
  events: [
    { triggerType: 'gift', giftName: '', minCoins: 1, actionIndex: 0 },
    { triggerType: 'gift', giftName: '', minCoins: 5, actionIndex: 1 },
    { triggerType: 'gift', giftName: '', minCoins: 10, actionIndex: 2 },
    { triggerType: 'gift', giftName: '', minCoins: 20, actionIndex: 3 },
    { triggerType: 'gift', giftName: '', minCoins: 50, actionIndex: 4 },
    { triggerType: 'gift', giftName: '', minCoins: 100, actionIndex: 5 },
    { triggerType: 'follow', actionIndex: 6 },
    { triggerType: 'subscribe', actionIndex: 7 },
    { triggerType: 'like', minLikes: 500, actionIndex: 8 }
  ]
};

module.exports = { templates: [MINECRAFT_TEMPLATE] };
