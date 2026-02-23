function setText(id: string, text: string) {
  const el = document.getElementById(id)
  if (el) {
    el.textContent = text
  }
}

function appendLog(line: string) {
  const log = document.getElementById('event-log')
  if (!log) return
  const prefix = log.textContent && log.textContent.length > 0 ? '\n' : ''
  log.textContent += `${prefix}${line}`
}

function boot() {
  const selectedApp = String(import.meta.env.VITE_APP_NAME ?? '')

  setText('status', selectedApp ? `Standalone app selected: ${selectedApp}` : 'No app selected')

  setText(
    'connectBtn',
    selectedApp ? 'Use ./start-even.sh' : 'Select a standalone app',
  )
  setText('actionBtn', 'Standalone apps own their UI')

  const connectBtn = document.getElementById('connectBtn') as HTMLButtonElement | null
  const actionBtn = document.getElementById('actionBtn') as HTMLButtonElement | null
  if (connectBtn) connectBtn.disabled = true
  if (actionBtn) actionBtn.disabled = true

  appendLog('Built-in apps under /apps are standalone applications.')
  appendLog('This root page is only a fallback launcher shell.')
  if (selectedApp) {
    appendLog(`Selected app: ${selectedApp}`)
  }
  appendLog('Run ./start-even.sh and choose an app from /apps or apps.json.')
}

boot()
