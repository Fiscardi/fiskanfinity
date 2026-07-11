# TikFinity Lite

App de escritorio (Electron) gratuita, para uso personal, que conecta con tu TikTok LIVE y te da:

- **Alertas** de regalos, seguidores nuevos, suscripciones e hitos de likes
- **Barra de meta** de diamantes
- **Ranking de top regalos**
- **Contador** de likes y espectadores en vivo
- Hasta **5 perfiles de acción** (por ejemplo: "Directo normal", "Evento especial", "Modo silencioso"), cada uno con su propia configuración de overlays, que podés cambiar en cualquier momento desde el panel.

Los overlays se agregan en OBS (o el software que uses) como **Browser Source**, igual que en TikFinity/StreamElements.

## 1. Requisitos

- [Node.js](https://nodejs.org) 18 o superior instalado en tu compu.
- Conexión a internet (para conectarse a TikTok y cargar las tipografías).

## 2. Instalación

Abrí una terminal dentro de esta carpeta (`tikfinity-lite`) y corré:

```bash
npm install
npm start
```

Esto abre la ventana de la app y levanta un servidor local en `http://localhost:8420` (necesario para que OBS pueda leer los overlays).

## 3. Conectar tu cuenta

1. En la barra superior, escribí tu `@usuario` de TikTok (el mismo que usás para transmitir) y tocá **Conectar**.
2. Tenés que estar **en vivo en TikTok** en ese momento; si no, la conexión va a fallar.
3. Cuando conecta, el indicador de arriba se pone verde y dice "EN VIVO".

> Nota: esto usa una conexión no oficial (la misma que usa TikFinity y herramientas similares) para leer los eventos públicos de tu propio live. No hace falta ninguna contraseña ni token.

## 4. Perfiles de acción

En la barra izquierda podés:

- Crear hasta 5 perfiles con **+ Nuevo perfil**.
- Cambiar de perfil activo con un clic (por ejemplo, para bajarle el volumen a las alertas en un directo tranquilo).
- Cada perfil guarda su propia configuración de alertas, meta, ranking y contador — se guarda automáticamente.

## 5. Agregar los overlays a OBS

En cada tarjeta (Alertas, Meta, Ranking, Contador) hay un botón **Copiar URL**. En OBS:

1. `Fuentes` → `+` → `Navegador` (Browser Source)
2. Pegá la URL copiada, por ejemplo `http://localhost:8420/overlay/alert.html`
3. Tamaño sugerido:
   - Alertas: 900x300
   - Meta: 560x120
   - Ranking: 340x260
   - Contador: 400x100
4. Tildá "Actualizar el navegador cuando la escena se active" (opcional).

Los overlays muestran en vivo lo que pasa en el perfil que tengas activo en ese momento.

## 6. Conseguir el instalador .exe SIN instalar nada (recomendado si no querés usar la terminal)

Este proyecto ya trae listo un archivo (`.github/workflows/build.yml`) que le pide a GitHub que compile el instalador de Windows por vos, gratis, en sus propios servidores. Solo necesitás una cuenta de GitHub.

1. Andá a [github.com](https://github.com) y creá una cuenta gratis si no tenés (botón "Sign up").
2. Ya logueado, arriba a la derecha tocá el **+** → **New repository**.
3. Poné un nombre (por ejemplo `tikfinity-lite`), dejalo en **Public** o **Private** (da igual), y tocá **Create repository**.
4. En la página del repo recién creado, vas a ver un link que dice **"uploading an existing file"** — tocalo.
5. Abrí en tu explorador de archivos la carpeta `tikfinity-lite` que descomprimiste, seleccioná **todo su contenido** (todos los archivos y subcarpetas de adentro, no la carpeta en sí) y arrastralo a la página de GitHub.
6. Abajo de todo escribí un mensaje corto (por ejemplo "primera subida") y tocá **Commit changes**.
7. Andá a la pestaña **Actions** (arriba del repo). Vas a ver una ejecución llamada "Compilar TikFinity Lite (Windows)" con un círculo amarillo (en proceso). Esperá 3-5 minutos hasta que se ponga verde ✅.
8. Tocá esa ejecución, bajá hasta la sección **Artifacts** y descargá **TikFinity-Lite-Windows** (es un .zip).
9. Descomprimilo: adentro está el instalador `.exe`. Doble clic, instalar, y listo — te queda un ícono como cualquier programa. **A partir de acá ya no necesitás Node.js ni la terminal nunca más**, ni en tu PC ni en la de nadie a quien se lo pases.

Cada vez que quieras actualizar la app (por ejemplo si te agrego una función nueva), solo tenés que volver a subir los archivos actualizados al mismo repositorio y GitHub va a compilar un instalador nuevo solo.

## 6-bis. Alternativa: empaquetar vos mismo con la terminal (opcional)

Si en algún momento preferís hacerlo local en vez de con GitHub:

```bash
npm install
npm run dist
```

Esto genera el instalador en la carpeta `dist/` usando `electron-builder`.

## Notas y límites

- Es un proyecto personal/hobby: usa una librería de terceros (`tiktok-live-connector`) que hace ingeniería inversa del servicio de TikTok LIVE, no es una API oficial. Puede dejar de andar si TikTok cambia algo, en ese caso hay que actualizar la librería con `npm update tiktok-live-connector`.
- Solo podés ver eventos de lives públicos (el tuyo u otros), no hace falta iniciar sesión.
- Todo corre en tu compu — nada se manda a servidores externos salvo la conexión directa a TikTok.
