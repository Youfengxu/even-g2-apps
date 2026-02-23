import { EvenBetterSdk } from '@jappyjan/even-better-sdk'
import { OsEventTypeList, type EvenHubEvent } from '@evenrealities/even_hub_sdk'
import { withTimeout } from '../../_shared/async'
import { getRawEventType, normalizeEventType } from '../../_shared/even-events'
import { appendEventLog } from '../../_shared/log'

type SetStatus = (text: string) => void

type AppActions = {
  connect: () => Promise<void>
  action: () => Promise<void>
}

export type BaseTemplateActions = AppActions & {
  decrementCounter: () => Promise<void>
  incrementCounter: (source?: string) => Promise<void>
  resetCounter: () => Promise<void>
  syncGlasses: () => Promise<void>
}

const THEME_OPTIONS = ['Blue', 'Green', 'Orange'] as const
type ThemeName = (typeof THEME_OPTIONS)[number]

type TemplateState = {
  counter: number
  active: boolean
  selectedTheme: number
  lastEvent: string
}

type BrowserUi = {
  preview: HTMLDivElement
  counterValue: HTMLSpanElement
  stateValue: HTMLSpanElement
  themeValue: HTMLSpanElement
  lastEventValue: HTMLSpanElement
  barFill: HTMLDivElement
}

type TemplateClient = {
  mode: 'bridge' | 'mock'
  start: () => Promise<void>
  syncToGlasses: () => Promise<void>
}

const state: TemplateState = {
  counter: 0,
  active: false,
  selectedTheme: 0,
  lastEvent: 'none',
}

let browserUi: BrowserUi | null = null
let templateClient: TemplateClient | null = null

function clampThemeIndex(index: number): number {
  return Math.max(0, Math.min(THEME_OPTIONS.length - 1, index))
}

function getCurrentTheme(): ThemeName {
  return THEME_OPTIONS[clampThemeIndex(state.selectedTheme)]
}

function getPreviewBackground(theme: ThemeName, active: boolean): string {
  const alpha = active ? '0.95' : '0.45'
  switch (theme) {
    case 'Green':
      return `linear-gradient(135deg, rgba(12, 90, 46, ${alpha}), rgba(27, 140, 90, ${alpha}))`
    case 'Orange':
      return `linear-gradient(135deg, rgba(125, 56, 12, ${alpha}), rgba(185, 92, 34, ${alpha}))`
    case 'Blue':
    default:
      return `linear-gradient(135deg, rgba(18, 64, 130, ${alpha}), rgba(40, 120, 202, ${alpha}))`
  }
}

function getEventTypeLabel(type: OsEventTypeList | undefined): string {
  switch (type) {
    case OsEventTypeList.CLICK_EVENT:
      return 'click'
    case OsEventTypeList.DOUBLE_CLICK_EVENT:
      return 'double-click'
    case OsEventTypeList.SCROLL_TOP_EVENT:
      return 'scroll-up'
    case OsEventTypeList.SCROLL_BOTTOM_EVENT:
      return 'scroll-down'
    default:
      return 'unknown'
  }
}

