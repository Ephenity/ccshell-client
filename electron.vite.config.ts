import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

const release = process.env.CCSHELL_RELEASE === '1'
const define = { __TEST_HOOKS__: JSON.stringify(!release) }

const stripTestEnv = {
  name: 'ccshell-strip-test-env',
  transform(code: string, id: string) {
    if (!release || !/[\\/]src[\\/]/.test(id) || !code.includes('testEnv(')) return null
    return { code: code.replace(/\btestEnv\((['"])CCSHELL_[A-Z_]+\1\)/g, 'undefined'), map: null }
  }
}

export default defineConfig({
  main: {
    define,
    plugins: [stripTestEnv],
    build: {
      rollupOptions: {
        input: { index: resolve('src/main/index.ts'), host: resolve('src/host/index.ts'), attach: resolve('src/host/attach.ts') }
      }
    }
  },
  preload: { define },
  renderer: {
    define,
    resolve: { alias: { '@renderer': resolve('src/renderer/src') } },
    server: { host: '127.0.0.1', port: 5173, strictPort: true },
    plugins: [react(), tailwindcss()]
  }
})
