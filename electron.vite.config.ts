import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

const root = (p: string) => resolve(__dirname, p)
const alias = {
  '@shared': root('src/shared'),
  '@main': root('src/main'),
  '@renderer': root('src/renderer/src')
}

const CSP_DEV = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self' ws://localhost:* http://localhost:*"
].join('; ')

const CSP_PROD = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'"
].join('; ')

function cspPlugin(): Plugin {
  return {
    name: 'corral:csp',
    transformIndexHtml(html, ctx) {
      const csp = ctx.server ? CSP_DEV : CSP_PROD
      return html.replace(
        '<!-- CSP -->',
        '<meta http-equiv="Content-Security-Policy" content="' + csp + '">'
      )
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
    build: { sourcemap: true }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
    build: { sourcemap: true }
  },
  renderer: {
    root: root('src/renderer'),
    plugins: [react(), cspPlugin()],
    resolve: { alias },
    build: { sourcemap: true }
  }
})