function parseIncomingThemeIndex(event: EvenHubEvent): number {
  const raw = (event.jsonData ?? {}) as Record<string, unknown>
  const indexFromList = event.listEvent?.currentSelectItemIndex
  const indexFromRaw = (
    raw.currentSelectItemIndex ??
    raw.current_select_item_index ??
    raw.currentSelectedIndex ??
    raw.current_selected_index
  )
  const nameFromList = event.listEvent?.currentSelectItemName
  const nameFromRaw = (
    raw.currentSelectItemName ??
    raw.current_select_item_name ??
    raw.currentSelectedName ??
    raw.current_selected_name
  )

  const parseIndex = (value: unknown): number => {
    if (typeof value === 'number') return value
    if (typeof value === 'string') return Number.parseInt(value, 10)
    return -1
  }

  const normalizeName = (value: unknown): string => {
    if (typeof value !== 'string') return ''
    return value.trim().toLowerCase()
  }

  const parsed = parseIndex(indexFromList)
  if (Number.isFinite(parsed) && parsed >= 0 && parsed < THEME_OPTIONS.length) {
    return parsed
  }

  const parsedRaw = parseIndex(indexFromRaw)
  if (Number.isFinite(parsedRaw) && parsedRaw >= 0 && parsedRaw < THEME_OPTIONS.length) {
    return parsedRaw
  }

  const incomingName = normalizeName(nameFromList) || normalizeName(nameFromRaw)
  if (incomingName) {
    const byExactName = THEME_OPTIONS.findIndex((name) => name.toLowerCase() === incomingName)
    if (byExactName >= 0) return byExactName

    const byPrefix = THEME_OPTIONS.findIndex((name) => incomingName.startsWith(name.toLowerCase()))
    if (byPrefix >= 0) return byPrefix
  }

  return -1
}

function updateStateFromHubSelection(
  event: EvenHubEvent,
  eventType: OsEventTypeList | undefined,
): void {
  const incomingIndex = parseIncomingThemeIndex(event)
  const hasIncomingIndex = incomingIndex >= 0 && incomingIndex < THEME_OPTIONS.length
  const hasListEvent = Boolean(event.listEvent)

  if (eventType === OsEventTypeList.SCROLL_TOP_EVENT) {
    state.selectedTheme = hasIncomingIndex
      ? clampThemeIndex(incomingIndex)
      : clampThemeIndex(state.selectedTheme - 1)
    return
  }

  if (eventType === OsEventTypeList.SCROLL_BOTTOM_EVENT) {
    state.selectedTheme = hasIncomingIndex
      ? clampThemeIndex(incomingIndex)
      : clampThemeIndex(state.selectedTheme + 1)
    return
  }

  if (eventType === OsEventTypeList.CLICK_EVENT) {
    // Some simulator click events on the first row omit index/name.
    state.selectedTheme = hasIncomingIndex ? clampThemeIndex(incomingIndex) : 0
    return
  }

  // Simulator fallback: list event can arrive with missing eventType/index for row 0.
  if (eventType === undefined && hasListEvent) {
    state.selectedTheme = hasIncomingIndex ? clampThemeIndex(incomingIndex) : 0
    if (!hasIncomingIndex) {
      state.lastEvent = 'glasses: list-fallback -> Blue'
    }
    return
  }

  if (hasIncomingIndex) {
    state.selectedTheme = clampThemeIndex(incomingIndex)
  }
}

function ensureTemplateStyles(): void {
  if (document.getElementById('base-app-style')) {
    return
  }

  const style = document.createElement('style')
  style.id = 'base-app-style'
  style.textContent = `
    #base-app-panel {
      margin-top: 16px;
      border: 1px solid #2f2f2f;
      border-radius: 10px;
      padding: 12px;
      background: #141414;
    }
    #base-app-preview {
      border-radius: 10px;
      min-height: 88px;
      padding: 10px;
      color: #f6f6f6;
      border: 1px solid rgba(255,255,255,0.16);
      margin-bottom: 10px;
    }
    #base-app-preview-title {
      font-size: 13px;
      font-weight: 700;
      opacity: 0.95;
    }
    #base-app-preview-subtitle {
      font-size: 12px;
      opacity: 0.85;
      margin-top: 6px;
    }
    #base-app-metrics {
      font-size: 12px;
      line-height: 1.55;
      color: #d5d5d5;
    }
    #base-app-bar {
      height: 8px;
      background: #232323;
      border-radius: 999px;
      overflow: hidden;
      margin: 8px 0 10px;
    }
    #base-app-bar-fill {
      height: 100%;
      width: 0%;
      background: #57a3ff;
      transition: width 160ms ease;
    }
  `
  document.head.appendChild(style)
}

