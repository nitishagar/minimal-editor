// Electron main process: one window, local-only IPC. No network, no updates,
// no phone-home, no extension host — just file dialogs and local fs/git access.
const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('node:path');
const git = require('./git.cjs');
const files = require('./files.cjs');

const isDev = process.argv.includes('--dev');
const isSmoke = process.argv.includes('--smoke');

function createWindow(startPath) {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#1e1e1e',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  // Harden before loading anything: block all outgoing network from the
  // renderer (this app is local-only), deny new windows, and pin navigation
  // to local files.
  win.webContents.session.webRequest.onBeforeRequest((details, cb) => {
    const url = details.url;
    if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('ws://') || url.startsWith('wss://')) {
      cb({ cancel: true });
    } else {
      cb({});
    }
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) event.preventDefault();
  });
  win.loadFile(
    path.join(__dirname, '..', 'dist', 'index.html'),
    startPath ? { query: { root: startPath } } : undefined,
  );
  if (isDev) win.webContents.openDevTools({ mode: 'detach' });
  return win;
}

ipcMain.handle('open-folder', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const res = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
  return res.canceled ? null : res.filePaths[0];
});
ipcMain.handle('list-dir', (_e, root) => files.listTree(root));
ipcMain.handle('read-file', (_e, root, rel) => files.readFile(root, rel));
ipcMain.handle('write-file', (_e, root, rel, content) => files.writeFile(root, rel, content));
ipcMain.handle('search', (_e, root, query) => files.search(root, query));
ipcMain.handle('git-is-repo', (_e, root) => git.isRepo(root));
ipcMain.handle('git-status', (_e, root) => git.status(root));
ipcMain.handle('git-show-head', (_e, root, file) => git.showHead(root, file));
ipcMain.handle('git-branch', (_e, root) => git.branch(root));

app.whenReady().then(async () => {
  // Optional positional arg: `electron . /path/to/repo`.
  const startPath = process.argv.slice(2).find((a) => !a.startsWith('--')) || null;
  const win = createWindow(startPath);
  if (isSmoke) {
    // Headless boot check: wait for load, verify renderer booted, quit.
    try {
      await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('load timeout')), 20000);
        win.webContents.once('did-finish-load', () => {
          clearTimeout(t);
          resolve();
        });
        win.webContents.once('did-fail-load', (_e, code, desc) => reject(new Error(`load failed ${code}: ${desc}`)));
      });
      const ready = await win.webContents.executeJavaScript('window.__ready === true');
      if (!ready) throw new Error('renderer did not set __ready');
      console.log('smoke: renderer booted, __ready=true');
      app.exit(0);
    } catch (e) {
      console.error(`smoke: ${e.message}`);
      app.exit(1);
    }
    return;
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(startPath);
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
