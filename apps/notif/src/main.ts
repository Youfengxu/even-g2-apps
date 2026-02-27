import './styles.css'
import { createNotifActions, type AppActions } from './notif-app'

const appRoot = document.querySelector<HTMLDivElement>('#app')

if (!appRoot) {
  throw new Error('Missing #app')
}

appRoot.innerHTML = `
  <section class="card">
    <h1 class="title">Notif</h1>
    <p class="subtitle">Forward Android phone notifications to your G2 glasses.</p>
  </section>

  <section class="card">
    <div class="top-actions">
      <button id="connect-btn" class="btn btn-primary connect-glasses-btn" type="button">Connect glasses</button>
    </div>
  </section>

  <section class="card">
    <div class="actions">
      <button id="test-btn" class="btn" type="button">Test Notification</button>
    </div>
    <p id="status" class="status">Notif app ready</p>
  </section>

  <section class="card">
    <p class="log-title">Event Log</p>
    <pre id="event-log" aria-live="polite"></pre>
  </section>
`

const statusEl = document.querySelector<HTMLParagraphElement>('#status')
const connectBtn = document.querySelector<HTMLButtonElement>('#connect-btn')
const testBtn = document.querySelector<HTMLButtonElement>('#test-btn')

if (!statusEl || !connectBtn || !testBtn) {
  throw new Error('Missing UI controls')
}

function setStatus(text: string): void {
  statusEl.textContent = text
}

const actions: AppActions = createNotifActions(setStatus)

connectBtn.addEventListener('click', () => {
  void actions.connect()
})

// Auto-connect when the page loads (e.g. after Even App reconnects)
void actions.connect()

testBtn.addEventListener('click', () => {
  void actions.action()
})
