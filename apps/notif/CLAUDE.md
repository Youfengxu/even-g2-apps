# Even Realities G2 — Claude Code Development Guide

This file gives Claude Code the context needed to help build apps for the Even Realities G2 smart glasses using the Even Hub SDK. Based on the official G2 development notes by nickustinov and community reference apps.

---

## Architecture

Even Hub apps are **regular web apps hosted on any server** (Vercel, Cloudflare, local, VPS). The iPhone is purely a proxy.

```
[Your server] <--HTTPS--> [iPhone WebView (Even App)] <--BLE--> [G2 Glasses]
```

- Your web app runs on your server with its own backend, DB, and API keys — like any web app
- The iPhone runs the Even App (Flutter), which opens your app's URL in a `flutter_inappwebview` and relays messages to the glasses over BLE
- No code runs on the glasses — they are a display + input peripheral
- The SDK injects a JS bridge (`EvenAppBridge`) into the WebView's `window` object
- Standard web capabilities are available in the WebView: `fetch`, `localStorage`, session tokens, etc.

---

## Hardware Constraints

| Property | Value |
|---|---|
| Canvas | 576 × 288 pixels per eye |
| Display | Green micro-LED, 4-bit greyscale (16 shades) |
| Max containers per page | 4 |
| Image max size | 200 × 100 px |
| Text content limit (startup/rebuild) | 1000 characters |
| Text content limit (upgrade) | 2000 characters |
| Audio | Microphone only (no speaker). PCM 16kHz, S16LE mono, 40 bytes/frame |
| Input | Tap, double-tap, swipe forward, swipe back (R1 ring + temple touch) |
| BLE range | ~28m |

White pixels appear as bright green on the display. Black pixels are off (micro-LED). No camera, no speaker, no arbitrary pixel drawing.

---

## Official Packages

```bash
npm install @evenrealities/even_hub_sdk           # always required
npm install -D @evenrealities/evenhub-cli         # CLI: QR codes, packaging, login
npm install @evenrealities/evenhub-simulator      # local simulator
npm rebuild @evenrealities/evenhub-simulator      # required after install (native bindings)
npm install @jappyjan/even-realities-ui           # React UI library for browser settings page
```

---

## SDK Initialisation

```typescript
import { waitForEvenAppBridge, EvenAppBridge } from '@evenrealities/even_hub_sdk'

// Method 1: async wait (recommended) — resolves when bridge is ready
const bridge = await waitForEvenAppBridge()

// Method 2: synchronous singleton — only use after bridge is already initialised
const bridge = EvenAppBridge.getInstance()
```

---

## Container Model

The UI is built from **containers** — absolutely positioned rectangular regions. There is no CSS, no flexbox, no DOM layout.

**Rules:**
- Max **4 containers per page** (mixed types allowed)
- Exactly **one** container must have `isEventCapture: 1` — this receives input events
- `containerTotalNum` must exactly match the number of containers passed
- Containers can overlap; later containers draw on top (no z-index control)
- Container IDs and names must be unique per page

### Shared Container Properties

| Property | Type | Notes |
|---|---|---|
| `xPosition` | number | Left edge in pixels (0–576) |
| `yPosition` | number | Top edge in pixels (0–288) |
| `width` | number | Container width in pixels |
| `height` | number | Container height in pixels |
| `containerID` | number | Unique per page, used for updates |
| `containerName` | string | Max 16 chars, unique per page, used for updates |
| `isEventCapture` | number | 0 or 1 — exactly one container must be 1 |

### Border Properties (text and list only, not images)

| Property | Type | Notes |
|---|---|---|
| `borderWidth` | number | 0–5. 0 = no border |
| `borderColor` | number | 0–15 (list), 0–16 (text). 5 = subtle grey, 13 = bright |
| `borderRdaius` | number | 0–10. **SDK typo — use `borderRdaius` not `borderRadius`** |
| `paddingLength` | number | 0–32, uniform on all sides |

No background colour, no fill — border is the only decoration.

---

## Container Types

### Text Container (`TextContainerProperty`)

The primary workhorse. Renders plain text, left-aligned, top-aligned.

