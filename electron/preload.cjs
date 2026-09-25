// Preload bridge: the only API the renderer ever sees. Local fs/git only.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  openFolder: () => ipcRenderer.invoke('open-folder'),
  listDir: (root) => ipcRenderer.invoke('list-dir', root),
  readFile: (root, rel) => ipcRenderer.invoke('read-file', root, rel),
  writeFile: (root, rel, content) => ipcRenderer.invoke('write-file', root, rel, content),
  search: (root, query) => ipcRenderer.invoke('search', root, query),
  gitIsRepo: (root) => ipcRenderer.invoke('git-is-repo', root),
  gitStatus: (root) => ipcRenderer.invoke('git-status', root),
  gitShowHead: (root, file) => ipcRenderer.invoke('git-show-head', root, file),
  gitBranch: (root) => ipcRenderer.invoke('git-branch', root),
});