function renderBrowserPanel(): void {
  if (!browserUi) return

  const theme = getCurrentTheme()
  const normalizedCounter = Math.max(0, Math.min(100, state.counter))
  const barWidth = `${normalizedCounter}%`

  browserUi.counterValue.textContent = String(state.counter)
  browserUi.stateValue.textContent = state.active ? 'active' : 'idle'
  browserUi.themeValue.textContent = theme
  browserUi.lastEventValue.textContent = state.lastEvent
  browserUi.preview.style.background = getPreviewBackground(theme, state.active)
  browserUi.barFill.style.width = barWidth
}

function ensureBrowserPanel(syncToGlasses: () => Promise<void>): void {
  if (browserUi) return

  ensureTemplateStyles()

  const appRoot = document.getElementById('app')
  if (!appRoot) return

  const root = document.createElement('div')
  root.id = 'base-app-panel'
  root.innerHTML = `
    <div id="base-app-preview">
      <div id="base-app-preview-title">Web App Preview Panel</div>
      <div id="base-app-preview-subtitle">Use controls above to modify state and mirror it on glasses.</div>
    </div>
    <div id="base-app-bar"><div id="base-app-bar-fill"></div></div>
    <div id="base-app-metrics">
      <div>Counter: <span id="base-app-counter">0</span></div>
      <div>State: <span id="base-app-state">idle</span></div>
      <div>Theme: <span id="base-app-theme">Blue</span></div>
      <div>Last Event: <span id="base-app-last-event">none</span></div>
    </div>
  `
  appRoot.appendChild(root)

  const preview = root.querySelector('#base-app-preview') as HTMLDivElement | null
  const counterValue = root.querySelector('#base-app-counter') as HTMLSpanElement | null
  const stateValue = root.querySelector('#base-app-state') as HTMLSpanElement | null
  const themeValue = root.querySelector('#base-app-theme') as HTMLSpanElement | null
  const lastEventValue = root.querySelector('#base-app-last-event') as HTMLSpanElement | null
  const barFill = root.querySelector('#base-app-bar-fill') as HTMLDivElement | null

  if (!preview || !counterValue || !stateValue || !themeValue || !lastEventValue || !barFill) {
    return
  }

  browserUi = {
    preview,
    counterValue,
    stateValue,
    themeValue,
    lastEventValue,
    barFill,
  }

  renderBrowserPanel()
}

function getMockTemplateClient(): TemplateClient {
  return {
    mode: 'mock',
    async start() {
      appendEventLog('Base template: mock mode active (bridge unavailable)')
    },
    async syncToGlasses() {
      // No-op in mock mode.
    },
  }
}

function getBridgeTemplateClient(): TemplateClient {
  const sdk = new EvenBetterSdk()
  const page = sdk.createPage('hub-base-template')

  const stateText = page.addTextElement('Base Template | State: idle')
  stateText
    .setPosition((position) => position.setX(8).setY(10))
    .setSize((size) => size.setWidth(560).setHeight(52))

  const counterText = page.addTextElement('Counter: 0 | Up/Down Theme, Click Toggle, Dbl Reset')
  counterText
    .setPosition((position) => position.setX(8).setY(64))
    .setSize((size) => size.setWidth(560).setHeight(62))

  const themeList = page.addListElement([...THEME_OPTIONS])
  themeList
    .setPosition((position) => position.setX(4).setY(132))
    .setSize((size) => size.setWidth(572).setHeight(156))
    .markAsEventCaptureElement()
  themeList.setItemWidth(566)
  themeList.setIsItemSelectBorderEn(true)

  let startupRendered = false

  const syncToGlasses = async (): Promise<void> => {
    stateText.setContent(`Base Template | State: ${state.active ? 'active' : 'idle'} | Theme: ${getCurrentTheme()}`)
    counterText.setContent(`Counter: ${state.counter} | Last: ${state.lastEvent}`)

    // even-better-sdk is great for content updates; if this template later starts
    // changing element positions/sizes, prefer a full `page.render()` path for those
    // layout updates because partial text updates only change content.
    if (!startupRendered) {
      await page.render()
      startupRendered = true
      return
    }

    const stateUpdated = await stateText.updateWithEvenHubSdk()
    const counterUpdated = await counterText.updateWithEvenHubSdk()

    if (!stateUpdated || !counterUpdated) {
      await page.render()
    }
  }

  sdk.addEventListener((event) => {
    const eventType = normalizeEventType(getRawEventType(event), OsEventTypeList)
    updateStateFromHubSelection(event, eventType)

    switch (eventType) {
      case OsEventTypeList.CLICK_EVENT:
        state.active = !state.active
        break
      case OsEventTypeList.DOUBLE_CLICK_EVENT:
        state.counter = 0
        state.active = false
        break
      default:
        break
    }

    state.lastEvent = `glasses: ${getEventTypeLabel(eventType)}`
    appendEventLog(`Base template: ${state.lastEvent}, theme=${getCurrentTheme()}, counter=${state.counter}`)
    renderBrowserPanel()
    void syncToGlasses()
  })

  return {
    mode: 'bridge',
    async start() {
      await syncToGlasses()
    },
    syncToGlasses,
  }
}