```typescript
import { TextContainerProperty } from '@evenrealities/even_hub_sdk'

new TextContainerProperty({
  xPosition: 0,
  yPosition: 0,
  width: 576,
  height: 288,
  borderWidth: 0,
  borderColor: 5,
  paddingLength: 4,
  containerID: 1,
  containerName: 'main-text',
  content: 'Hello from G2',
  isEventCapture: 1,
})
```

**Text rendering notes:**
- `\n` works for line breaks
- Unicode characters work (e.g. `▲`, `━`, `─`, `│`, `□`, `●`) — useful for grids and progress bars
- No font selection, size, weight, or alignment control — single fixed-width-ish font
- To "centre" text, manually pad with spaces
- ~400–500 chars fill a full 576×288 container depending on character width
- If content overflows AND `isEventCapture: 1`, the firmware scrolls text internally
- Containers without `isEventCapture: 1` clip overflow text

### List Container (`ListContainerProperty`)

Native scrollable list — the firmware handles scroll highlighting automatically.

```typescript
import { ListContainerProperty, ListItemContainerProperty } from '@evenrealities/even_hub_sdk'

new ListContainerProperty({
  xPosition: 0,
  yPosition: 0,
  width: 576,
  height: 288,
  borderWidth: 1,
  borderColor: 13,
  borderRdaius: 6,
  paddingLength: 5,
  containerID: 1,
  containerName: 'my-list',
  isEventCapture: 1,
  itemContainer: new ListItemContainerProperty({
    itemCount: 5,
    itemWidth: 560,           // containerWidth - 2*padding, or 0 for auto
    isItemSelectBorderEn: 1,  // show selection highlight
    itemName: ['Item 1', 'Item 2', 'Item 3', 'Item 4', 'Item 5'],
  }),
})
```

**List behaviour:**
- Max 20 items, max 64 chars per item name
- Firmware handles scrolling natively — no `rebuildPageContainer` needed for navigation
- `SCROLL_TOP_EVENT` / `SCROLL_BOTTOM_EVENT` fire only at list boundaries
- Click events report `currentSelectItemIndex` (0-based) and `currentSelectItemName`
- Cannot update items in-place — must `rebuildPageContainer` to change list content
- No per-item styling, icons, or secondary text

### Image Container (`ImageContainerProperty`)

```typescript
import { ImageContainerProperty } from '@evenrealities/even_hub_sdk'

new ImageContainerProperty({
  xPosition: 188,   // (576-200)/2 to centre
  yPosition: 94,    // (288-100)/2 to centre
  width: 200,
  height: 100,
  containerID: 2,
  containerName: 'screen',
  // NOTE: image containers cannot have isEventCapture
})
```

**Image constraints:**
- Width: 20–200 px, Height: 20–100 px (cannot cover full 576×288 canvas)
- Host app converts all images to 4-bit greyscale (16 shades) via `imageToGray4`
- Image containers are **empty placeholders** at creation — call `updateImageRawData` to populate
- Do NOT send concurrent image updates — queue sequentially
- If image data is smaller than container dimensions, hardware **tiles (repeats)** it — always match sizes

**Image data formats accepted by SDK:**
```typescript
// PNG bytes as number[] (recommended)
const pngBytes = Array.from(new Uint8Array(await pngBlob.arrayBuffer()))

// base64 PNG string (strip the data URL prefix)
const base64 = canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '')

// Also accepts: Uint8Array, ArrayBuffer
```

**Image processing advice:**
- Send greyscale images — colour is discarded anyway
- Do NOT do 1-bit dithering in your app — the host's 4-bit conversion is better; manual Floyd-Steinberg creates noisy green dots
- Resize to fit container, centre on a black canvas (black = off on micro-LED)
- Greyscale formula: `0.299R + 0.587G + 0.114B` (BT.601)

---

## Page Lifecycle Methods

### `createStartUpPageContainer`

Must be called **exactly once** at app startup. Returns `StartUpPageCreateResult` (0=success, 1=invalid, 2=oversize, 3=outOfMemory).

```typescript
import { CreateStartUpPageContainer } from '@evenrealities/even_hub_sdk'

const result = await bridge.createStartUpPageContainer(
  new CreateStartUpPageContainer({
    containerTotalNum: 2,
    textObject: [textContainer],
    listObject: [],
    imageObject: [],
  })
)
if (result !== 0) console.error('Startup failed:', result)
```

