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
import { appendEventLog } from '../../_shared/log'

type SetStatus = (text: string) => void

type AppActions = {
  connect: () => Promise<void>
  action: () => Promise<void>
}

import { fetchAsText } from './http'
import {
  clampIndex,
  displayName,
  getTagFilterLabel,
  parseTagsInput,
  RestCommandStore,
  TAG_ALL,
  type RestCommand,
  type RestCommandSeed,
} from './model'
import {
  clearCommandInput,
  ensureUi,
  getActiveTagFilter,
  getGlassSelectedCommandId,
  getSelectedCommandId,
  rebuildCommandTable,
  rebuildTagsAutocomplete,
  rebuildTagFilterSelect,
  readCommandInput,
  syncGlassSelectedCommandById,
  syncSelectedCommandById,
  syncTagFilter,
  type RestUiState,
} from './ui'

const PROXY_PATH = '/__restapi_proxy'
const TAG_LIST_CONTAINER_ID = 3
const COMMAND_LIST_CONTAINER_ID = 4
const COMMANDS_STORAGE_KEY = 'even.restapi.commands.v1'
const GLASS_RESPONSE_WRAP_WIDTH = 38
const GLASS_MAIN_RESPONSE_LIMITS = {
  maxCharacters: 180,
  maxLines: 8,
} as const

type GlassListFocus = 'tags' | 'commands'
type GlassView = 'main' | 'response'

type BridgeDisplay = {
  mode: 'bridge' | 'mock'
  show: (message: string) => Promise<void>
  renderList: (commands: RestCommand[], selectedIndex: number, statusMessage?: string) => Promise<void>
  onSelectAndRun: (runner: (command: RestCommand) => Promise<void>) => void
}

type ImportableCommand = {
  url: string
  name: string
  tags: string[]
}

type ImportEntry = {
  url: string
  name: string
  tags: string[]
}

type GlassResponseState = {
  title: string
  content: string
}

const store = new RestCommandStore()

function loadPersistedCommands(): RestCommandSeed[] | null {
  try {
    const raw = window.localStorage.getItem(COMMANDS_STORAGE_KEY)
    if (!raw) {
      return null
    }

    return parseImportEntries(JSON.parse(raw))
  } catch {
    return null
  }
}

function persistCommands(): void {
  try {
    window.localStorage.setItem(COMMANDS_STORAGE_KEY, JSON.stringify(store.exportSeeds()))
  } catch {
    // Ignore storage failures.
  }
}

const bridgeState: {
  bridge: EvenAppBridge | null
  startupRendered: boolean
  eventLoopRegistered: boolean
  selectedIndex: number
  tagSelectedIndex: number
  activeListFocus: GlassListFocus
  activeView: GlassView
  statusMessage: string
  activeTagFilter: string
  onSelectAndRun: ((command: RestCommand) => Promise<void>) | null
  response: GlassResponseState
} = {
  bridge: null,
  startupRendered: false,
  eventLoopRegistered: false,
  selectedIndex: 0,
  tagSelectedIndex: 0,
  activeListFocus: 'commands',
  activeView: 'main',
  statusMessage: 'Select command and click',
  activeTagFilter: TAG_ALL,
  onSelectAndRun: null,
  response: {
    title: '',
    content: '',
  },
}

let bridgeDisplay: BridgeDisplay | null = null
let activeUi: RestUiState | null = null

function getFilteredCommands(): RestCommand[] {
  return store.filtered(bridgeState.activeTagFilter)
}

function getTagFiltersForGlass(): string[] {
  return [TAG_ALL, ...store.availableTags()]
}

function toGlassTagLabel(tagFilter: string): string {
  return tagFilter === TAG_ALL ? 'All tags' : `#${tagFilter}`
}

function toGlassCommandLabel(command: RestCommand): string {
  const base = displayName(command)
  let hostSuffix = '#unknown'

  try {
    const host = new URL(command.url).hostname
    if (host) {
      const trimmedHost = host.replace(/\.[^.]+$/, '')
      hostSuffix = `#${trimmedHost || host}`
    }
  } catch {
    // Keep fallback when URL is not parseable.
  }

  const text = `${base} ${hostSuffix}`
  return text.length <= 62 ? text : `${text.slice(0, 59)}...`
}

