import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type { CorralApi } from '@shared/ipc'
import { CH, EV } from '@shared/ipc'
import type { IpcResult } from '@shared/types'

function invoke<T>(channel: string, payload?: unknown): Promise<IpcResult<T>> {
  return ipcRenderer.invoke(channel, payload) as Promise<IpcResult<T>>
}

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: T): void => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.off(channel, listener)
  }
}

const api: CorralApi = {
  server: {
    list: () => invoke(CH.serverList),
    create: (input) => invoke(CH.serverCreate, input),
    update: (payload) => invoke(CH.serverUpdate, payload),
    remove: (id) => invoke(CH.serverRemove, id),
    test: (payload) => invoke(CH.serverTest, payload),
    trustHostKey: (payload) => invoke(CH.serverTrustHostKey, payload)
  },
  env: {
    list: (serverId) => invoke(CH.envList, serverId),
    create: (input) => invoke(CH.envCreate, input),
    update: (payload) => invoke(CH.envUpdate, payload),
    remove: (id) => invoke(CH.envRemove, id),
    validatePaths: (payload) => invoke(CH.envValidatePaths, payload)
  },
  run: {
    precheck: (payload) => invoke(CH.runPrecheck, payload),
    start: (payload) => invoke(CH.runStart, payload),
    cancel: (runId) => invoke(CH.runCancel, { runId }),
    list: (filter) => invoke(CH.runList, filter ?? {}),
    readLog: (payload) => invoke(CH.runReadLog, payload),
    exportLog: (runId) => invoke(CH.runExportLog, runId),
    remove: (runId) => invoke(CH.runRemove, { runId }),
    clear: (filter) => invoke(CH.runClear, filter ?? {})
  },
  settings: {
    get: () => invoke(CH.settingsGet),
    update: (patch) => invoke(CH.settingsUpdate, patch)
  },
  app: {
    getBootState: () => invoke(CH.appGetBootState),
    openDataDir: () => invoke(CH.appOpenDataDir),
    exportConfig: () => invoke(CH.appExportConfig),
    copyText: (text) => invoke(CH.appCopyText, text)
  },
  hostkey: {
    decide: (payload) => invoke(CH.hostkeyDecision, payload)
  },
  dialog: {
    pickFiles: (options) => invoke(CH.dialogPickFiles, options ?? {}),
    pickDirectory: () => invoke(CH.dialogPickDirectory)
  },
  events: {
    onRunStatus: (callback) => subscribe(EV.runStatus, callback),
    onRunOutput: (callback) => subscribe(EV.runOutput, callback),
    onRunProgress: (callback) => subscribe(EV.runProgress, callback),
    onRunDone: (callback) => subscribe(EV.runDone, callback),
    onHostKeyChallenge: (callback) => subscribe(EV.hostkeyChallenge, callback),
    onAppNotice: (callback) => subscribe(EV.appNotice, callback)
  }
}

contextBridge.exposeInMainWorld('api', api)
