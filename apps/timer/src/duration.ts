export function formatDurationClock(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds))
  const minutes = Math.floor(safeSeconds / 60)
  const seconds = safeSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export function parseMinuteSecondInput(raw: string): number | null {
  const value = raw.trim()
  const match = value.match(/^(\d+):(\d{1,2})$/)
  if (!match) return null

  const minutes = Number.parseInt(match[1], 10)
  const seconds = Number.parseInt(match[2], 10)
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds) || seconds < 0 || seconds > 59) {
    return null
  }

  const total = minutes * 60 + seconds
  return total > 0 ? total : null
}

export function parseDurationLabel(raw: unknown): number | null {
  if (typeof raw !== 'string') return null
  const normalized = raw.trim().toLowerCase()

  const mmss = parseMinuteSecondInput(normalized)
  if (mmss !== null) return mmss

  const minutesOnly = normalized.match(/^(\d+)\s*m(in)?$/)
  if (minutesOnly) {
    const minutes = Number.parseInt(minutesOnly[1], 10)
    return Number.isFinite(minutes) ? minutes * 60 : null
  }

  return null
}
