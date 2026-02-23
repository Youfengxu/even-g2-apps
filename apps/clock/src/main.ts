import './styles.css'
import { createClockActions, type ClockActions } from './clock-app'

const appRoot = document.querySelector<HTMLDivElement>('#app')

if (!appRoot) {
  throw new Error('Missing #app')
}

appRoot.innerHTML = `
  <section class="card">
    <h1 class="title">Clock</h1>
    <p class="subtitle">Standalone clock app for Even G2 simulator. Connect and toggle ticking.</p>
  </section>

  <section class="card">
    <div class="top-actions">
      <button id="connect-btn" class="btn btn-primary connect-glasses-btn" type="button">Connect glasses</button>
    </div>
  </section>

  <section class="card">
    <div class="actions">
      <button id="left-btn" class="btn" type="button">Move Time Left</button>
      <button id="right-btn" class="btn" type="button">Move Time Right</button>
    </div>
    <p id="status" class="status">Clock app ready</p>
  </section>

  <section class="card">
    <p class="log-title">Event Log</p>
    <pre id="event-log" aria-live="polite"></pre>
  </section>
`

const statusEl = document.querySelector<HTMLParagraphElement>('#status')
const connectBtn = document.querySelector<HTMLButtonElement>('#connect-btn')
const leftBtn = document.querySelector<HTMLButtonElement>('#left-btn')
const rightBtn = document.querySelector<HTMLButtonElement>('#right-btn')

if (!statusEl || !connectBtn || !leftBtn || !rightBtn) {
  throw new Error('Missing UI controls')
}

function setStatus(text: string): void {
  statusEl.textContent = text
}

const actions: ClockActions = createClockActions(setStatus)

connectBtn.addEventListener('click', () => {
  void actions.connect()
})

leftBtn.addEventListener('click', () => {
  void actions.moveLeft()
})

rightBtn.addEventListener('click', () => {
  void actions.moveRight()
})