### `rebuildPageContainer`

Replaces the entire page. Use for screen transitions (splash → game → settings). Causes a brief flicker on real hardware. Loses all scroll position and list selection state.

```typescript
import { RebuildPageContainer } from '@evenrealities/even_hub_sdk'

await bridge.rebuildPageContainer(
  new RebuildPageContainer({
    containerTotalNum: 1,
    textObject: [newTextContainer],
  })
)
```

### `textContainerUpgrade`

Updates text in an existing container **without rebuilding the page**. Faster, flicker-free on real hardware. Use this for game loops and frequent updates.

```typescript
import { TextContainerUpgrade } from '@evenrealities/even_hub_sdk'

await bridge.textContainerUpgrade(new TextContainerUpgrade({
  containerID: 1,
  containerName: 'main-text',
  contentOffset: 0,     // optional: start index of substring to replace
  contentLength: 50,    // optional: length of substring to replace
  content: 'New text',
}))
// Returns boolean (success/failure)
```

### `updateImageRawData`

Sends image data to an existing image container. Never call concurrently.

```typescript
import { ImageRawDataUpdate } from '@evenrealities/even_hub_sdk'

await bridge.updateImageRawData(new ImageRawDataUpdate({
  containerID: 2,
  containerName: 'screen',
  imageData: pngBytes,    // number[], Uint8Array, ArrayBuffer, or base64 string
}))
// Returns ImageRawDataUpdateResult: success | imageException | imageSizeInvalid | imageToGray4Failed | sendFailed
```

### `shutDownPageContainer`

```typescript
await bridge.shutDownPageContainer(0)  // 0 = immediate exit
await bridge.shutDownPageContainer(1)  // 1 = show exit confirmation dialog
```

---

## Input Events

### Event Types (`OsEventTypeList`)

| Event | Value | Notes |
|---|---|---|
| `CLICK_EVENT` | 0 | Ring tap or temple tap |
| `SCROLL_TOP_EVENT` | 1 | Internal scroll hit top boundary |
| `SCROLL_BOTTOM_EVENT` | 2 | Internal scroll hit bottom boundary |
| `DOUBLE_CLICK_EVENT` | 3 | Ring or temple double-tap |
| `FOREGROUND_ENTER_EVENT` | 4 | App came to foreground |
| `FOREGROUND_EXIT_EVENT` | 5 | App went to background |
| `ABNORMAL_EXIT_EVENT` | 6 | Unexpected disconnect |

### Event Handling

```typescript
import { OsEventTypeList } from '@evenrealities/even_hub_sdk'

bridge.onEvenHubEvent((event) => {
  const { listEvent, textEvent, sysEvent, audioEvent } = event

  if (listEvent) {
    const { eventType, currentSelectItemIndex, currentSelectItemName } = listEvent
    // CRITICAL: CLICK_EVENT (0) becomes undefined in SDK's fromJson — check both
    if (eventType === OsEventTypeList.CLICK_EVENT || eventType === undefined) {
      handleListClick(currentSelectItemIndex ?? trackedIndex, currentSelectItemName)
    }
    if (eventType === OsEventTypeList.SCROLL_BOTTOM_EVENT) handleNextPage()
    if (eventType === OsEventTypeList.SCROLL_TOP_EVENT) handlePrevPage()
  }

  if (textEvent) {
    const { eventType } = textEvent
    if (eventType === OsEventTypeList.CLICK_EVENT || eventType === undefined) handleClick()
    if (eventType === OsEventTypeList.DOUBLE_CLICK_EVENT) handleDoubleClick()
    if (eventType === OsEventTypeList.SCROLL_BOTTOM_EVENT) handleScrollDown()
    if (eventType === OsEventTypeList.SCROLL_TOP_EVENT) handleScrollUp()
  }

  if (sysEvent) {
    // Simulator sends sysEvent for clicks; real hardware sends textEvent or listEvent
    handleSysEvent(sysEvent.eventType)
  }

  if (audioEvent) {
    // PCM: 16kHz, S16LE mono, 40 bytes per frame (10ms frames)
    processPcmFrame(audioEvent.audioPcm)
  }
})
```

