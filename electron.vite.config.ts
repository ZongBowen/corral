import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

const root = (path: string): string => resolve(__dirname, path)
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
  main: { resolve: { alias } },
  preload: { resolve: { alias } },
  renderer: {
    root: root('src/renderer'),
    resolve: { alias },
    plugins: [react(), cspPlugin()]
  }
})