function buildTagListLabels(tagFilters: string[], selectedIndex: number): string[] {
  return tagFilters.map((tagFilter, idx) => {
    const base = toGlassTagLabel(tagFilter)
    return idx === selectedIndex ? `> ${base}` : `  ${base}`
  })
}

function syncTagSelectionIndexFromFilter(): void {
  const tags = getTagFiltersForGlass()
  const idx = tags.indexOf(bridgeState.activeTagFilter)
  bridgeState.tagSelectedIndex = idx >= 0 ? idx : 0
}

function buildFilterStatus(): string {
  const filtered = getFilteredCommands()
  const focus = bridgeState.activeListFocus === 'tags' ? 'tags' : 'commands'
  return `Focus: ${focus} | Filter: ${getTagFilterLabel(bridgeState.activeTagFilter)} | ${filtered.length} cmd(s)`
}

function wrapGlassText(text: string, width: number): string[] {
  const normalized = text.replace(/\r\n/g, '\n')
  const rawLines = normalized.split('\n')
  const wrapped: string[] = []

  for (const rawLine of rawLines) {
    if (!rawLine) {
      wrapped.push('')
      continue
    }

    let remaining = rawLine
    while (remaining.length > width) {
      const candidate = remaining.slice(0, width)
      const splitAt = Math.max(candidate.lastIndexOf(' '), candidate.lastIndexOf('\t'))

      if (splitAt > Math.floor(width * 0.4)) {
        wrapped.push(candidate.slice(0, splitAt).trimEnd())
        remaining = remaining.slice(splitAt + 1).trimStart()
      } else {
        wrapped.push(candidate)
        remaining = remaining.slice(width)
      }
    }

    wrapped.push(remaining)
  }

  return wrapped
}

function shouldShowResponsePage(text: string): boolean {
  const normalized = text.trim()
  const wrappedLineCount = normalized
    ? wrapGlassText(normalized, GLASS_RESPONSE_WRAP_WIDTH).length
    : 0

  return normalized.length > GLASS_MAIN_RESPONSE_LIMITS.maxCharacters
    || wrappedLineCount > GLASS_MAIN_RESPONSE_LIMITS.maxLines
}

function setGlassResponseView(title: string, text: string): void {
  bridgeState.activeView = 'response'
  bridgeState.response = {
    title,
    content: wrapGlassText(text, GLASS_RESPONSE_WRAP_WIDTH).join('\n'),
  }
}

function clearGlassResponseView(): void {
  bridgeState.activeView = 'main'
  bridgeState.response = {
    title: '',
    content: '',
  }
}

function parseIncomingSelection(
  event: EvenHubEvent,
  labels: string[],
): { index: number; hasExplicitIndex: boolean } {
  const incomingIndexRaw = event.listEvent?.currentSelectItemIndex
  const incomingName = event.listEvent?.currentSelectItemName
  const normalizeLabel = (value: string): string => value.trim().toLowerCase()
  const incomingIndexByName = typeof incomingName === 'string'
    ? labels.findIndex((label) => normalizeLabel(label) === normalizeLabel(incomingName))
    : -1

  const parsedIncomingIndex = typeof incomingIndexRaw === 'number'
    ? incomingIndexRaw
    : typeof incomingIndexRaw === 'string'
      ? Number.parseInt(incomingIndexRaw, 10)
      : incomingIndexByName

  if (Number.isFinite(parsedIncomingIndex) && parsedIncomingIndex >= 0) {
    return { index: parsedIncomingIndex, hasExplicitIndex: true }
  }

  // Simulator can omit index/name; keep current selection for navigation semantics.
  return { index: -1, hasExplicitIndex: false }
}

function syncBrowserSelectionByCommandId(commandId: number): void {
  if (!activeUi) {
    return
  }
  syncSelectedCommandById(activeUi, commandId)
}

function syncBrowserGlassSelectionByCommandId(commandId: number | null): void {
  if (!activeUi) {
    return
  }
  syncGlassSelectedCommandById(activeUi, commandId)
}

function currentGlassSelectedCommandId(): number | null {
  const filtered = getFilteredCommands()
  if (filtered.length === 0) {
    return null
  }

  const safeIndex = clampIndex(bridgeState.selectedIndex, filtered.length)
  return filtered[safeIndex]?.id ?? null
}