### Critical Event Quirks

1. **`CLICK_EVENT = 0` becomes `undefined`:** Always check `eventType === OsEventTypeList.CLICK_EVENT || eventType === undefined`.

2. **Missing `currentSelectItemIndex`:** Simulator and sometimes real hardware omits index 0. Always maintain your own `selectedIndex` in state as fallback.

3. **Simulator vs real device:** Simulator sends `sysEvent` for clicks; real hardware sends `textEvent` or `listEvent`. Handle all three.

4. **Swipe throttling:** Scroll events can fire rapidly. Use a cooldown (e.g. 300ms).

5. **Event routing depends on `isEventCapture`:** The container with `isEventCapture: 1` determines whether you get `listEvent` vs `textEvent`.

---

## Event Capture for Image Apps (Critical Pattern)

Image containers **cannot** have `isEventCapture`. To receive input while showing images:

```typescript
// Place a full-screen text container with isEventCapture: 1 BEHIND the image
// Events arrive as textEvent (not listEvent)
// Do NOT use a hidden 1-item list — generates no scroll events

const config = new CreateStartUpPageContainer({
  containerTotalNum: 2,
  textObject: [
    new TextContainerProperty({
      containerID: 1,
      containerName: 'evt',
      content: ' ',              // just a space
      xPosition: 0, yPosition: 0, width: 576, height: 288,
      isEventCapture: 1,
      paddingLength: 0,
    }),
  ],
  imageObject: [
    new ImageContainerProperty({
      containerID: 2,            // higher ID = drawn on top
      containerName: 'screen',
      xPosition: 188, yPosition: 94,   // centred: (576-200)/2, (288-100)/2
      width: 200, height: 100,
    }),
  ],
})
```

---

## Device Info & User Info

```typescript
const device = await bridge.getDeviceInfo()
// device.model            — DeviceModel.G1 | DeviceModel.G2 | DeviceModel.Ring1
// device.sn               — serial number string
// device.status.batteryLevel     — 0–100
// device.status.isWearing        — boolean
// device.status.isCharging       — boolean
// device.isGlasses()             — helper method
// device.status.isConnected()    — helper method

// Real-time monitoring
const unsubscribe = bridge.onDeviceStatusChanged((status) => {
  console.log('Battery:', status.batteryLevel)
})
unsubscribe()  // call to stop

const user = await bridge.getUserInfo()
// user.uid, user.name, user.avatar (URL), user.country
```

---

## Local Storage & Audio

```typescript
// Phone-side key-value persistence
await bridge.setLocalStorage('key', 'value')         // returns boolean
const value = await bridge.getLocalStorage('key')    // returns string

// Microphone — must call createStartUpPageContainer first
await bridge.audioControl(true)   // start
await bridge.audioControl(false)  // stop
// PCM arrives via onEvenHubEvent as audioEvent.audioPcm (Uint8Array)
// Format: 16kHz, S16LE mono, 40 bytes/frame, 10ms frames
```

---

## Game Loop Pattern

```typescript
const TARGET_MS = 80  // ~12fps. Use 350 for ~3fps

async function tick() {
  const frameStart = Date.now()

  updateState()
  const frame = renderToString()

  await bridge.textContainerUpgrade(new TextContainerUpgrade({
    containerID: 1,
    containerName: 'screen',
    content: frame,
  }))

  const elapsed = Date.now() - frameStart
  const remaining = TARGET_MS - elapsed
  if (remaining > 0) await sleep(remaining)

  if (!stopped) setTimeout(tick, 0)
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
```

Await each push before scheduling the next tick. If a push is still in flight when the next tick fires, drop that frame silently — don't queue or await twice.

---

## Unicode Grid Rendering

