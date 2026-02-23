export function getRawEventType(event: any): unknown {
  const raw = (event?.jsonData ?? {}) as Record<string, unknown>
  return (
    event?.listEvent?.eventType ??
    event?.textEvent?.eventType ??
    event?.sysEvent?.eventType ??
    event?.eventType ??
    raw.eventType ??
    raw.event_type ??
    raw.Event_Type ??
    raw.type
  )
}

export function normalizeEventType(rawEventType: unknown, eventTypes: {
  CLICK_EVENT: number
  SCROLL_TOP_EVENT: number
  SCROLL_BOTTOM_EVENT: number
  DOUBLE_CLICK_EVENT: number
}) {
  if (typeof rawEventType === 'number') {
    switch (rawEventType) {
      case 0:
        return eventTypes.CLICK_EVENT
      case 1:
        return eventTypes.SCROLL_TOP_EVENT
      case 2:
        return eventTypes.SCROLL_BOTTOM_EVENT
      case 3:
        return eventTypes.DOUBLE_CLICK_EVENT
      default:
        return undefined
    }
  }

  if (typeof rawEventType === 'string') {
    const value = rawEventType.toUpperCase()
    if (value.includes('DOUBLE')) return eventTypes.DOUBLE_CLICK_EVENT
    if (value.includes('CLICK')) return eventTypes.CLICK_EVENT
    if (value.includes('SCROLL_TOP') || value.includes('UP')) return eventTypes.SCROLL_TOP_EVENT
    if (value.includes('SCROLL_BOTTOM') || value.includes('DOWN')) return eventTypes.SCROLL_BOTTOM_EVENT
  }

  return undefined
}
