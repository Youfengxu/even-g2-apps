import './styles.css'
import { createQuicktestActions } from './quicktest-app'

const appRoot = document.querySelector<HTMLDivElement>('#app')

if (!appRoot) {
  throw new Error('Missing #app')
}

appRoot.innerHTML = `
  <section class="card">
    <h1 class="title">Quicktest</h1>
    <p class="subtitle">Paste generated UI source and render it on the glasses for fast simulator testing.</p>
  </section>

  <section class="card">
    <div class="top-actions">
      <button id="connect-btn" class="btn btn-primary connect-glasses-btn" type="button">Connect glasses</button>
    </div>
  </section>

  <section class="card">
    <div class="actions">
      <button id="render-btn" class="btn" type="button">Render Page</button>
      <button id="action-btn" class="btn" type="button">Reset Source To File</button>
    </div>
    <p id="status" class="status">Quicktest ready. Connect glasses, then click Render Page.</p>
  </section>

  <section class="card">
    <p class="log-title">Event Log</p>
    <pre id="event-log" aria-live="polite"></pre>
  </section>
`

const statusEl = document.querySelector<HTMLParagraphElement>('#status')
const logEl = document.querySelector<HTMLPreElement>('#event-log')
const connectBtn = document.querySelector<HTMLButtonElement>('#connect-btn')
const renderBtn = document.querySelector<HTMLButtonElement>('#render-btn')
const actionBtn = document.querySelector<HTMLButtonElement>('#action-btn')

if (!statusEl || !logEl || !connectBtn || !renderBtn || !actionBtn) {
  throw new Error('Missing UI controls')
}

function setStatus(text: string): void {
  statusEl.textContent = text
}

const actions = createQuicktestActions(setStatus)

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

renderBtn.addEventListener('click', async () => {
  await actions.render()
  moveLogCardToEnd()
})

actionBtn.addEventListener('click', () => {
  void actions.action()
})