```typescript
// Common characters for 2D grids
const EMPTY  = '□'   // U+25A1
const BLOCK  = '▦'   // U+25A6
const FOOD   = '◆'   // U+25C6
const BALL   = '●'   // U+25CF
const VLINE  = '│'   // U+2502
const FILL   = '━'   // U+2501
const EMPTY_LINE = '─'  // U+2500

// Practical grid: 28 cols × 10 rows fits well on screen
function renderGrid(grid: string[][]): string {
  return grid.map(row => row.join('')).join('\n')
}

// Progress bar
function progressBar(value: number, max: number, width: number): string {
  const filled = Math.round((value / max) * width)
  return '━'.repeat(filled) + '─'.repeat(width - filled)
}

// Text-based cursor menu (no button widget exists)
function renderMenu(items: string[], selected: number): string {
  return items.map((item, i) =>
    (i === selected ? '> ' : '  ') + item
  ).join('\n')
}
```

---

## UI Patterns

**Page switching:** Use `rebuildPageContainer` only for screen transitions (splash → game → settings). Define layout constants outside your render loop.

**Frequent updates:** Use `textContainerUpgrade` only. Never call `rebuildPageContainer` in a game loop.

**Long text — manual pagination:** Pre-paginate at ~400-char chunks at word boundaries. Track `pageIndex`. Rebuild on `SCROLL_BOTTOM_EVENT` / `SCROLL_TOP_EVENT`. Show `Page 2/5` in a header container.

**Text menus:** Use a text container with `>` cursor prefix and track position in state. Update via `textContainerUpgrade`.

**Multi-row layouts:** Use multiple text containers as rows (e.g. 3 containers at `height: 96` = 288px total). Toggle `borderWidth` for selection highlight.

**Swipe cooldown:**
```typescript
let lastSwipe = 0
function onScroll() {
  const now = Date.now()
  if (now - lastSwipe < 300) return
  lastSwipe = now
  // handle
}
```

---

## Project Structure (recommended)

```
my-app/
  g2/
    index.ts       # App module registration
    main.ts        # Bridge init and auto-connect
    app.ts         # Main loop / orchestrator
    state.ts       # All mutable state
    logic.ts       # Pure app logic (no SDK calls)
    renderer.ts    # All SDK display calls
    events.ts      # Input event normalisation and dispatch
    layout.ts      # Display constants (container coords, grid size, etc.)
  src/
    main.ts        # Web entry point
    styles.css
  index.html       # Required entry point
  app.json         # App metadata
  package.json
  tsconfig.json
  vite.config.ts
```

---

## Minimal File Templates

### `index.html`
```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>My App</title>
  <link rel="stylesheet" href="/src/styles.css">
</head>
<body>
  <div id="app"></div>
  <script type="module" src="/src/main.ts"></script>
</body>
</html>
```

### `package.json`
```json
{
  "name": "my-even-app",
  "scripts": {
    "dev": "vite --host 0.0.0.0 --port 5173",
    "build": "vite build",
    "qr": "evenhub qr --http --port 5173",
    "pack": "npm run build && evenhub pack app.json dist -o myapp.ehpk"
  },
  "dependencies": {
    "@evenrealities/even_hub_sdk": "^0.0.7"
  },
  "devDependencies": {
    "@evenrealities/evenhub-cli": "latest",
    "typescript": "^5.9.3",
    "vite": "^7.3.1"
  }
}
```

### `vite.config.ts`
```typescript
import { defineConfig } from 'vite'
export default defineConfig({
  server: { host: true, port: 5173 },
})
```

### `tsconfig.json`
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true
  },
  "include": ["src", "g2"]
}
```

### `app.json`
```json
{
  "package_id": "com.yourname.myapp",
  "edition": "202601",
  "name": "My App",
  "version": "1.0.0",
  "min_app_version": "0.1.0",
  "tagline": "Short description for Even Hub",
  "description": "Longer description",
  "author": "Your Name",
  "entrypoint": "index.html",
  "permissions": {
    "network": ["api.example.com"],
    "fs": ["./assets"]
  }
}
```

`package_id` rules: reverse-domain format, each segment starts with lowercase letter, only lowercase letters or numbers per segment. No hyphens. E.g. `com.paul.myapp` ✓, `com.my-app.thing` ✗.

---

## Development Workflow

### With even-dev simulator
```bash
git clone https://github.com/BxNxM/even-dev.git
cd even-dev
npm install
npm install @evenrealities/evenhub-simulator
npm rebuild @evenrealities/evenhub-simulator
APP_PATH=/path/to/my-app ./start-even.sh
```

### On real glasses via QR
```bash
# Terminal 1
npm run dev

