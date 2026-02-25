import { EvenBetterSdk } from '@jappyjan/even-better-sdk'
import { OsEventTypeList } from '@evenrealities/even_hub_sdk'
import type { AppActions, SetStatus } from '../_shared/app-types'
import { appendEventLog } from '../_shared/log'

type PhoneNotification = {
  app: string
  title: string
  text: string
  timestamp?: number
  type?: string
}

type NotifClient = {
  mode: 'bridge' | 'mock'
  start: () => Promise<void>
  showNotif: (n: PhoneNotification) => Promise<void>
  showBlank: () => Promise<void>
}

let notifClient: NotifClient | null = null
let sseSource: EventSource | null = null
let pendingNotif: PhoneNotification | null = null
let isDisplaying = false

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error(`Even bridge not detected within ${timeoutMs}ms`)),
      timeoutMs,
    )
    promise
      .then((value) => resolve(value))
      .catch((error) => reject(error))
      .finally(() => window.clearTimeout(timer))
  })
}

// ---------------------------------------------------------------------------
// App filter — stored in localStorage
// ---------------------------------------------------------------------------

function getAllowedApps(): string[] {
  try {
    const raw = localStorage.getItem('notif-allowed-apps')
    if (!raw) return []
    return JSON.parse(raw) as string[]
  } catch { return [] }
}

function saveAllowedApps(apps: string[]): void {
  localStorage.setItem('notif-allowed-apps', JSON.stringify(apps))
}

function isAllowed(app: string): boolean {
  const allowed = getAllowedApps()
  if (allowed.length === 0) return true
  return allowed.some((a) => a.toLowerCase() === app.toLowerCase())
}

// ---------------------------------------------------------------------------
// Glasses display helpers
// ---------------------------------------------------------------------------

function formatForGlasses(n: PhoneNotification): string {
  const lines: string[] = []
  if (n.app) lines.push(`[${n.app}]`)
  if (n.title) lines.push(n.title)
  if (n.text) lines.push(n.text)
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Notif client — mock (no glasses)
// ---------------------------------------------------------------------------

function getMockNotifClient(): NotifClient {
  return {
    mode: 'mock',
    async start() { appendEventLog('Notif: mock mode active') },
    async showNotif(n) { appendEventLog(`Notif mock: ${formatForGlasses(n)}`) },
    async showBlank() { appendEventLog('Notif mock: display blank') },
  }
}

// ---------------------------------------------------------------------------
// Notif client — bridge (real glasses)
// ---------------------------------------------------------------------------

function getBridgeNotifClient(): NotifClient {
  const sdk = new EvenBetterSdk()
  const page = sdk.createPage('hub-notif-page')

  const display = page.addTextElement(' ')
  display
    .setPosition((p) => p.setX(0).setY(0))
    .setSize((s) => s.setWidth(576).setHeight(288))
    .markAsEventCaptureElement()

  // Double-tap: toggle between showing pending notification and blank
  sdk.addEventListener((event) => {
    const rawType =
      event.listEvent?.eventType ??
      event.textEvent?.eventType ??
      event.sysEvent?.eventType
    const isDoubleTap = rawType === OsEventTypeList.DOUBLE_CLICK_EVENT

    if (isDoubleTap && notifClient) {
      if (isDisplaying) {
        isDisplaying = false
        void notifClient.showBlank()
      } else if (pendingNotif) {
        isDisplaying = true
        void notifClient.showNotif(pendingNotif)
      }
    }
  })

  return {
    mode: 'bridge',
    async start() {
      await page.render()
    },
    async showNotif(n) {
      display.setContent(formatForGlasses(n))
      const updated = await display.updateWithEvenHubSdk()
      if (!updated) await page.render()
    },
    async showBlank() {
      display.setContent(' ')
      const updated = await display.updateWithEvenHubSdk()
      if (!updated) await page.render()
    },
  }
}

// ---------------------------------------------------------------------------
// Bridge init
// ---------------------------------------------------------------------------

async function initNotif(timeoutMs = 4000): Promise<{ client: NotifClient }> {
  try {
    await withTimeout(EvenBetterSdk.getRawBridge(), timeoutMs)
    if (!notifClient || notifClient.mode !== 'bridge') {
      notifClient = getBridgeNotifClient()
    }
    return { client: notifClient }
  } catch {
    return { client: getMockNotifClient() }
  }
}

// ---------------------------------------------------------------------------
// SSE stream
// ---------------------------------------------------------------------------

function startSSE(setStatus: SetStatus): void {
  if (sseSource) {
    sseSource.close()
    sseSource = null
  }

  sseSource = new EventSource('/api/notif/stream')

  sseSource.onopen = () => {
    appendEventLog('Notif: SSE stream connected')
  }

  sseSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data as string) as PhoneNotification
      if (data.type === 'connected') return

      if (!isAllowed(data.app)) {
        appendEventLog(`Notif: filtered [${data.app}]`)
        return
      }

      // Store silently — display stays blank until double-tap
      pendingNotif = data
      appendEventLog(`Notif: stored [${data.app}] ${data.title}`)
      setStatus(`Notif: new notification from ${data.app} — double-tap to view`)
    } catch (err) {
      console.error('[notif] SSE parse error', err)
    }
  }

  sseSource.onerror = () => {
    appendEventLog('Notif: SSE stream error — retrying...')
    setStatus('Notif: stream disconnected — retrying...')
  }
}

