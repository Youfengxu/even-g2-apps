import './styles.css'
import { parseMinuteSecondInput } from './duration'
import { loadPresetSeconds, savePresetSeconds } from './preset-storage'
import { createTimerController, type TimerPhase } from './timer-controller'

const app = document.querySelector<HTMLDivElement>('#app')

if (!app) {
  throw new Error('Missing #app')
}

app.innerHTML = `
  <header class="hero card">
    <div>
      <p class="eyebrow">Even G2</p>
      <h1 class="page-title">Timer</h1>
      <p class="page-subtitle">Countdown control for glasses with preset durations</p>
    </div>
    <div id="hero-pill" class="hero-pill" aria-live="polite">Ready</div>
  </header>

  <section class="card">
    <div class="top-actions">
      <button id="connect-btn" class="btn btn-primary connect-glasses-btn" type="button">Connect glasses</button>
    </div>
  </section>

  <section class="controls-card card">
    <p class="section-label">Actions</p>
    <div class="controls">
      <button id="start-btn" class="btn" type="button">
        <span class="btn-title">Start Timer</span>
        <span class="btn-subtitle">Start selected preset on glasses</span>
      </button>
      <button id="stop-btn" class="btn" type="button">
        <span class="btn-title">Stop Timer</span>
        <span class="btn-subtitle">Stop active countdown</span>
      </button>
      <button id="clear-log-btn" class="btn btn-ghost" type="button">
        <span class="btn-title">Clear Log</span>
        <span class="btn-subtitle">Reset local event history</span>
      </button>
    </div>
  </section>

  <section class="presets-card card">
    <p class="section-label">Presets</p>
    <div class="preset-form">
      <input id="preset-input" class="preset-input" type="text" inputmode="numeric" placeholder="mm:ss (e.g. 02:30)" />
      <button id="add-preset-btn" class="btn btn-primary compact" type="button">
        <span class="btn-title">Add Preset</span>
      </button>
    </div>
    <p class="hint">Add custom durations in minute:second format. Example: <code>00:45</code>, <code>12:00</code>.</p>
    <div id="preset-list" class="preset-list" aria-live="polite"></div>
  </section>

  <section class="hint-card card">
    <p class="section-label">Glasses Controls</p>
    <p class="hint">Controls on glasses: Up/Down selects duration, Click starts, DoubleClick stops while running.</p>
  </section>

  <section class="log-card card">
    <p class="log-title">Event Log</p>
    <pre id="event-log" aria-live="polite"></pre>
  </section>
`

const logEl = document.querySelector<HTMLPreElement>('#event-log')
const connectBtn = document.querySelector<HTMLButtonElement>('#connect-btn')
const startBtn = document.querySelector<HTMLButtonElement>('#start-btn')
const stopBtn = document.querySelector<HTMLButtonElement>('#stop-btn')
const clearLogBtn = document.querySelector<HTMLButtonElement>('#clear-log-btn')
const heroPillEl = document.querySelector<HTMLDivElement>('#hero-pill')
const presetInputEl = document.querySelector<HTMLInputElement>('#preset-input')
const addPresetBtn = document.querySelector<HTMLButtonElement>('#add-preset-btn')
const presetListEl = document.querySelector<HTMLDivElement>('#preset-list')

if (!logEl || !connectBtn || !startBtn || !stopBtn || !clearLogBtn || !heroPillEl || !presetInputEl || !addPresetBtn || !presetListEl) {
  throw new Error('Missing UI elements')
}

startBtn.disabled = true
stopBtn.disabled = true

function updateHeroPill(phase: TimerPhase): void {
  const config: Record<TimerPhase, { label: string, className: string }> = {
    idle: { label: 'Ready', className: 'is-ready' },
    connecting: { label: 'Connecting', className: 'is-connecting' },
    connected: { label: 'Connected', className: 'is-connected' },
    mock: { label: 'Mock Mode', className: 'is-mock' },
    running: { label: 'Running', className: 'is-running' },
    error: { label: 'Attention', className: 'is-error' },
  }
  const next = config[phase]
  heroPillEl.textContent = next.label
  heroPillEl.className = `hero-pill ${next.className}`
}

function setPhase(phase: TimerPhase): void {
  updateHeroPill(phase)
  startBtn.disabled = !(phase === 'connected' || phase === 'mock')
  stopBtn.disabled = phase !== 'running'
}

function setStatusMessage(_text: string): void {
  // Kept for controller compatibility/reuse; UI intentionally hides verbose status text.
}

function appendLog(text: string): void {
  const time = new Date().toLocaleTimeString()
  logEl.textContent = `[${time}] ${text}\n${logEl.textContent ?? ''}`
  const lines = logEl.textContent.split('\n')
  if (lines.length > 200) {
    logEl.textContent = lines.slice(0, 200).join('\n')
  }
}

const timer = createTimerController({ setStatusMessage, setPhase, log: appendLog })
setPhase('idle')

function renderPresets() {
  const presets = timer.getPresets()
  presetListEl.innerHTML = presets.map((seconds, index) => `
    <div class="preset-chip">
      <span class="preset-chip__time">${timer.formatDuration(seconds)}</span>
      <button class="preset-chip__remove" type="button" data-remove-preset-index="${index}" aria-label="Remove preset ${timer.formatDuration(seconds)}">Remove</button>
    </div>
  `).join('')
}

async function syncPresets(nextValues: number[]) {
  const applied = await timer.setPresets(nextValues)
  savePresetSeconds(applied)
  renderPresets()
}

const storedPresets = loadPresetSeconds()
if (storedPresets && storedPresets.length > 0) {
  void syncPresets(storedPresets)
} else {
  renderPresets()
}

connectBtn.addEventListener('click', () => {
  void timer.connect()
})

startBtn.addEventListener('click', () => {
  void timer.startSelected()
})

stopBtn.addEventListener('click', () => {
  void timer.stop()
})

clearLogBtn.addEventListener('click', () => {
  logEl.textContent = ''
})

addPresetBtn.addEventListener('click', () => {
  const parsed = parseMinuteSecondInput(presetInputEl.value)
  if (parsed === null) {
    setPhase('error')
    appendLog('Preset format invalid. Use mm:ss (for example 02:30).')
    presetInputEl.focus()
    presetInputEl.select()
    return
  }

  const next = [...timer.getPresets(), parsed]
  void syncPresets(next)
  presetInputEl.value = ''
  appendLog(`Preset added: ${timer.formatDuration(parsed)}`)
})

presetInputEl.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return
  event.preventDefault()
  addPresetBtn.click()
})

presetListEl.addEventListener('click', (event) => {
  const target = event.target
  if (!(target instanceof HTMLElement)) return

  const indexRaw = target.getAttribute('data-remove-preset-index')
  if (indexRaw === null) return

  const index = Number.parseInt(indexRaw, 10)
  if (!Number.isFinite(index)) return

  const current = timer.getPresets()
  if (current.length <= 1) {
    setPhase('error')
    appendLog('At least one preset is required.')
    return
  }

  const removed = current[index]
  const next = current.filter((_, i) => i !== index)
  void syncPresets(next)
  if (removed !== undefined) {
    appendLog(`Preset removed: ${timer.formatDuration(removed)}`)
  }
})