# Terminal 2
npm run qr
# or explicitly:
npx evenhub qr --url "http://192.168.x.x:5173"
```

Scan QR from the Even Hub page in the Even Realities mobile app. Phone and dev machine must be on the same network.

### Even Hub CLI reference
```bash
npx evenhub login                               # authenticate developer account
npx evenhub init                                # generate app.json template
npx evenhub qr --url "http://192.x.x.x:5173"   # QR for real glasses
npx evenhub qr --clear                          # reset cached settings
npx evenhub pack app.json dist -o myapp.ehpk    # package for distribution
```

---

## What the SDK Does NOT Expose

- No direct BLE access
- No arbitrary pixel drawing (only list/text/image container model)
- No text alignment (no centre, no right-align)
- No font size, weight, or family control
- No background colour or fill on containers
- No per-item styling in lists
- No programmatic scroll position control
- No animations or transitions
- No audio output (no speaker on hardware)

---

## Common Mistakes to Avoid

- **`rebuildPageContainer` in a game loop** — use `textContainerUpgrade` for frame updates
- **No event capture container** — every page must have exactly one `isEventCapture: 1`
- **Image container as event capture** — image containers cannot capture events; put a text container behind the image
- **Hidden 1-item list for event capture** — generates no scroll events; use a text container
- **Concurrent image updates** — wait for each `updateImageRawData` to complete before the next
- **Not checking `eventType === undefined` for clicks** — `CLICK_EVENT` (value 0) normalises to `undefined` in SDK's `fromJson`
- **Not tracking `selectedIndex` in state** — `currentSelectItemIndex` may be omitted for index 0
- **`borderRadius` typo** — the correct SDK property is `borderRdaius` (preserved protobuf typo)
- **Image larger than 200×100** — maximum size; cannot cover full canvas
- **Size mismatch causes tiling** — always match image data dimensions to container dimensions
- **Manual 1-bit dithering** — the host's 4-bit conversion is better
- **`host: false` in Vite** — real device needs `host: true`
- **Hyphens in `package_id`** — only lowercase letters and numbers per segment

---

## Error Codes

| Context | Code | Meaning |
|---|---|---|
| Startup | 0 | Success |
| | 1 | Invalid container config |
| | 2 | Oversize (data too large for BLE) |
| | 3 | Out of memory on glasses |
| Image update | `success` | OK |
| | `imageSizeInvalid` | Dimensions out of range or mismatch |
| | `imageToGray4Failed` | Greyscale conversion failed |
| | `sendFailed` | BLE send failed |

---

## Key References

| Resource | URL |
|---|---|
| SDK (npm) | https://www.npmjs.com/package/@evenrealities/even_hub_sdk |
| CLI (npm) | https://www.npmjs.com/package/@evenrealities/evenhub-cli |
| Simulator (npm) | https://www.npmjs.com/package/@evenrealities/evenhub-simulator |
| UI library (npm) | https://www.npmjs.com/package/@jappyjan/even-realities-ui |
| G2 dev notes (source of truth) | https://github.com/nickustinov/even-g2-notes/blob/main/G2.md |
| Dev environment | https://github.com/BxNxM/even-dev |
| Pong (best reference app) | https://github.com/nickustinov/pong-even-g2 |
| Snake | https://github.com/nickustinov/snake-even-g2 |
| Weather (settings UI example) | https://github.com/nickustinov/weather-even-g2 |
| Tesla (image rendering example) | https://github.com/nickustinov/tesla-even-g2 |
| Chess (complex app) | https://github.com/dmyster145/EvenChess |
| Reddit client | https://github.com/fuutott/rdt-even-g2-rddit-client |
| BLE reverse engineering | https://github.com/i-soxi/even-g2-protocol |
| Developer portal | https://evenhub.evenrealities.com |
| Community Discord | https://discord.gg/GsuDkKDXDe |
| UI/UX guidelines | https://www.figma.com/design/X82y5uJvqMH95jgOfmV34j/Even-Realities---Software-Design-Guidelines--Public- |