async function initTemplate(timeoutMs = 4000): Promise<{ template: TemplateClient }> {
  try {
    await withTimeout(EvenBetterSdk.getRawBridge(), timeoutMs)

    if (!templateClient || templateClient.mode !== 'bridge') {
      templateClient = getBridgeTemplateClient()
    }

    return { template: templateClient }
  } catch {
    return { template: getMockTemplateClient() }
  }
}

export function createBaseAppActions(setStatus: SetStatus): BaseTemplateActions {
  ensureBrowserPanel(async () => {
    if (templateClient) {
      await templateClient.syncToGlasses()
    }
  })

  async function syncIfConnected(): Promise<boolean> {
    if (!templateClient) {
      setStatus('Base template: not connected')
      appendEventLog('Base template: action blocked (not connected)')
      return false
    }

    renderBrowserPanel()
    await templateClient.syncToGlasses()
    return true
  }

  async function incrementCounter(source = 'web: main action button'): Promise<void> {
    state.counter += 1
    state.lastEvent = source
    if (await syncIfConnected()) {
      setStatus('Base template: counter incremented and synced.')
      appendEventLog(`Base template: ${source}`)
    }
  }

  return {
    async connect() {
      setStatus('Base template: connecting to Even bridge...')
      appendEventLog('Base template: connect requested')

      try {
        const { template } = await initTemplate()
        templateClient = template
        await templateClient.start()
        renderBrowserPanel()

        if (template.mode === 'bridge') {
          setStatus('Base template: connected. Web panel + glasses view are synchronized.')
          appendEventLog('Base template: bridge connected')
        } else {
          setStatus('Base template: bridge unavailable. Running browser-only mock mode.')
          appendEventLog('Base template: mock mode')
        }
      } catch (error) {
        console.error(error)
        setStatus('Base template: connection failed')
        appendEventLog('Base template: connection failed')
      }
    },

    async action() {
      await incrementCounter('web: main action button')
    },
    incrementCounter,
    async decrementCounter() {
      state.counter = Math.max(0, state.counter - 1)
      state.lastEvent = 'web: counter -1'
      if (await syncIfConnected()) {
        setStatus('Base template: counter decremented and synced.')
        appendEventLog('Base template: web: counter -1')
      }
    },
    async resetCounter() {
      state.counter = 0
      state.active = false
      state.lastEvent = 'web: reset'
      if (await syncIfConnected()) {
        setStatus('Base template: reset and synced.')
        appendEventLog('Base template: web: reset')
      }
    },
    async syncGlasses() {
      state.lastEvent = 'web: manual sync'
      if (await syncIfConnected()) {
        setStatus('Base template: synced to glasses.')
        appendEventLog('Base template: web: manual sync')
      }
    },
  }
}