function syncBrowserTagFilter(tagFilter: string): void {
  if (!activeUi) {
    return
  }
  syncTagFilter(activeUi, tagFilter)
}

function selectedCommandFromUi(): RestCommand | null {
  if (!activeUi) {
    return null
  }

  const selectedId = getSelectedCommandId(activeUi)
  if (!selectedId) {
    return null
  }

  return store.findById(selectedId)
}

function toImportableCommands(commands: RestCommand[]): ImportableCommand[] {
  return commands.map((command) => ({
    url: command.url,
    name: command.name,
    tags: [...command.tags],
  }))
}

function parseImportEntries(parsed: unknown): ImportEntry[] | null {
  const entries = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { commands?: unknown }).commands)
      ? (parsed as { commands: unknown[] }).commands
      : null

  if (!entries) {
    return null
  }

  const imported: ImportEntry[] = []
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') {
      continue
    }

    const record = entry as { url?: unknown; name?: unknown; tags?: unknown }
    const url = typeof record.url === 'string' ? record.url.trim() : ''
    if (!url) {
      continue
    }

    const name = typeof record.name === 'string' ? record.name : ''
    const tags = Array.isArray(record.tags)
      ? record.tags.filter((tag): tag is string => typeof tag === 'string')
      : typeof record.tags === 'string'
        ? parseTagsInput(record.tags)
        : []

    imported.push({ url, name, tags })
  }

  return imported
}

function refreshUiData(preferredCommandId?: number): void {
  if (!activeUi) {
    return
  }

  const availableTags = store.availableTags()
  rebuildCommandTable(activeUi, store.list(), preferredCommandId)
  rebuildTagFilterSelect(activeUi, availableTags, bridgeState.activeTagFilter)
  rebuildTagsAutocomplete(activeUi, availableTags)

  bridgeState.activeTagFilter = getActiveTagFilter(activeUi)
  syncTagSelectionIndexFromFilter()
  const selected = selectedCommandFromUi()
  const filtered = getFilteredCommands()

  if (!selected || filtered.length === 0) {
    bridgeState.selectedIndex = 0
    syncBrowserGlassSelectionByCommandId(currentGlassSelectedCommandId())
    return
  }

  const indexInFiltered = filtered.findIndex((command) => command.id === selected.id)
  bridgeState.selectedIndex = indexInFiltered >= 0 ? indexInFiltered : 0

  const currentGlassSelected = getGlassSelectedCommandId(activeUi)
  const selectedGlassId = currentGlassSelected && store.findById(currentGlassSelected)
    ? currentGlassSelected
    : currentGlassSelectedCommandId()
  syncBrowserGlassSelectionByCommandId(selectedGlassId)
}

function getMockBridgeDisplay(): BridgeDisplay {
  return {
    mode: 'mock',
    async show() {
      // No-op in mock mode.
    },
    async renderList() {
      // No-op in mock mode.
    },
    onSelectAndRun(runner) {
      void runner
    },
  }
}

async function rebuildBridgePage(
  bridge: EvenAppBridge,
  config: ConstructorParameters<typeof CreateStartUpPageContainer>[0],
): Promise<void> {
  if (!bridgeState.startupRendered) {
    await bridge.createStartUpPageContainer(new CreateStartUpPageContainer(config))
    bridgeState.startupRendered = true
    return
  }

  await bridge.rebuildPageContainer(new RebuildPageContainer(config))
}

async function renderResponseBridgePage(bridge: EvenAppBridge): Promise<void> {
  const titleText = new TextContainerProperty({
    containerID: 1,
    containerName: 'restapi-response-title',
    content: bridgeState.response.title,
    xPosition: 8,
    yPosition: 0,
    width: 560,
    height: 34,
    isEventCapture: 0,
  })

  const hintText = new TextContainerProperty({
    containerID: 2,
    containerName: 'restapi-response-hint',
    content: 'Scroll text | Dbl tap back',
    xPosition: 8,
    yPosition: 34,
    width: 560,
    height: 28,
    isEventCapture: 0,
  })

  const bodyText = new TextContainerProperty({
    containerID: 3,
    containerName: 'restapi-response-body',
    content: bridgeState.response.content,
    xPosition: 8,
    yPosition: 68,
    width: 560,
    height: 198,
    isEventCapture: 1,
  })

  await rebuildBridgePage(bridge, {
    containerTotalNum: 3,
    textObject: [titleText, hintText, bodyText],
  })
}

