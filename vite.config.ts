// vite.config.ts
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import { loadAppPlugins } from './vite-plugins'

// ---------------------------------------------------------------------------
// Standalone app registry (apps.json + APP_PATH env override)
// ---------------------------------------------------------------------------

const APPS_CACHE_DIR = resolve('.apps-cache')

function isGitUrl(value: string): boolean {
  const base = value.split('#')[0] ?? ''
  return base.startsWith('https://') || base.startsWith('git@')
}

function resolveGitEntry(name: string, value: string): string {
  const [, subpath] = value.split('#')
  const base = resolve(APPS_CACHE_DIR, name)
  return subpath ? resolve(base, subpath) : base
}

function loadStandaloneApps(): Record<string, string> {
  const apps: Record<string, string> = {}

  if (existsSync('apps.json')) {
    const raw = JSON.parse(readFileSync('apps.json', 'utf8')) as Record<string, string>
    for (const [name, value] of Object.entries(raw)) {
      apps[name] = isGitUrl(value) ? resolveGitEntry(name, value) : resolve(value)
    }
  }

const appName = process.env.APP_NAME ?? process.env.VITE_APP_NAME ?? ''
  const appPath = process.env.APP_PATH ?? ''
  if (appName && appPath) {
    apps[appName] = resolve(appPath)
  }

  return apps
}

const standaloneApps = loadStandaloneApps()

// ---------------------------------------------------------------------------
// Selected standalone app HTML: serve the app's own index.html
// ---------------------------------------------------------------------------

function standaloneAppHtmlPlugin(): Plugin | null {
  const selectedApp = process.env.VITE_APP_NAME ?? process.env.APP_NAME ?? ''
  const appDir = standaloneApps[selectedApp]
  if (!appDir) return null

  const absAppDir = resolve(appDir)
  const htmlPath = resolve(absAppDir, 'index.html')
  if (!existsSync(htmlPath)) return null

  return {
    name: 'external-app-html',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? ''
        if (url !== '/' && url !== '/index.html') {
          next()
          return
        }

        try {
          let html = readFileSync(htmlPath, 'utf-8')
          // Rewrite local absolute paths to /@fs/ so Vite resolves them
          // from the external app's directory instead of even-dev's root
          html = html.replace(
            /(src|href)=(["'])\/(?!\/|@|http)/g,
            `$1=$2/@fs/${absAppDir}/`,
          )
          html = await server.transformIndexHtml(url, html)
          res.statusCode = 200
          res.setHeader('Content-Type', 'text/html')
          res.end(html)
        } catch (e) {
          next(e)
        }
      })
    },
  }
}

// ---------------------------------------------------------------------------
// fs.allow from selected standalone app directories
// ---------------------------------------------------------------------------

function buildFsAllow(): string[] {
  const dirs = new Set<string>()
  for (const absPath of Object.values(standaloneApps)) {
    dirs.add(absPath)
    dirs.add(resolve(absPath, '..'))
  }
  return [...dirs]
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export default defineConfig({
  plugins: [
    standaloneAppHtmlPlugin(),
    ...loadAppPlugins({ externalApps: standaloneApps }),
  ].filter(Boolean),
  server: {
    host: true,
    port: 5173,
    fs: {
      allow: ['.', ...buildFsAllow()],
    },
  },
})
