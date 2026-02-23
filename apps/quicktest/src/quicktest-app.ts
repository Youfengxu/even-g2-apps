import {
  CreateStartUpPageContainer,
  ImageContainerProperty,
  ListContainerProperty,
  ListItemContainerProperty,
  OsEventTypeList,
  RebuildPageContainer,
  TextContainerProperty,
  waitForEvenAppBridge,
  type EvenHubEvent,
} from '@evenrealities/even_hub_sdk'
import { withTimeout } from '../../_shared/async'
import { getRawEventType, normalizeEventType } from '../../_shared/even-events'
import { appendEventLog } from '../../_shared/log'

type SetStatus = (text: string) => void

type AppActions = {
  connect: () => Promise<void>
  render: () => Promise<void>
  action: () => Promise<void>
}

import generatedUiSource from './generated-ui.ts?raw'

function compileContainerFromGeneratedSource(source: string): CreateStartUpPageContainer {
  const sanitizedSource = source
    .replace(/import[\s\S]*?from\s+['"]@evenrealities\/even_hub_sdk['"]\s*;?/g, '')
    .replace(/export\s+default\s+container\s*;?/g, '')

  const buildContainer = new Function(
    'CreateStartUpPageContainer',
    'ListContainerProperty',
    'TextContainerProperty',
    'ImageContainerProperty',
    'ListItemContainerProperty',
    `"use strict";
${sanitizedSource}
return container;
`,
  )

  const container = buildContainer(
    CreateStartUpPageContainer,
    ListContainerProperty,
    TextContainerProperty,
    ImageContainerProperty,
    ListItemContainerProperty,
  )

  if (!(container instanceof CreateStartUpPageContainer)) {
    throw new Error('generated-ui.ts must define `const container = new CreateStartUpPageContainer(...)`')
  }

  return container
}

function getRebuildPayload(container: CreateStartUpPageContainer): Record<string, unknown> {
  const model = container as unknown as { toJson?: () => Record<string, unknown> }
  if (typeof model.toJson === 'function') {
    return model.toJson()
  }
  return container as unknown as Record<string, unknown>
}

function eventTypeLabel(eventType: OsEventTypeList | undefined): string {
  switch (eventType) {
    case OsEventTypeList.CLICK_EVENT:
      return 'CLICK'
    case OsEventTypeList.SCROLL_TOP_EVENT:
      return 'UP'
    case OsEventTypeList.SCROLL_BOTTOM_EVENT:
      return 'DOWN'
    case OsEventTypeList.DOUBLE_CLICK_EVENT:
      return 'DOUBLE_CLICK'
    default:
      return 'UNKNOWN'
  }
}

function ensureQuicktestEditorUi(initialSource: string, setStatus: SetStatus): {
  getSource: () => string
  resetToFileSource: () => void
} {
  const appRoot = document.getElementById('app')
  if (!appRoot) {
    return {
      getSource: () => initialSource,
      resetToFileSource: () => undefined,
    }
  }

  const existing = document.getElementById('quicktest-source-panel')
  if (existing) {
    const textarea = document.getElementById('quicktest-source-textarea') as HTMLTextAreaElement | null
    return {
      getSource: () => textarea?.value ?? initialSource,
      resetToFileSource: () => {
        if (textarea) textarea.value = initialSource
      },
    }
  }

  const panel = document.createElement('section')
  panel.id = 'quicktest-source-panel'
  panel.style.marginTop = '12px'
  panel.style.display = 'grid'
  panel.style.gap = '8px'

  const label = document.createElement('label')
  label.htmlFor = 'quicktest-source-textarea'
  label.textContent = 'Quicktest source (paste generated-ui drop-in code):'

  const exampleLink = document.createElement('a')
  const editorUrl = 'http://localhost:5173/even-ui-builder/'
  exampleLink.href = editorUrl
  exampleLink.target = '_blank'
  exampleLink.rel = 'noreferrer'
  exampleLink.textContent = `Open editor (external browser): ${editorUrl}`
  exampleLink.style.fontSize = '12px'
  exampleLink.style.background = '#eef2f7'
  exampleLink.style.color = '#1d4ed8'
  exampleLink.style.padding = '6px 8px'
  exampleLink.style.borderRadius = '6px'
  exampleLink.style.display = 'inline-block'
  exampleLink.style.textDecoration = 'underline'
  exampleLink.addEventListener('click', async (event) => {
    event.preventDefault()
    appendEventLog('Quicktest UI: open-editor link clicked')
    try {
      const response = await fetch(`/__open_editor?url=${encodeURIComponent(editorUrl)}`)
      if (response.ok) {
        setStatus(`Quicktest: opened editor in browser (${editorUrl})`)
        appendEventLog(`Quicktest UI: external editor opened (${editorUrl})`)
        return
      }
    } catch {
      // Fall back to window.open for standalone app dev outside even-dev root Vite.
    }

    window.open(editorUrl, '_blank', 'noopener,noreferrer')
    setStatus(`Quicktest: attempted to open editor (${editorUrl})`)
    appendEventLog(`Quicktest UI: external editor open requested (${editorUrl})`)
  })

  const textarea = document.createElement('textarea')
  textarea.id = 'quicktest-source-textarea'
  textarea.value = initialSource
  textarea.spellcheck = false
  textarea.style.minHeight = '220px'
  textarea.style.width = '100%'
  textarea.style.fontFamily = 'ui-monospace, SFMono-Regular, Menlo, monospace'
  textarea.style.fontSize = '12px'

  panel.append(label, exampleLink, textarea)
  appRoot.append(panel)

  return {
    getSource: () => textarea.value,
    resetToFileSource: () => {
      textarea.value = initialSource
    },
  }
}

export function createQuicktestActions(setStatus: SetStatus): AppActions {
  let didRenderStartup = false
  let bridgeConnected = false
  let bridgeRef: Awaited<ReturnType<typeof waitForEvenAppBridge>> | null = null
  let eventLoopRegistered = false
  const editorUi = ensureQuicktestEditorUi(generatedUiSource, setStatus)

  function registerEventLogging() {
    if (!bridgeRef || eventLoopRegistered) {
      return
    }
    appendEventLog('Quicktest: bridge event logging attached')
    bridgeRef.onEvenHubEvent((event) => {
      const rawEventType = getRawEventType(event)
      const eventType = normalizeEventType(rawEventType, OsEventTypeList)
      const selected = event.listEvent?.currentSelectItemName ?? event.listEvent?.currentSelectItemIndex ?? '-'
      const containerName = event.listEvent?.containerName ?? event.textEvent?.containerName ?? '-'
      const line = `Quicktest glass: ${eventTypeLabel(eventType)} | container=${containerName} | selected=${selected}`

      appendEventLog(line)
      console.log('[quicktest] bridge event', {
        normalizedEventType: eventTypeLabel(eventType),
        rawEventType,
        selected,
        containerName,
        event,
      })
    })
    eventLoopRegistered = true
  }

  async function renderCurrentSource() {
    const source = editorUi.getSource()
    const container = compileContainerFromGeneratedSource(source)
    appendEventLog('Quicktest: render button clicked')
    if (!bridgeConnected || !bridgeRef) {
      setStatus('Quicktest: connecting to bridge...')
      bridgeRef = await withTimeout(waitForEvenAppBridge(), 10_000)
      bridgeConnected = true
      appendEventLog('Quicktest: bridge connected')
      registerEventLogging()
    } else {
      registerEventLogging()
    }

    if (!didRenderStartup) {
      await bridgeRef.createStartUpPageContainer(container)
      didRenderStartup = true
      setStatus('Quicktest: startup UI rendered from source input')
      appendEventLog('Quicktest: startup UI created')
      return
    }

    await bridgeRef.rebuildPageContainer(new RebuildPageContainer(getRebuildPayload(container)))
    setStatus('Quicktest: page rebuilt from source input')
    appendEventLog('Quicktest: page rebuilt')
  }

  return {
    async connect() {
      try {
        setStatus('Quicktest: connecting to bridge...')
        if (!bridgeConnected || !bridgeRef) {
          bridgeRef = await withTimeout(waitForEvenAppBridge(), 10_000)
          bridgeConnected = true
          appendEventLog('Quicktest: bridge connected')
        } else {
          appendEventLog('Quicktest: bridge already connected')
        }
        registerEventLogging()
        setStatus('Quicktest: bridge connected. Rendering page...')
        await renderCurrentSource()
      } catch (error) {
        console.error('[quicktest] bridge connect failed', error)
        setStatus('Quicktest: failed to connect to bridge')
        appendEventLog('Quicktest: bridge connect failed')
      }
    },

    async render() {
      try {
        await renderCurrentSource()
      } catch (error) {
        console.error('[quicktest] connect failed', error)
        setStatus('Quicktest: failed to render source input (check code syntax/container)')
        appendEventLog('Quicktest: render failed')
      }
    },

    async action() {
      editorUi.resetToFileSource()
      setStatus('Quicktest: source reset to apps/quicktest/src/generated-ui.ts')
      appendEventLog('Quicktest: source reset button clicked')
    },
  }
}