function getSafeGlassCommands(commands: RestCommand[]): RestCommand[] {
  return commands.length > 0
    ? commands
    : [{ id: 0, url: 'N/A', name: 'No command configured', tags: [] } satisfies RestCommand]
}

async function renderMainBridgePage(
  bridge: EvenAppBridge,
  commands: RestCommand[],
  selectedIndex: number,
  statusMessage: string,
): Promise<void> {
  const tagFilters = getTagFiltersForGlass()
  const safeTagFilters = tagFilters.length > 0 ? tagFilters : [TAG_ALL]
  const safeCommands = getSafeGlassCommands(commands)
  const safeTagSelected = clampIndex(bridgeState.tagSelectedIndex, safeTagFilters.length)
  const tagLabels = buildTagListLabels(safeTagFilters, safeTagSelected)
  const safeSelected = clampIndex(selectedIndex, safeCommands.length)

  const titleText = new TextContainerProperty({
    containerID: 1,
    containerName: 'restapi-title',
    content: 'REST API (Dbl tap switches Tags/Commands)',
    xPosition: 8,
    yPosition: 0,
    width: 560,
    height: 34,
    isEventCapture: 0,
  })

  const statusText = new TextContainerProperty({
    containerID: 2,
    containerName: 'restapi-status',
    content: statusMessage,
    xPosition: 8,
    yPosition: 36,
    width: 560,
    height: 62,
    isEventCapture: 0,
  })

  const tagListContainer = new ListContainerProperty({
    containerID: TAG_LIST_CONTAINER_ID,
    containerName: 'restapi-tag-list',
    itemContainer: new ListItemContainerProperty({
      itemCount: safeTagFilters.length,
      itemWidth: 180,
      isItemSelectBorderEn: bridgeState.activeListFocus === 'tags' ? 1 : 0,
      itemName: tagLabels,
    }),
    isEventCapture: bridgeState.activeListFocus === 'tags' ? 1 : 0,
    xPosition: 4,
    yPosition: 102,
    width: 185,
    height: 165,
  })

  const commandListContainer = new ListContainerProperty({
    containerID: COMMAND_LIST_CONTAINER_ID,
    containerName: 'restapi-command-list',
    itemContainer: new ListItemContainerProperty({
      itemCount: safeCommands.length,
      itemWidth: 378,
      isItemSelectBorderEn: bridgeState.activeListFocus === 'commands' ? 1 : 0,
      itemName: safeCommands.map((command) => toGlassCommandLabel(command)),
    }),
    isEventCapture: bridgeState.activeListFocus === 'commands' ? 1 : 0,
    xPosition: 194,
    yPosition: 102,
    width: 380,
    height: 165,
  })

  await rebuildBridgePage(bridge, {
    containerTotalNum: 4,
    textObject: [titleText, statusText],
    listObject: [tagListContainer, commandListContainer],
    currentSelectedItem: bridgeState.activeListFocus === 'tags' ? safeTagSelected : safeSelected,
  })
}

async function renderBridgePage(
  bridge: EvenAppBridge,
  commands: RestCommand[],
  selectedIndex: number,
  statusMessage: string,
): Promise<void> {
  if (bridgeState.activeView === 'response') {
    await renderResponseBridgePage(bridge)
    return
  }

  await renderMainBridgePage(bridge, commands, selectedIndex, statusMessage)
}

async function updateBridgeStatusText(bridge: EvenAppBridge, message: string): Promise<boolean> {
  try {
    const updated = await bridge.textContainerUpgrade(new TextContainerUpgrade({
      containerID: 2,
      containerName: 'restapi-status',
      contentOffset: 0,
      contentLength: Math.max(1, message.length),
      content: message,
    }))
    return Boolean(updated)
  } catch {
    return false
  }
}

async function showBridgeMainPage(bridge: EvenAppBridge): Promise<void> {
  bridgeState.statusMessage = buildFilterStatus()
  await renderBridgePage(bridge, getFilteredCommands(), bridgeState.selectedIndex, bridgeState.statusMessage)
}

