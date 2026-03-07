export const TAG_ALL = '__all__'

export type RestCommand = {
  id: number
  url: string
  name: string
  tags: string[]
}

export type RestCommandSeed = {
  url: string
  name?: string
  tags?: string[]
}

export const DEFAULT_COMMANDS: RestCommandSeed[] = [
  {
    url: 'http://livingkitchen.local/rest/system/clock',
    name: 'Clock',
    tags: ['system', 'livingroom'],
  },
  {
    url: 'http://livingkitchen.local/rest/rgb/toggle',
    name: 'RGB Toggle',
    tags: ['lights', 'livingroom'],
  },
]

export function clampIndex(index: number, length: number): number {
  if (length <= 0) return 0
  return Math.max(0, Math.min(length - 1, index))
}

export function normalizeTags(tags: string[]): string[] {
  const normalized = tags
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean)

  return [...new Set(normalized)]
}

export function parseTagsInput(input: string): string[] {
  return normalizeTags(input.split(','))
}

export function displayName(command: RestCommand): string {
  return command.name || command.url
}

export function getTagFilterLabel(tagFilter: string): string {
  return tagFilter === TAG_ALL ? 'all tags' : `#${tagFilter}`
}

export class RestCommandStore {
  private commands: RestCommand[]
  private nextId: number

  constructor(seed: RestCommandSeed[] = DEFAULT_COMMANDS) {
    this.nextId = 1
    this.commands = seed.map((item) => this.create(item.url, item.name, item.tags ?? []))
  }

  list(): RestCommand[] {
    return this.commands
  }

  exportSeeds(): RestCommandSeed[] {
    return this.commands.map((command) => ({
      url: command.url,
      name: command.name,
      tags: [...command.tags],
    }))
  }

  findById(id: number): RestCommand | null {
    return this.commands.find((command) => command.id === id) ?? null
  }

  findByUrl(url: string): RestCommand | null {
    return this.commands.find((command) => command.url === url) ?? null
  }

  filtered(tagFilter: string): RestCommand[] {
    if (tagFilter === TAG_ALL) {
      return this.commands
    }
    return this.commands.filter((command) => command.tags.includes(tagFilter))
  }

  availableTags(): string[] {
    const set = new Set<string>()
    for (const command of this.commands) {
      for (const tag of command.tags) {
        set.add(tag)
      }
    }
    return [...set].sort((a, b) => a.localeCompare(b))
  }

  upsert(url: string, name: string, tags: string[]): { command: RestCommand; created: boolean } {
    const trimmedUrl = url.trim()
    const existing = this.findByUrl(trimmedUrl)

    if (existing) {
      existing.name = name.trim() || existing.name
      existing.tags = normalizeTags([...existing.tags, ...tags])
      return { command: existing, created: false }
    }

    const command = this.create(trimmedUrl, name, tags)
    this.commands.push(command)
    return { command, created: true }
  }

  removeById(id: number): RestCommand | null {
    const index = this.commands.findIndex((command) => command.id === id)
    if (index < 0) {
      return null
    }

    const [removed] = this.commands.splice(index, 1)
    return removed ?? null
  }

  replaceAll(seed: RestCommandSeed[]): void {
    this.nextId = 1
    this.commands = seed.map((item) => this.create(item.url, item.name, item.tags ?? []))
  }

  private create(url: string, name?: string, tags: string[] = []): RestCommand {
    return {
      id: this.nextId++,
      url: url.trim(),
      name: (name ?? '').trim(),
      tags: normalizeTags(tags),
    }
  }
}
