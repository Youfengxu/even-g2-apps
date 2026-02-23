const STORAGE_KEY = 'even.timer.presets.v1'

export function loadPresetSeconds(): number[] | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    return parsed
      .map((value) => (typeof value === 'number' ? value : Number(value)))
      .filter((value) => Number.isFinite(value))
      .map((value) => Math.floor(value))
  } catch {
    return null
  }
}

export function savePresetSeconds(values: number[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(values))
  } catch {
    // Ignore storage failures (private mode, quota, disabled storage).
  }
}