async function handleResponseViewEvent(
  bridge: EvenAppBridge,
  eventType: OsEventTypeList | undefined,
): Promise<boolean> {
  if (bridgeState.activeView !== 'response') {
    return false
  }

  if (eventType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
    clearGlassResponseView()
    await showBridgeMainPage(bridge)
    appendEventLog('REST API glass: back to main page')
    return true
  }

  return true
}

async function handleTagListEvent(
  bridge: EvenAppBridge,
  event: EvenHubEvent,
  eventType: OsEventTypeList | undefined,
): Promise<void> {
  const tagFilters = getTagFiltersForGlass()
  const tagLabels = buildTagListLabels(tagFilters, clampIndex(bridgeState.tagSelectedIndex, tagFilters.length))
  const incoming = parseIncomingSelection(event, tagLabels)
  const hasIncomingIndex = incoming.hasExplicitIndex && incoming.index < tagFilters.length

  if (eventType === OsEventTypeList.SCROLL_BOTTOM_EVENT || eventType === OsEventTypeList.SCROLL_TOP_EVENT) {
    bridgeState.tagSelectedIndex = clampIndex(
      hasIncomingIndex
        ? incoming.index
        : bridgeState.tagSelectedIndex + (eventType === OsEventTypeList.SCROLL_BOTTOM_EVENT ? 1 : -1),
      tagFilters.length,
    )

    bridgeState.statusMessage = `Tag selected: ${toGlassTagLabel(tagFilters[bridgeState.tagSelectedIndex] ?? TAG_ALL)}`
    await renderBridgePage(bridge, getFilteredCommands(), bridgeState.selectedIndex, bridgeState.statusMessage)
    appendEventLog(`REST API glass: tag highlight ${toGlassTagLabel(tagFilters[bridgeState.tagSelectedIndex] ?? TAG_ALL)}`)
    return
  }

  if (eventType === OsEventTypeList.CLICK_EVENT || (eventType === undefined && event.listEvent)) {
    const selectedIndex = hasIncomingIndex
      ? clampIndex(incoming.index, tagFilters.length)
      : 0

    bridgeState.tagSelectedIndex = selectedIndex
    bridgeState.activeTagFilter = tagFilters[bridgeState.tagSelectedIndex] ?? TAG_ALL
    syncTagSelectionIndexFromFilter()
    bridgeState.selectedIndex = 0
    syncBrowserTagFilter(bridgeState.activeTagFilter)
    syncBrowserGlassSelectionByCommandId(currentGlassSelectedCommandId())
    await showBridgeMainPage(bridge)
    appendEventLog(`REST API glass: selected filter ${getTagFilterLabel(bridgeState.activeTagFilter)}`)
  }
}

async function handleCommandListEvent(
  bridge: EvenAppBridge,
  event: EvenHubEvent,
  eventType: OsEventTypeList | undefined,
): Promise<void> {
  const filteredCommands = getFilteredCommands()
  if (filteredCommands.length === 0) {
    return
  }

  const labels = filteredCommands.map((command) => toGlassCommandLabel(command))
  const incoming = parseIncomingSelection(event, labels)
  const hasIncomingIndex = incoming.hasExplicitIndex && incoming.index < filteredCommands.length

  if (eventType === OsEventTypeList.SCROLL_BOTTOM_EVENT || eventType === OsEventTypeList.SCROLL_TOP_EVENT) {
    bridgeState.selectedIndex = clampIndex(
      hasIncomingIndex
        ? incoming.index
        : bridgeState.selectedIndex + (eventType === OsEventTypeList.SCROLL_BOTTOM_EVENT ? 1 : -1),
      filteredCommands.length,
    )

    const selected = filteredCommands[bridgeState.selectedIndex]
    if (selected) {
      syncBrowserSelectionByCommandId(selected.id)
      syncBrowserGlassSelectionByCommandId(selected.id)
      appendEventLog(
        `REST API glass: ${eventType === OsEventTypeList.SCROLL_BOTTOM_EVENT ? 'down' : 'up'} -> ${displayName(selected)}`,
      )
    }
    return
  }

  if (eventType === OsEventTypeList.CLICK_EVENT || (eventType === undefined && event.listEvent)) {
    const selectedIndex = hasIncomingIndex
      ? clampIndex(incoming.index, filteredCommands.length)
      : 0

    bridgeState.selectedIndex = selectedIndex
    const selectedCommand = filteredCommands[selectedIndex]
    if (!selectedCommand) {
      return
    }

    syncBrowserSelectionByCommandId(selectedCommand.id)
    syncBrowserGlassSelectionByCommandId(selectedCommand.id)
    appendEventLog(`REST API glass: run ${displayName(selectedCommand)}`)

    const run = bridgeState.onSelectAndRun
    if (run) {
      await run(selectedCommand)
    }
  }
}

