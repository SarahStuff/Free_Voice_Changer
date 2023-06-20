const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electron_api', {
  open_dialog: async () => await ipcRenderer.invoke('open_dialog')
})