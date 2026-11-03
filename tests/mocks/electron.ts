import { vi } from 'vitest'

export const app = {
  getPath: vi.fn(() => 'C:/tmp/corral-test'),
  getVersion: vi.fn(() => '0.1.0'),
  isPackaged: false,
  whenReady: vi.fn(async () => undefined),
  on: vi.fn(),
  quit: vi.fn(),
  exit: vi.fn()
}

export const safeStorage = {
  isAsyncEncryptionAvailable: vi.fn(async () => true),
  isEncryptionAvailable: vi.fn(() => true),
  encryptStringAsync: vi.fn(async (value: string) => Buffer.from('enc:' + value, 'utf8')),
  decryptStringAsync: vi.fn(async (value: Buffer) => ({
    shouldReEncrypt: false,
    result: value.toString('utf8').replace(/^enc:/, '')
  })),
  encryptString: vi.fn((value: string) => Buffer.from('enc:' + value, 'utf8')),
  decryptString: vi.fn((value: Buffer) => value.toString('utf8').replace(/^enc:/, ''))
}

export const ipcMain = {
  handle: vi.fn(),
  on: vi.fn(),
  removeHandler: vi.fn()
}

export const shell = {
  openPath: vi.fn(async () => ''),
  openExternal: vi.fn(async () => undefined)
}

export const dialog = {
  showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })),
  showSaveDialog: vi.fn(async () => ({ canceled: true, filePath: undefined })),
  showMessageBox: vi.fn(async () => ({ response: 0 }))
}

export class BrowserWindow {
  static getAllWindows = vi.fn(() => [])
  webContents = { send: vi.fn(), id: 1 }
  isDestroyed = vi.fn(() => false)
  on = vi.fn()
  loadURL = vi.fn()
  loadFile = vi.fn()
  show = vi.fn()
}

export default { app, safeStorage, ipcMain, shell, dialog, BrowserWindow }
