import { app, BrowserWindow, dialog, Menu, session, shell } from 'electron'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { EV } from '@shared/ipc'
import { isTerminal } from '@shared/types'
import type { AppNotice } from '@shared/types'
import { StoreService } from './services/store'
import { VaultService } from './services/vault'
import { KnownHostsService } from './services/knownHosts'
import { SshService } from './services/ssh'
import { HostKeyBroker } from './services/hostKeyBroker'
import { LogStore } from './services/logStore'
import { RunManager } from './services/runner'
import { applyRetention } from './services/retention'
import { registerIpc } from './ipc'
import type { AppContext } from './context'
import { readJsonFile, writeFileAtomic } from './utils/atomicFile'

app.setName('Corral')

if (!app.isPackaged && process.env['CORRAL_USER_DATA_DIR']) {
  app.setPath('userData', process.env['CORRAL_USER_DATA_DIR'])
}
if (!app.isPackaged && process.env['CORRAL_DEBUG_PORT']) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env['CORRAL_DEBUG_PORT'])
}

interface WindowState {
  width: number
  height: number
  x?: number
  y?: number
  maximized?: boolean
}

let mainWindow: BrowserWindow | null = null
let quitting = false
let runnerRef: RunManager | null = null
let storeRef: StoreService | null = null

async function loadWindowState(dataDir: string): Promise<WindowState> {
  const result = await readJsonFile<WindowState>(join(dataDir, 'window-state.json'), () => ({
    width: 1280,
    height: 800
  }))
  return result.data
}

async function bootstrap(): Promise<void> {
  const dataDir = app.getPath('userData')
  await mkdir(dataDir, { recursive: true })

  const store = new StoreService(dataDir)
  await store.init()

  const nowIso = new Date().toISOString()
  const stale = store.getState().runs.filter((run) => !isTerminal(run.status))
  if (stale.length > 0) {
    await store.mutate((state) => {
      for (const run of state.runs) {
        if (isTerminal(run.status)) continue
        run.status = 'disconnected'
        run.errorKind = 'network'
        run.errorMessage = '应用重启，执行状态未知'
        run.endedAt = nowIso
        run.durationMs = Math.max(0, Date.parse(nowIso) - Date.parse(run.startedAt))
      }
    })
    await store.flush()
  }
  const vault = new VaultService(dataDir)
  await vault.init()
  const knownHosts = new KnownHostsService(dataDir)
  await knownHosts.init()
  const logs = new LogStore(join(dataDir, 'logs'))
  await logs.init()

  let hostKeys: HostKeyBroker
  const emit = (channel: string, payload: unknown): void => {
    const win = mainWindow
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
  }

  hostKeys = new HostKeyBroker(() => mainWindow)
  const ssh = new SshService({
    knownHosts,
    hostKeys,
    getLegacyAlgorithms: () => store.getSettings().legacySshAlgorithms
  })
  const runner = new RunManager({
    store,
    vault,
    ssh,
    logs,
    settings: () => store.getSettings(),
    emit
  })

  const ctx: AppContext = {
    dataDir,
    store,
    vault,
    knownHosts,
    ssh,
    hostKeys,
    logs,
    runner,
    getWindow: () => mainWindow
  }

  runnerRef = runner
  storeRef = store
  registerIpc(ctx)
  await applyRetention(store, logs)

  const state = await loadWindowState(dataDir)
  mainWindow = createWindow(state, dataDir)

  const notices: AppNotice[] = []
  if (store.wasCorruptOnLoad()) {
    notices.push({ level: 'warning', message: '数据文件损坏，已备份并使用空数据启动' })
  }
  if (!vault.isAvailable()) {
    notices.push({ level: 'warning', message: '当前系统不支持安全存储，密码将无法保存' })
  }
  if (notices.length > 0) {
    mainWindow.webContents.once('did-finish-load', () => {
      for (const notice of notices) emit(EV.appNotice, notice)
    })
  }

  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow({ width: 1280, height: 800 }, dataDir)
    }
  })
}

async function requestQuit(win: BrowserWindow | null): Promise<void> {
  const runner = runnerRef
  if (!runner) {
    app.quit()
    return
  }
  const ids = runner.getActiveRunIds()
  if (ids.length === 0) {
    app.quit()
    return
  }
  const options = {
    type: 'warning' as const,
    title: 'Corral',
    message: '仍有 ' + String(ids.length) + ' 个任务在执行',
    detail: '退出后任务将被中断，远端进程可能继续运行。',
    buttons: ['取消', '仍然退出'],
    defaultId: 0,
    cancelId: 0
  }
  const result = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options)
  if (result.response === 1) {
    quitting = true
    await runner.cancelAll()
    await storeRef?.flush()
    app.quit()
  }
}

function createWindow(state: WindowState, dataDir: string): BrowserWindow {
  const win = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 1100,
    minHeight: 720,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false
    }
  })

  if (state.maximized) win.maximize()
  win.once('ready-to-show', () => win.show())

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault()
  })

  if (!app.isPackaged) {
    win.webContents.on('console-message', (details) => {
      console.log('[renderer:' + details.level + '] ' + details.message)
    })
    win.webContents.on('did-fail-load', (_event, code, description) => {
      console.error('[renderer] did-fail-load ' + String(code) + ' ' + description)
    })
  }

  if (app.isPackaged) {
    Menu.setApplicationMenu(null)
    win.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return
      const key = input.key.toLowerCase()
      if (key === 'f12' || (input.control && input.shift && key === 'i')) {
        event.preventDefault()
      }
    })
    win.webContents.on('context-menu', (event) => event.preventDefault())
  }

  win.on('close', (event) => {
    if (!quitting && runnerRef && runnerRef.getActiveRunIds().length > 0) {
      event.preventDefault()
      void requestQuit(win)
      return
    }
    const bounds = win.getNormalBounds()
    const payload: WindowState = {
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      maximized: win.isMaximized()
    }
    void writeFileAtomic(join(dataDir, 'window-state.json'), JSON.stringify(payload, null, 2))
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = mainWindow
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.focus()
  })

  app.whenReady()
    .then(async () => {
      session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
        callback(false)
      })
      session.defaultSession.setPermissionCheckHandler(() => false)
      await bootstrap()
    })
    .catch((error: unknown) => {
      console.error('[corral] startup failed', error)
      dialog.showErrorBox('Corral 启动失败', error instanceof Error ? error.message : String(error))
      app.quit()
    })

  app.on('before-quit', (event) => {
    if (quitting) return
    const runner = runnerRef
    if (!runner) return
    if (runner.getActiveRunIds().length === 0) return
    event.preventDefault()
    void requestQuit(mainWindow)
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
