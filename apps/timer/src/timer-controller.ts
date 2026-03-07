import {
  CreateStartUpPageContainer,
  ListContainerProperty,
  ListItemContainerProperty,
  OsEventTypeList,
  RebuildPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
  type EvenAppBridge,
  type EvenHubEvent,
} from '@evenrealities/even_hub_sdk'
import { withTimeout } from '../../_shared/async'
import { getRawEventType, normalizeEventType } from '../../_shared/even-events'
import { formatDurationClock, parseDurationLabel } from './duration'

type TimerClient = {
  mode: 'bridge' | 'mock'
  start: () => Promise<void>
  startCountdownFromSelection: () => Promise<number>
}

type TimerControllerDeps = {
  setStatusMessage?: (text: string) => void
  setPhase?: (phase: TimerPhase) => void
  log: (text: string) => void
  onCountdownChange?: (state: CountdownState) => void
}

export type TimerPhase = 'idle' | 'connecting' | 'connected' | 'mock' | 'running' | 'error'
export type CountdownState = {
  remainingSeconds: number
  totalSeconds: number
  isRunning: boolean
  isDone: boolean
}

type TimerState = {
  bridge: EvenAppBridge | null
  startupRendered: boolean
  eventLoopRegistered: boolean
  selectedIndex: number
  isRunning: boolean
  isDone: boolean
  remainingSeconds: number
  totalSeconds: number
  intervalId: number | null
  clockIntervalId: number | null
  presetsSeconds: number[]
}

const DEFAULT_PRESET_SECONDS = [60, 300, 900, 3600, 7200]
const GLASSES_PRESET_LIST_LAYOUT = {
  x: 8,
  y: 66,
  width: 140,
  height: 200,
  itemWidth: 140,
} as const

function sanitizePresets(values: number[]): number[] {
  const unique = [...new Set(values.map((v) => Math.floor(v)).filter((v) => Number.isFinite(v) && v > 0))]
  unique.sort((a, b) => a - b)
  return unique.length > 0 ? unique : [...DEFAULT_PRESET_SECONDS]
}

function createState(): TimerState {
  return {
    bridge: null,
    startupRendered: false,
    eventLoopRegistered: false,
    selectedIndex: 0,
    isRunning: false,
    isDone: false,
    remainingSeconds: DEFAULT_PRESET_SECONDS[0],
    totalSeconds: DEFAULT_PRESET_SECONDS[0],
    intervalId: null,
    clockIntervalId: null,
    presetsSeconds: [...DEFAULT_PRESET_SECONDS],
  }
}

