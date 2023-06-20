const { app, BrowserWindow, globalShortcut, dialog, ipcMain, nativeTheme } = require('electron')
const electronLocalshortcut = require('electron-localshortcut')
const path = require('path')

const enable_dev_keybinds = true

async function handleFileOpen(event) {
  const { canceled, filePaths } = await dialog.showOpenDialog()
  if(!canceled) {
    return filePaths
  }
  return -1
}

const createWindow = () => {
  const win = new BrowserWindow({
    icon: __dirname + "/icon.ico",
    width: 850,
    height: 700,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js')
    }
  })

  nativeTheme.themeSource = "light"

  if(enable_dev_keybinds === true) {
    electronLocalshortcut.register('alt+f5', function() {
      win.reload()
    })
    electronLocalshortcut.register('alt+f12', function() {
      win.webContents.openDevTools()
    })
  }

  win.setTitle("Free Voice Changer")
  win.removeMenu()

  win.loadFile('ui/index.html')
}

app.whenReady().then(() => {
  ipcMain.handle('open_dialog', handleFileOpen)

  createWindow()
})

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit()
})