// ---------------------------------------------------------------------------
// Browser UI — allowed apps panel
// ---------------------------------------------------------------------------

function ensureNotifBrowserUi(): void {
  if (document.getElementById('notif-config-panel')) return

  const appRoot = document.getElementById('app')
  if (!appRoot) return

  const style = document.createElement('style')
  style.textContent = `
    #notif-config-panel {
      margin-top: 16px;
      border: 1px solid #2f2f2f;
      border-radius: 10px;
      padding: 12px;
      background: #141414;
      font-size: 12px;
      color: #d5d5d5;
    }
    #notif-config-panel h3 {
      margin: 0 0 8px;
      font-size: 13px;
      font-weight: 700;
      color: #f6f6f6;
    }
    #notif-app-list { margin-bottom: 8px; min-height: 24px; }
    .notif-app-tag {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      background: #222;
      border-radius: 4px;
      padding: 2px 8px;
      margin: 2px;
    }
    .notif-app-tag button {
      background: none;
      border: none;
      color: #f66;
      cursor: pointer;
      padding: 0 2px;
      font-size: 14px;
      line-height: 1;
    }
    #notif-add-row {
      display: flex;
      gap: 8px;
      margin-bottom: 8px;
    }
    #notif-app-input {
      flex: 1;
      padding: 6px 8px;
      background: #1e1e1e;
      border: 1px solid #3f3f3f;
      border-radius: 6px;
      color: #f6f6f6;
      font-size: 12px;
    }
    #notif-config-panel .hint {
      color: #666;
      margin-top: 8px;
      line-height: 1.6;
    }
    #notif-config-panel code {
      background: #1e1e1e;
      padding: 1px 5px;
      border-radius: 3px;
      color: #aaa;
    }
  `
  document.head.appendChild(style)

  const panel = document.createElement('div')
  panel.id = 'notif-config-panel'
  panel.innerHTML = `
    <h3>Allowed Apps</h3>
    <div id="notif-app-list"></div>
    <div id="notif-add-row">
      <input id="notif-app-input" type="text" placeholder="App name (e.g. WhatsApp)" />
      <button id="notif-app-add" type="button">Add</button>
      <button id="notif-app-clear" type="button">Clear all</button>
    </div>
    <div class="hint">
      Empty list = allow all apps.<br>
      From Android, POST to <code>/api/notif</code> with body:<br>
      <code>{"app":"WhatsApp","title":"John","text":"Hey!"}</code>
    </div>
  `
  appRoot.appendChild(panel)

  const input = panel.querySelector('#notif-app-input') as HTMLInputElement
  const addBtn = panel.querySelector('#notif-app-add') as HTMLButtonElement
  const clearBtn = panel.querySelector('#notif-app-clear') as HTMLButtonElement
  const list = panel.querySelector('#notif-app-list') as HTMLDivElement

  function renderList(): void {
    const apps = getAllowedApps()
    list.innerHTML = ''
    if (apps.length === 0) {
      list.textContent = '(all apps allowed)'
      list.style.color = '#666'
      return
    }
    list.style.color = ''
    for (const app of apps) {
      const tag = document.createElement('span')
      tag.className = 'notif-app-tag'
      tag.textContent = app
      const remove = document.createElement('button')
      remove.textContent = '×'
      remove.title = `Remove ${app}`
      remove.addEventListener('click', () => {
        saveAllowedApps(getAllowedApps().filter((a) => a !== app))
        renderList()
        appendEventLog(`Notif: removed filter [${app}]`)
      })
      tag.appendChild(remove)
      list.appendChild(tag)
    }
  }

  addBtn.addEventListener('click', () => {
    const name = input.value.trim()
    if (!name) return
    const current = getAllowedApps()
    if (!current.includes(name)) {
      saveAllowedApps([...current, name])
      appendEventLog(`Notif: added filter [${name}]`)
    }
    input.value = ''
    renderList()
  })

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addBtn.click()
  })

  clearBtn.addEventListener('click', () => {
    saveAllowedApps([])
    renderList()
    appendEventLog('Notif: cleared all app filters')
  })

  renderList()
}

// ---------------------------------------------------------------------------
// App actions (connect / test)
// ---------------------------------------------------------------------------

export function createNotifActions(setStatus: SetStatus): AppActions {
  ensureNotifBrowserUi()

  return {
    async connect() {
      setStatus('Notif: connecting to Even bridge...')
      appendEventLog('Notif: connect requested')

      try {
        const { client } = await initNotif()
        notifClient = client

        await client.start()

        if (client.mode === 'bridge') {
          startSSE(setStatus)
          setStatus('Notif: connected. Double-tap glasses to view notifications.')
          appendEventLog('Notif: bridge connected')
        } else {
          setStatus('Notif: error — Even bridge not found. Open this app via the Even App.')
          appendEventLog('Notif: bridge not found')
        }
      } catch (err) {
        console.error(err)
        setStatus('Notif: connection failed')
        appendEventLog('Notif: connection failed')
      }
    },

    async action() {
      if (!notifClient || notifClient.mode !== 'bridge') {
        setStatus('Notif: not connected')
        return
      }

      const test: PhoneNotification = {
        app: 'Test',
        title: 'Test Notification',
        text: new Date().toLocaleTimeString(),
      }

      pendingNotif = test
      isDisplaying = true
      setStatus('Notif: showing test notification...')
      await notifClient.showNotif(test)
      appendEventLog(`Notif: test sent — ${test.text}`)
    },
  }
}