function formatCurrentTime(): string {
  const now = new Date()
  const hours = String(now.getHours()).padStart(2, '0')
  const minutes = String(now.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

function clampIndex(index: number, length: number): number {
  if (length <= 0) return 0
  return Math.min(length - 1, Math.max(0, index))
}

function buildProgressBarLine(remainingSeconds: number, totalSeconds: number): string {
  const barLength = 12
  const safeTotal = Math.max(1, totalSeconds)
  const safeRemaining = Math.max(0, Math.min(safeTotal, remainingSeconds))
  const boldBlocks = Math.round((safeRemaining / safeTotal) * barLength)
  const thinBlocks = Math.max(0, barLength - boldBlocks)
  return `${'━'.repeat(boldBlocks)}${'─'.repeat(thinBlocks)}`
}

export function createTimerController({ setStatusMessage, setPhase, log, onCountdownChange }: TimerControllerDeps) {
  const state = createState()
  let timerClient: TimerClient | null = null

  function publishPhase(phase: TimerPhase): void {
    setPhase?.(phase)
  }

  function publishStatusMessage(message: string): void {
    setStatusMessage?.(message)
  }

  function getSelectedSeconds(): number {
    return state.presetsSeconds[clampIndex(state.selectedIndex, state.presetsSeconds.length)] ?? DEFAULT_PRESET_SECONDS[0]
  }

  function publishCountdownState(): void {
    onCountdownChange?.({
      remainingSeconds: state.remainingSeconds,
      totalSeconds: Math.max(1, state.totalSeconds),
      isRunning: state.isRunning,
      isDone: state.isDone,
    })
  }

  function applyPresetSelectionDefaults() {
    state.selectedIndex = clampIndex(state.selectedIndex, state.presetsSeconds.length)
    if (!state.isRunning) {
      state.remainingSeconds = getSelectedSeconds()
      state.totalSeconds = state.remainingSeconds
      publishCountdownState()
    }
  }

  function stopCountdown() {
    state.isRunning = false
    if (state.intervalId !== null) {
      window.clearInterval(state.intervalId)
      state.intervalId = null
    }
  }

  async function updateClockText(bridge: EvenAppBridge): Promise<void> {
    await bridge.textContainerUpgrade(new TextContainerUpgrade({
      containerID: 3,
      containerName: 'timer-now',
      contentOffset: 0,
      contentLength: 16,
      content: formatCurrentTime(),
    }))
  }

  function startClockTicker() {
    if (state.clockIntervalId !== null) return

    state.clockIntervalId = window.setInterval(() => {
      if (!state.bridge || !state.startupRendered || state.isRunning) return
      void updateClockText(state.bridge)
    }, 1000)
  }

  async function renderPage(bridge: EvenAppBridge): Promise<void> {
    const hintSeparator = '                      '
    const timerLine = state.isRunning
      ? `Dbl Stop${hintSeparator}${formatDurationClock(state.remainingSeconds)}`
      : state.isDone
        ? `*** TIME UP *** | Click Start`
        : `Click Start${hintSeparator}${formatDurationClock(state.remainingSeconds)}`
    const progressLine = buildProgressBarLine(state.remainingSeconds, state.totalSeconds)
    const timerText = `${timerLine}\n${progressLine}`

    const titleText = new TextContainerProperty({
      containerID: 1,
      containerName: 'timer-title',
      content: timerText,
      xPosition: 8,
      yPosition: 0,
      width: 300,
      height: 58,
      isEventCapture: 0,
    })

    const nowText = new TextContainerProperty({
      containerID: 3,
      containerName: 'timer-now',
      content: formatCurrentTime(),
      xPosition: 500,
      yPosition: 0,
      width: 72,
      height: 32,
      isEventCapture: 0,
    })

    const config = state.isRunning
      ? {
        containerTotalNum: 3,
        textObject: [titleText, nowText],
        listObject: [new ListContainerProperty({
          containerID: 2,
          containerName: 'timer-hidden-capture',
          itemContainer: new ListItemContainerProperty({
            itemCount: 1,
            itemWidth: 1,
            isItemSelectBorderEn: 0,
            itemName: [' '],
          }),
          isEventCapture: 1,
          xPosition: 0,
          yPosition: 0,
          width: 1,
          height: 1,
        })],
      }
      : {
        containerTotalNum: 3,
        textObject: [titleText, nowText],
        listObject: [new ListContainerProperty({
          containerID: 2,
          containerName: 'timer-list',
          itemContainer: new ListItemContainerProperty({
            itemCount: state.presetsSeconds.length,
            itemWidth: GLASSES_PRESET_LIST_LAYOUT.itemWidth,
            isItemSelectBorderEn: 1,
            itemName: state.presetsSeconds.map((seconds) => formatDurationClock(seconds)),
          }),
          isEventCapture: 1,
          xPosition: GLASSES_PRESET_LIST_LAYOUT.x,
          yPosition: GLASSES_PRESET_LIST_LAYOUT.y,
          width: GLASSES_PRESET_LIST_LAYOUT.width,
          height: GLASSES_PRESET_LIST_LAYOUT.height,
        })],
      }

    if (!state.startupRendered) {
      await bridge.createStartUpPageContainer(new CreateStartUpPageContainer(config))
      state.startupRendered = true
      return
    }

    await bridge.rebuildPageContainer(new RebuildPageContainer(config))
  }

  async function startCountdownFromSelection(bridge?: EvenAppBridge): Promise<number> {
    const selectedSeconds = getSelectedSeconds()
    state.remainingSeconds = selectedSeconds
    state.totalSeconds = selectedSeconds
    state.isRunning = true
    state.isDone = false
    publishPhase('running')
    publishCountdownState()
    if (bridge) {
      await renderPage(bridge)
    }

    if (state.intervalId !== null) {
      window.clearInterval(state.intervalId)
    }

    state.intervalId = window.setInterval(() => {
      if (!state.isRunning) return

      state.remainingSeconds = Math.max(0, state.remainingSeconds - 1)
      publishCountdownState()
      if (state.bridge) {
        void renderPage(state.bridge)
      }

      if (state.remainingSeconds === 0) {
        stopCountdown()
        state.isDone = true
        publishCountdownState()
        log('Timer: completed')
        if (timerClient?.mode === 'mock') {
          publishPhase('mock')
        } else if (timerClient) {
          publishPhase('connected')
        }
        if (state.bridge) void renderPage(state.bridge)
      }
    }, 1000)

    log(`Timer: started ${formatDurationClock(selectedSeconds)}`)
    return selectedSeconds
  }

  function registerEventLoop(bridge: EvenAppBridge): void {
    if (state.eventLoopRegistered) return

    bridge.onEvenHubEvent(async (event) => {
      const rawEventType = getRawEventType(event)
      let eventType = normalizeEventType(rawEventType, OsEventTypeList)
      const incomingIndexRaw = event.listEvent?.currentSelectItemIndex
      const incomingName = event.listEvent?.currentSelectItemName
      const incomingSecondsByName = parseDurationLabel(incomingName)
      const incomingIndexByName = incomingSecondsByName !== null
        ? state.presetsSeconds.indexOf(incomingSecondsByName)
        : -1
      const parsedIncomingIndex = typeof incomingIndexRaw === 'number'
        ? incomingIndexRaw
        : typeof incomingIndexRaw === 'string'
          ? Number.parseInt(incomingIndexRaw, 10)
          : incomingIndexByName
      const incomingIndex = event.listEvent && (Number.isNaN(parsedIncomingIndex) || parsedIncomingIndex < 0)
        ? 0
        : parsedIncomingIndex
      const hasIncomingIndex = incomingIndex >= 0 && incomingIndex < state.presetsSeconds.length

      if (eventType === undefined && event.listEvent) {
        if (hasIncomingIndex && incomingIndex > state.selectedIndex) {
          eventType = OsEventTypeList.SCROLL_BOTTOM_EVENT
        } else if (hasIncomingIndex && incomingIndex < state.selectedIndex) {
          eventType = OsEventTypeList.SCROLL_TOP_EVENT
        } else {
          eventType = OsEventTypeList.CLICK_EVENT
        }
      }

      if (eventType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
        stopCountdown()
        state.isDone = false
        await renderPage(bridge)
        publishPhase(timerClient?.mode === 'mock' ? 'mock' : 'connected')
        log('Timer: stopped')
        return
      }

      if (!event.listEvent) return

      if (
        !hasIncomingIndex &&
        !state.isRunning &&
        (eventType === OsEventTypeList.SCROLL_TOP_EVENT || eventType === OsEventTypeList.SCROLL_BOTTOM_EVENT)
      ) {
        const delta = eventType === OsEventTypeList.SCROLL_TOP_EVENT ? -1 : 1
        const nextIndex = clampIndex(state.selectedIndex + delta, state.presetsSeconds.length)
        if (nextIndex !== state.selectedIndex) {
          state.selectedIndex = nextIndex
          state.remainingSeconds = getSelectedSeconds()
          await startCountdownFromSelection(bridge)
        }
        return
      }

      if (hasIncomingIndex && incomingIndex !== state.selectedIndex && !state.isRunning) {
        state.selectedIndex = incomingIndex
        state.remainingSeconds = getSelectedSeconds()
        await startCountdownFromSelection(bridge)
        return
      }

      if (!state.isRunning && eventType === OsEventTypeList.CLICK_EVENT) {
        await startCountdownFromSelection(bridge)
      }
    })

    state.eventLoopRegistered = true
  }

  function getMockTimerClient(): TimerClient {
    return {
      mode: 'mock',
      async start() {
        console.log('[timer] mock start')
      },
      async startCountdownFromSelection() {
        const selected = getSelectedSeconds()
        console.log(`[timer] mock start countdown: ${formatDurationClock(selected)}`)
        return startCountdownFromSelection()
      },
    }
  }

  async function initTimer(timeoutMs = 6000): Promise<TimerClient> {
    try {
      if (!state.bridge) {
        state.bridge = await withTimeout(waitForEvenAppBridge(), timeoutMs)
      }

      registerEventLoop(state.bridge)

      return {
        mode: 'bridge',
        async start() {
          stopCountdown()
          state.isDone = false
          state.remainingSeconds = getSelectedSeconds()
          state.totalSeconds = state.remainingSeconds
          publishCountdownState()
          await renderPage(state.bridge!)
          startClockTicker()
        },
        async startCountdownFromSelection() {
          return startCountdownFromSelection(state.bridge!)
        },
      }
    } catch {
      return getMockTimerClient()
    }
  }

  return {
    formatDuration(seconds: number) {
      return formatDurationClock(seconds)
    },
    getPresets() {
      return [...state.presetsSeconds]
    },
    async setPresets(values: number[]) {
      state.presetsSeconds = sanitizePresets(values)
      applyPresetSelectionDefaults()
      log(`Timer: presets updated (${state.presetsSeconds.map(formatDurationClock).join(', ')})`)
      if (state.bridge && state.startupRendered) {
        await renderPage(state.bridge)
      }
      return [...state.presetsSeconds]
    },
    async connect() {
      publishPhase('connecting')
      publishStatusMessage('Timer: connecting to Even bridge...')
      log('Timer: connect requested')

      try {
        timerClient = await initTimer()
        await timerClient.start()

        if (timerClient.mode === 'bridge') {
          publishPhase('connected')
          publishStatusMessage('Timer: connected. Up/Down select, Click start, DoubleClick stop.')
          log('Timer: connected to bridge')
        } else {
          publishPhase('mock')
          publishStatusMessage('Timer: bridge not found. Running mock mode.')
          log('Timer: running in mock mode (bridge unavailable)')
        }
      } catch (error) {
        console.error('[timer] connect failed', error)
        publishPhase('error')
        publishStatusMessage('Timer: connection failed')
        log('Timer: connection failed')
      }
    },
    async startSelected() {
      if (!timerClient) {
        publishPhase('error')
        publishStatusMessage('Timer: not connected')
        log('Timer: start blocked (not connected)')
        return
      }

      const selectedSeconds = await timerClient.startCountdownFromSelection()
      publishStatusMessage(`Timer: started ${formatDurationClock(selectedSeconds)} countdown`)
    },
    async stop() {
      stopCountdown()
      state.isDone = false

      if (state.bridge && state.startupRendered) {
        await renderPage(state.bridge)
      }
      publishCountdownState()

      if (timerClient?.mode === 'mock') {
        publishPhase('mock')
      } else if (timerClient) {
        publishPhase('connected')
      } else {
        publishPhase('idle')
      }

      publishStatusMessage('Timer: stopped')
      log('Timer: stopped')
    },
  }
}
