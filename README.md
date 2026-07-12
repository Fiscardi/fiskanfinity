# FiskLive

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

Primero necesitás una clave gratuita de **TikTool** (el servicio que maneja la conexión con TikTok):

1. En la app, tocá el ⚙️ que está al lado del botón "Conectar".
2. Andá a [tik.tools](https://tik.tools/login), creá una cuenta gratis (no pide tarjeta).
3. En su dashboard te genera una API Key automáticamente — copiala.
4. Volvé a FiskLive, pegala en el campo y tocá **Guardar**. Queda guardada en tu compu, no hace falta repetir esto cada vez.

Ahora sí, para conectar:

1. En la barra superior, escribí tu `@usuario` de TikTok (el mismo que usás para transmitir) y tocá **Conectar**.
2. Tenés que estar **en vivo en TikTok** en ese momento; si no, la conexión va a fallar.
3. Cuando conecta, el indicador de arriba se pone verde y dice "EN VIVO".

> Nota: esto usa un servicio externo (TikTool) para leer los eventos públicos de tu propio live. No hace falta ninguna contraseña de TikTok ni token de esa cuenta — solo la clave gratuita de TikTool, que es del servicio de conexión, no de tu cuenta de TikTok. El plan gratis de TikTool no da el catálogo completo de regalos por adelantado, así que el selector de regalos (ver sección 4-bis) arranca con una lista básica y se va completando sola con los regalos reales a medida que la gente te los manda.

## 4. Perfiles de acción

En la barra izquierda podés:

- Crear hasta 5 perfiles con **+ Nuevo perfil**.
- Cambiar de perfil activo con un clic (por ejemplo, para bajarle el volumen a las alertas en un directo tranquilo).
- Cada perfil guarda su propia configuración de alertas, meta, ranking, contador **y también sus propias Acciones y Eventos** — se guarda automáticamente.

## 4-bis. Acciones y Eventos (disparadores personalizados)

Además de la alerta genérica de regalos, tenés una pestaña **"Acciones y Eventos"** arriba del panel para armar reglas más finas, tipo "cuando llega tal regalo específico, pasa tal otra cosa":

- **Acciones**: la librería de "qué pasa". Cada acción tiene un texto (podés usar `{user}` para que se reemplace por el nombre de quien disparó el evento), un color, una duración, y opcionalmente una URL de sonido `.mp3` que se reproduce en el overlay de alertas.
- **Eventos**: la tabla de "qué lo dispara". Cada evento define un trigger (un regalo específico + monedas mínimas, un umbral de likes, un follow, o una suscripción) y qué Acción de la librería ejecuta. Podés activar/desactivar cada evento con el switch, y tocar **Probar** para testearlo sin estar en vivo.

Para el regalo específico de un evento, tocás el botón y se abre una ventana con una grilla de regalos (imagen, nombre, costo en monedas) y un buscador arriba:

- **Antes de conectarte por primera vez**: ves una lista básica precargada de ~35 regalos comunes de TikTok (Rose, GG, Finger Heart, Perfume, etc.) con costos aproximados y sin imágenes, para que puedas armar tus eventos de entrada. La ventana te avisa con un cartel amarillo que estás viendo esta lista básica.
- **A medida que vas en vivo**: cada vez que llega un regalo real que todavía no estaba en la lista, se agrega solo con su nombre y costo exacto. Así el catálogo se va completando con datos reales de a poco, sin depender de ningún plan pago. Ese catálogo **queda guardado en disco**, así que no se pierde aunque cierres la app.

Estas acciones se muestran en el mismo overlay de Alertas (`/overlay/alert.html`), así que no hace falta agregar una fuente nueva en OBS para verlas.

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
7. Andá a la pestaña **Actions** (arriba del repo). Vas a ver una ejecución llamada "Compilar FiskLive (Windows)" con un círculo amarillo (en proceso). Esperá 3-5 minutos hasta que se ponga verde ✅.
8. Tocá esa ejecución, bajá hasta la sección **Artifacts** y descargá **FiskLive-Windows** (es un .zip).
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
