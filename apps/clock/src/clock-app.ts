import {
  CreateStartUpPageContainer,
  RebuildPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
  type EvenAppBridge,
} from '@evenrealities/even_hub_sdk'
import { withTimeout } from '../../_shared/async'
import { appendEventLog } from '../../_shared/log'

type SetStatus = (text: string) => void

type AppActions = {
  connect: () => Promise<void>
}

export type ClockActions = AppActions & {
  moveLeft: () => Promise<void>
  moveRight: () => Promise<void>
}


const CLOCK_X_STORAGE_KEY = 'even.clock.time_x.v1'

function loadClockX(fallback: number, min: number, max: number): number {
  try {
    const raw = window.localStorage.getItem(CLOCK_X_STORAGE_KEY)
    if (!raw) return fallback
    const parsed = Number.parseInt(raw, 10)
    if (!Number.isFinite(parsed)) return fallback
    return Math.max(min, Math.min(max, parsed))
  } catch {
    return fallback
  }
}

function saveClockX(x: number): void {
  try {
    window.localStorage.setItem(CLOCK_X_STORAGE_KEY, String(x))
  } catch {
    // Ignore storage failures.
  }
}

type ClockClient = {
  mode: 'bridge' | 'mock'
  start: () => Promise<void>
  moveX: (delta: number) => Promise<number>
}

let clockClient: ClockClient | null = null

function getMockClockClient(): ClockClient {
  let mockX = 8
  return {
    mode: 'mock',
    async start() {
      console.log('[clock] mock start')
    },
    async moveX(delta: number) {
      mockX = Math.max(0, Math.min(520, mockX + delta))
      console.log('[clock] mock move x', mockX)
      return mockX
    },
  }
}

function getBridgeClockClient(bridge: EvenAppBridge): ClockClient {
  const timeFormatter = new Intl.DateTimeFormat([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })

  const TIME_CONTAINER_ID = 1
  const TIME_CONTAINER_NAME = 'clock-time'
  const TIME_Y = 8
  const TIME_WIDTH = 220
  const TIME_HEIGHT = 44
  const X_MIN = 0
  const X_MAX = 576 - TIME_WIDTH

  let timeX = loadClockX(8, X_MIN, X_MAX)
  let startupRendered = false
  let intervalId: number | null = null
  let renderInFlight = false
  let pendingTick = false

  function buildPagePayload(timeTextContent: string) {
    return {
      containerTotalNum: 1,
      textObject: [new TextContainerProperty({
        containerID: TIME_CONTAINER_ID,
        containerName: TIME_CONTAINER_NAME,
        content: timeTextContent,
        xPosition: timeX,
        yPosition: TIME_Y,
        width: TIME_WIDTH,
        height: TIME_HEIGHT,
        isEventCapture: 0,
      })],
    }
  }

  async function fullRender(): Promise<void> {
    const content = timeFormatter.format(new Date())
    const payload = buildPagePayload(content)

    if (!startupRendered) {
      await bridge.createStartUpPageContainer(new CreateStartUpPageContainer(payload))
      startupRendered = true
      return
    }

    await bridge.rebuildPageContainer(new RebuildPageContainer(payload))
  }

  async function tickUpdate(): Promise<void> {
    if (!startupRendered) {
      await fullRender()
      return
    }

    await bridge.textContainerUpgrade(new TextContainerUpgrade({
      containerID: TIME_CONTAINER_ID,
      containerName: TIME_CONTAINER_NAME,
      contentOffset: 0,
      contentLength: 16,
      content: timeFormatter.format(new Date()),
    }))
  }

  async function renderTickSafe(): Promise<void> {
    if (renderInFlight) {
      pendingTick = true
      return
    }

    renderInFlight = true
    try {
      await tickUpdate()
    } catch (error) {
      console.error('[clock] tick update failed; falling back to full render', error)
      try {
        await fullRender()
      } catch (rebuildError) {
        console.error('[clock] full render fallback failed', rebuildError)
      }
    } finally {
      renderInFlight = false
      if (pendingTick) {
        pendingTick = false
        void renderTickSafe()
      }
    }
  }

  function stopTicking() {
    if (intervalId !== null) {
      window.clearInterval(intervalId)
      intervalId = null
    }
  }

  function startTicking() {
    stopTicking()
    intervalId = window.setInterval(() => {
      void renderTickSafe()
    }, 1000)
  }

  return {
    mode: 'bridge',
    async start() {
      stopTicking()
      await fullRender()
      startTicking()
    },
    async moveX(delta: number) {
      timeX = Math.max(X_MIN, Math.min(X_MAX, timeX + delta))
      saveClockX(timeX)
      await fullRender()
      return timeX
    },
  }
}

async function initClock(timeoutMs = 4000): Promise<{ clock: ClockClient }> {
  try {
    const bridge = await withTimeout(waitForEvenAppBridge(), timeoutMs)

    if (!clockClient || clockClient.mode !== 'bridge') {
      clockClient = getBridgeClockClient(bridge)
    }

    return { clock: clockClient }
  } catch {
    return { clock: getMockClockClient() }
  }
}

export function createClockActions(setStatus: SetStatus): ClockActions {
  return {
    async connect() {
      setStatus('Clock: connecting to Even bridge...')
      appendEventLog('Clock: connect requested')

      try {
        const { clock } = await initClock()
        clockClient = clock

        await clock.start()

        if (clock.mode === 'bridge') {
          setStatus('Clock: connected and ticking in simulator.')
          appendEventLog('Clock: connected to bridge')
        } else {
          setStatus('Clock: bridge not found. Running mock mode.')
          appendEventLog('Clock: running in mock mode (bridge unavailable)')
        }
      } catch (err) {
        console.error(err)
        setStatus('Clock: connection failed')
        appendEventLog('Clock: connection failed')
      }
    },
    async moveLeft() {
      if (!clockClient) {
        setStatus('Clock: not connected')
        appendEventLog('Clock: move blocked (not connected)')
        return
      }
      const x = await clockClient.moveX(-16)
      setStatus(`Clock: moved left (x=${x})`)
      appendEventLog(`Clock: moved left (x=${x})`)
    },
    async moveRight() {
      if (!clockClient) {
        setStatus('Clock: not connected')
        appendEventLog('Clock: move blocked (not connected)')
        return
      }
      const x = await clockClient.moveX(16)
      setStatus(`Clock: moved right (x=${x})`)
      appendEventLog(`Clock: moved right (x=${x})`)
    },
  }
}
