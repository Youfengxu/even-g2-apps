import './styles.css'
import { createRestApiActions } from './restapi-app'

const appRoot = document.querySelector<HTMLDivElement>('#app')

if (!appRoot) {
  throw new Error('Missing #app')
}

appRoot.innerHTML = `
  <section class="card">
    <h1 class="title">REST API</h1>
    <p class="subtitle">Standalone Even G2 REST API tester with browser controls and glasses list navigation.</p>
  </section>

  <section class="card">
    <div class="top-actions">
      <button id="connect-btn" class="btn btn-primary connect-glasses-btn" type="button">Connect glasses</button>
    </div>
  </section>

  <section class="card">
    <div class="actions">
      <button id="action-btn" class="btn" type="button">Run GET Request</button>
    </div>
    <p id="status" class="status">REST API app ready</p>
  </section>

  <section class="card">
    <p class="log-title">Event Log</p>
    <pre id="event-log" aria-live="polite"></pre>
  </section>
`

const statusEl = document.querySelector<HTMLParagraphElement>('#status')
const logEl = document.querySelector<HTMLPreElement>('#event-log')
const connectBtn = document.querySelector<HTMLButtonElement>('#connect-btn')
const actionBtn = document.querySelector<HTMLButtonElement>('#action-btn')

if (!statusEl || !logEl || !connectBtn || !actionBtn) {
  throw new Error('Missing UI controls')
}

function setStatus(text: string): void {
  statusEl.textContent = text
}

const actions = createRestApiActions(setStatus)

// createRestApiActions() mounts #restapi-controls into #app on connect;
// keep event log at the end after dynamic UI insertion.
function moveLogCardToEnd(): void {
  const logCard = logEl.closest('.card')
  if (logCard) {
    appRoot.appendChild(logCard)
  }
}

connectBtn.addEventListener('click', async () => {
  await actions.connect()
  moveLogCardToEnd()
})

actionBtn.addEventListener('click', () => {
  void actions.action()
})
