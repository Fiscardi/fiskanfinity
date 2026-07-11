const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const { createServer } = require('./src/server');

const PORT = 8420;
let mainWindow;
let serverHandle;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 940,
    minHeight: 600,
    backgroundColor: '#12141c',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadURL(`http://localhost:${PORT}/index.html`);

  // Los links "abrir overlay en el navegador" se abren afuera de Electron
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  serverHandle = createServer({ userDataDir: app.getPath('userData'), port: PORT });
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
