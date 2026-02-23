import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export function createStandaloneViteConfig(configUrl: string, port: number) {
  const appRoot = dirname(fileURLToPath(configUrl))

  return {
    root: appRoot,
    server: {
      host: '0.0.0.0',
      port,
      fs: {
        allow: [resolve(appRoot, '..')],
      },
    },
    build: {
      outDir: resolve(appRoot, 'dist'),
      emptyOutDir: true,
    },
  }
}