function registerBridgeEvents(bridge: EvenAppBridge): void {
  if (bridgeState.eventLoopRegistered) {
    return
  }

  bridge.onEvenHubEvent(async (event) => {
    const rawEventType = getRawEventType(event)
    let eventType = normalizeEventType(rawEventType, OsEventTypeList)
    const incomingContainerId = event.listEvent?.containerID
    const focusFromContainer: GlassListFocus | null = incomingContainerId === TAG_LIST_CONTAINER_ID
      ? 'tags'
      : incomingContainerId === COMMAND_LIST_CONTAINER_ID
        ? 'commands'
        : null
    const eventFocus = focusFromContainer ?? bridgeState.activeListFocus
    if (focusFromContainer) {
      bridgeState.activeListFocus = focusFromContainer
    }

    if (eventType === undefined && event.listEvent) {
      // Keep parity with base_app behavior: ambiguous list events default to click.
      eventType = OsEventTypeList.CLICK_EVENT
    }

    if (eventType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
      const handledByResponseView = await handleResponseViewEvent(bridge, eventType)
      if (handledByResponseView) {
        return
      }

      bridgeState.activeListFocus = bridgeState.activeListFocus === 'commands' ? 'tags' : 'commands'
      await showBridgeMainPage(bridge)
      appendEventLog(`REST API glass: focus ${bridgeState.activeListFocus}`)
      return
    }

    const handledByResponseView = await handleResponseViewEvent(bridge, eventType)
    if (handledByResponseView) {
      return
    }

    if (eventFocus === 'tags') {
      await handleTagListEvent(bridge, event, eventType)
      return
    }

    await handleCommandListEvent(bridge, event, eventType)
  })

  bridgeState.eventLoopRegistered = true
}

function getBridgeDisplay(): BridgeDisplay {
  if (!bridgeState.bridge) {
    throw new Error('Bridge unavailable')
  }

  return {
    mode: 'bridge',
    async show(message: string) {
      bridgeState.statusMessage = message
      clearGlassResponseView()
      const bridge = bridgeState.bridge!
      const updated = await updateBridgeStatusText(bridge, bridgeState.statusMessage)
      if (updated) {
        return
      }

      const filteredCommands = getFilteredCommands()
      bridgeState.selectedIndex = clampIndex(bridgeState.selectedIndex, filteredCommands.length)
      await renderBridgePage(bridge, filteredCommands, bridgeState.selectedIndex, bridgeState.statusMessage)
    },
    async renderList(commands: RestCommand[], selectedIndex: number, statusMessage?: string) {
      bridgeState.selectedIndex = clampIndex(selectedIndex, commands.length)
      if (statusMessage) {
        bridgeState.statusMessage = statusMessage
      }
      await renderBridgePage(bridgeState.bridge!, commands, bridgeState.selectedIndex, bridgeState.statusMessage)
    },
    onSelectAndRun(runner) {
      bridgeState.onSelectAndRun = runner
    },
  }
}

async function initBridgeDisplay(timeoutMs = 4000): Promise<BridgeDisplay> {
  try {
    bridgeState.bridge = await withTimeout(waitForEvenAppBridge(), timeoutMs)
    registerBridgeEvents(bridgeState.bridge)

    if (!bridgeDisplay || bridgeDisplay.mode !== 'bridge') {
      bridgeDisplay = getBridgeDisplay()
    }

    return bridgeDisplay
  } catch {
    bridgeState.bridge = null
    bridgeState.startupRendered = false
    bridgeState.statusMessage = 'Select command and click'
    bridgeDisplay = getMockBridgeDisplay()
    return bridgeDisplay
  }
}

export function createRestApiActions(setStatus: SetStatus): AppActions {
  let uiInitialized = false
  let isFetching = false

  const runRequestByCommand = async (command: RestCommand): Promise<void> => {
    if (!activeUi) {
      return
    }

    if (isFetching) {
      setStatus('Request already in progress')
      appendEventLog('REST API: request ignored (already in progress)')
      return
    }

    setStatus(`Fetching ${command.url} ...`)
    appendEventLog(`REST API: GET ${command.url} (${displayName(command)})`)

    if (bridgeDisplay) {
      await bridgeDisplay.show(`Loading ${displayName(command)}...`)
    }

    isFetching = true
    try {
      const { statusLine, body } = await fetchAsText(PROXY_PATH, command.url)
      const preview = body.length > 200 ? `${body.slice(0, 200)}...` : body

      activeUi.response.textContent = body
      setStatus(`GET complete: ${statusLine}`)
      appendEventLog(`REST API: ${statusLine}`)
      appendEventLog(`REST API response preview: ${preview.replace(/\n/g, ' ')}`)

      if (bridgeDisplay) {
        const bridgeBody = `${statusLine}\n${body}`.trim()
        if (shouldShowResponsePage(bridgeBody)) {
          setGlassResponseView(displayName(command), bridgeBody)
          await bridgeDisplay.renderList(getFilteredCommands(), bridgeState.selectedIndex, statusLine)
        } else {
          const compactPreview = preview.replace(/\s+/g, ' ').slice(0, 96)
          await bridgeDisplay.show(compactPreview || body.slice(0, 96))
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      activeUi.response.textContent = `Request failed:\n${message}`
      setStatus('GET failed')
      appendEventLog(`REST API: request failed (${message})`)

      if (bridgeDisplay) {
        const bridgeBody = `GET failed\n${message}`.trim()
        if (shouldShowResponsePage(bridgeBody)) {
          setGlassResponseView(displayName(command), bridgeBody)
          await bridgeDisplay.renderList(getFilteredCommands(), bridgeState.selectedIndex, 'GET failed')
        } else {
          await bridgeDisplay.show(message.slice(0, 96))
        }
      }
    } finally {
      isFetching = false
    }
  }

  const syncBridgeList = (): void => {
    if (!activeUi || !bridgeDisplay || bridgeDisplay.mode !== 'bridge') {
      return
    }

    syncTagSelectionIndexFromFilter()
    const filtered = getFilteredCommands()
    bridgeState.selectedIndex = clampIndex(bridgeState.selectedIndex, filtered.length)
    syncBrowserGlassSelectionByCommandId(currentGlassSelectedCommandId())
    bridgeState.statusMessage = buildFilterStatus()
    void bridgeDisplay.renderList(filtered, bridgeState.selectedIndex, bridgeState.statusMessage)
  }

  const bindUiEvents = (): void => {
    if (!activeUi) {
      return
    }
    const ui = activeUi

    ui.commandTableBody.onclick = (event) => {
      const target = event.target as HTMLElement
      const removeButton = target.closest<HTMLButtonElement>('button[data-remove-command-id]')
      if (removeButton) {
        const selectedId = Number.parseInt(removeButton.dataset.removeCommandId ?? '', 10)
        if (!Number.isFinite(selectedId)) {
          setStatus('No command selected')
          return
        }

        const removed = store.removeById(selectedId)
        refreshUiData()

        if (!removed) {
          setStatus('No command selected')
          return
        }

        setStatus(`Removed command: ${displayName(removed)}`)
        appendEventLog(`REST API: removed command ${removed.url}`)
        persistCommands()
        syncBridgeList()
        return
      }

      const row = target.closest<HTMLTableRowElement>('tr[data-select-command-id]')
      if (!row) {
        return
      }

      const selectedId = Number.parseInt(row.dataset.selectCommandId ?? '', 10)
      if (!Number.isFinite(selectedId)) {
        return
      }

      syncBrowserSelectionByCommandId(selectedId)

      const selected = store.findById(selectedId)
      if (!selected) {
        bridgeState.selectedIndex = 0
        syncBridgeList()
        return
      }

      const filtered = getFilteredCommands()
      const idx = filtered.findIndex((command) => command.id === selected.id)
      bridgeState.selectedIndex = idx >= 0 ? idx : 0
      syncBridgeList()
    }

    ui.tagFilterGroup.onclick = (event) => {
      const target = event.target as HTMLElement
      const button = target.closest<HTMLButtonElement>('button[data-tag-filter]')
      if (!button) {
        return
      }

      bridgeState.activeTagFilter = button.dataset.tagFilter ?? TAG_ALL
      syncTagFilter(ui, bridgeState.activeTagFilter)
      bridgeState.selectedIndex = 0
      appendEventLog(`REST API: tag filter set to ${getTagFilterLabel(bridgeState.activeTagFilter)}`)
      syncBridgeList()
    }

    ui.addButton.onclick = () => {
      const input = readCommandInput(ui)
      if (!input.url) {
        setStatus('Enter a URL before adding')
        return
      }

      const parsedTags = parseTagsInput(input.tagsInput)
      const { command, created } = store.upsert(input.url, input.name, parsedTags)
      refreshUiData(command.id)
      clearCommandInput(ui)

      if (created) {
        setStatus(`Added command: ${displayName(command)}`)
        appendEventLog(`REST API: added command ${command.url}`)
      } else {
        setStatus(`Updated command: ${displayName(command)}`)
        appendEventLog(`REST API: updated command ${command.url}`)
      }

      persistCommands()
      syncBridgeList()
    }

    ui.exportButton.onclick = () => {
      const payload = toImportableCommands(store.list())
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const filename = `restapi-commands-${new Date().toISOString().replace(/[:.]/g, '-')}.json`

      const link = document.createElement('a')
      link.href = url
      link.download = filename
      document.body.append(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)

      setStatus(`Exported ${payload.length} command(s) to file`)
    }

    ui.importButton.onclick = async () => {
      const file = ui.importFileInput.files?.[0]
      if (!file) {
        setStatus('Choose a JSON file first')
        return
      }

      let parsed: unknown
      try {
        parsed = JSON.parse(await file.text())
      } catch {
        setStatus('Import file JSON is invalid')
        return
      }

      const entries = parseImportEntries(parsed)
      if (!entries) {
        setStatus('Import format must be an array of commands')
        return
      }

      let importedCount = 0
      let lastCommandId: number | undefined

      for (const entry of entries) {
        const { command } = store.upsert(entry.url, entry.name, entry.tags)
        lastCommandId = command.id
        importedCount += 1
      }

      if (importedCount === 0) {
        setStatus('No valid commands found in import file')
        return
      }

      refreshUiData(lastCommandId)
      setStatus(`Imported ${importedCount} command(s) from file`)
      appendEventLog(`REST API: imported ${importedCount} command(s)`)
      ui.importFileInput.value = ''
      persistCommands()
      syncBridgeList()
    }
  }

  return {
    async connect() {
      const persisted = loadPersistedCommands()
      if (persisted && persisted.length > 0) {
        store.replaceAll(persisted)
      }

      activeUi = ensureUi()
      refreshUiData()

      if (!uiInitialized) {
        bindUiEvents()
        uiInitialized = true
      }

      bridgeDisplay = await initBridgeDisplay()
      bridgeDisplay.onSelectAndRun(runRequestByCommand)

      const selected = selectedCommandFromUi()
      if (selected) {
        const filtered = getFilteredCommands()
        const index = filtered.findIndex((command) => command.id === selected.id)
        bridgeState.selectedIndex = index >= 0 ? index : 0
      }

      if (bridgeDisplay.mode === 'bridge') {
        syncBridgeList()
        setStatus('REST API ready. Up/Down select, Click run, Double-tap switches tags/commands list focus.')
        appendEventLog('REST API: controls initialized (bridge mode)')
      } else {
        syncBrowserGlassSelectionByCommandId(null)
        setStatus('REST API controls ready. Bridge not found, browser mode active.')
        appendEventLog('REST API: controls initialized (mock mode)')
      }
    },

    async action() {
      if (!activeUi) {
        setStatus('Run setup first')
        appendEventLog('REST API: request blocked (setup not run)')
        return
      }

      const selected = selectedCommandFromUi()
      if (!selected) {
        setStatus('No command selected')
        appendEventLog('REST API: request blocked (no command selected)')
        return
      }

      await runRequestByCommand(selected)
    },
  }
}
