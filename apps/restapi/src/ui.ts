import { displayName, TAG_ALL, type RestCommand } from './model'

export type RestUiState = {
  root: HTMLDivElement
  commandTableBody: HTMLTableSectionElement
  response: HTMLPreElement
  urlInput: HTMLInputElement
  nameInput: HTMLInputElement
  tagsInput: HTMLInputElement
  tagsDatalist: HTMLDataListElement
  addButton: HTMLButtonElement
  tagFilterGroup: HTMLDivElement
  exportButton: HTMLButtonElement
  importFileInput: HTMLInputElement
  importButton: HTMLButtonElement
}

function parseDatasetCommandId(value: string | undefined): number | null {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) ? parsed : null
}

function applyRowMarkers(ui: RestUiState): void {
  const selectedId = getSelectedCommandId(ui)
  const glassSelectedId = getGlassSelectedCommandId(ui)

  const rows = ui.commandTableBody.querySelectorAll<HTMLTableRowElement>('tr[data-command-id]')
  for (const row of rows) {
    const rowCommandId = parseDatasetCommandId(row.dataset.commandId)
    const isSelected = selectedId !== null && rowCommandId === selectedId
    const isGlassSelected = glassSelectedId !== null && rowCommandId === glassSelectedId

    row.classList.toggle('restapi-command-row-selected', isSelected)
    row.classList.toggle('restapi-command-row-glass-selected', isGlassSelected)
  }
}

function setSelectedCommandId(ui: RestUiState, commandId: number | null): void {
  if (commandId === null) {
    delete ui.root.dataset.selectedCommandId
  } else {
    ui.root.dataset.selectedCommandId = String(commandId)
  }
  applyRowMarkers(ui)
}

export function ensureUi(): RestUiState {
  const appRoot = document.getElementById('app')
  if (!appRoot) {
    throw new Error('Missing #app root')
  }

  const existing = document.getElementById('restapi-controls') as HTMLDivElement | null
  if (existing) {
    return {
      root: existing,
      commandTableBody: existing.querySelector('#restapi-command-table-body') as HTMLTableSectionElement,
      response: existing.querySelector('#restapi-response') as HTMLPreElement,
      urlInput: existing.querySelector('#restapi-url-input') as HTMLInputElement,
      nameInput: existing.querySelector('#restapi-name-input') as HTMLInputElement,
      tagsInput: existing.querySelector('#restapi-tags-input') as HTMLInputElement,
      tagsDatalist: existing.querySelector('#restapi-tags-suggestions') as HTMLDataListElement,
      addButton: existing.querySelector('#restapi-command-add') as HTMLButtonElement,
      tagFilterGroup: existing.querySelector('#restapi-tag-filter-group') as HTMLDivElement,
      exportButton: existing.querySelector('#restapi-export-button') as HTMLButtonElement,
      importFileInput: existing.querySelector('#restapi-import-file-input') as HTMLInputElement,
      importButton: existing.querySelector('#restapi-import-button') as HTMLButtonElement,
    }
  }

  const controls = document.createElement('div')
  controls.id = 'restapi-controls'
  controls.style.marginTop = '12px'

  const commandSection = document.createElement('div')
  commandSection.id = 'restapi-command-section'

  const commandSectionTitle = document.createElement('p')
  commandSectionTitle.id = 'restapi-command-title'
  commandSectionTitle.textContent = 'REST commands'
  commandSectionTitle.style.margin = '0 0 6px 0'

  const commandTableWrap = document.createElement('div')
  commandTableWrap.id = 'restapi-command-table-wrap'

  const commandTable = document.createElement('table')
  commandTable.id = 'restapi-command-table'

  const commandHead = document.createElement('thead')
  commandHead.innerHTML = '<tr><th>Name</th><th>Tags</th><th>URL</th><th>Remove</th></tr>'

  const commandTableBody = document.createElement('tbody')
  commandTableBody.id = 'restapi-command-table-body'

  commandTable.append(commandHead, commandTableBody)
  commandTableWrap.append(commandTable)
  commandSection.append(commandSectionTitle, commandTableWrap)

  const filterRow = document.createElement('div')
  filterRow.id = 'restapi-filter-row'
  filterRow.style.display = 'flex'
  filterRow.style.gap = '8px'
  filterRow.style.flexWrap = 'wrap'
  filterRow.style.alignItems = 'center'
  filterRow.style.marginTop = '8px'

  const tagFilterLabel = document.createElement('span')
  tagFilterLabel.textContent = 'Glasses tag filter:'

  const tagFilterGroup = document.createElement('div')
  tagFilterGroup.id = 'restapi-tag-filter-group'

  const inputRow = document.createElement('div')
  inputRow.id = 'restapi-add-input-row'
  inputRow.style.display = 'flex'
  inputRow.style.gap = '8px'
  inputRow.style.flexWrap = 'wrap'
  inputRow.style.alignItems = 'center'
  inputRow.style.marginTop = '6px'

  const addSection = document.createElement('div')
  addSection.id = 'restapi-add-command-section'
  addSection.style.marginTop = '10px'

  const addSectionTitle = document.createElement('p')
  addSectionTitle.id = 'restapi-add-command-title'
  addSectionTitle.textContent = 'Add new REST command'
  addSectionTitle.style.margin = '0'

  const urlInput = document.createElement('input')
  urlInput.id = 'restapi-url-input'
  urlInput.type = 'text'
  urlInput.placeholder = 'URL (required)'
  urlInput.style.minWidth = '320px'

  const nameInput = document.createElement('input')
  nameInput.id = 'restapi-name-input'
  nameInput.type = 'text'
  nameInput.placeholder = 'Name (optional, recommended)'
  nameInput.style.minWidth = '220px'

  const tagsInput = document.createElement('input')
  tagsInput.id = 'restapi-tags-input'
  tagsInput.type = 'text'
  tagsInput.placeholder = 'Tags (optional, comma-separated)'
  tagsInput.style.minWidth = '220px'
  tagsInput.setAttribute('list', 'restapi-tags-suggestions')

  const tagsDatalist = document.createElement('datalist')
  tagsDatalist.id = 'restapi-tags-suggestions'

  const addButton = document.createElement('button')
  addButton.id = 'restapi-command-add'
  addButton.type = 'button'
  addButton.textContent = 'Add Command'

  const importExportSection = document.createElement('div')
  importExportSection.id = 'restapi-import-export-section'

  const exportButton = document.createElement('button')
  exportButton.id = 'restapi-export-button'
  exportButton.type = 'button'
  exportButton.textContent = '⬇️ Export'

  const importFileInput = document.createElement('input')
  importFileInput.id = 'restapi-import-file-input'
  importFileInput.type = 'file'
  importFileInput.accept = '.json,application/json'

  const importButton = document.createElement('button')
  importButton.id = 'restapi-import-button'
  importButton.type = 'button'
  importButton.textContent = '⬆️ Import'

  const response = document.createElement('pre')
  response.id = 'restapi-response'
  response.style.marginTop = '10px'
  response.style.whiteSpace = 'pre-wrap'
  response.style.maxHeight = '320px'
  response.style.overflow = 'auto'
  response.style.border = '1px solid #aaa'
  response.style.padding = '8px'
  response.textContent = 'Response output will appear here.'

  filterRow.append(tagFilterLabel, tagFilterGroup)
  inputRow.append(nameInput, tagsInput, urlInput, addButton)
  addSection.append(addSectionTitle, inputRow)
  importExportSection.append(exportButton, importFileInput, importButton)
  controls.append(commandSection, filterRow, addSection, importExportSection, tagsDatalist, response)
  appRoot.append(controls)

  return {
    root: controls,
    commandTableBody,
    response,
    urlInput,
    nameInput,
    tagsInput,
    tagsDatalist,
    addButton,
    tagFilterGroup,
    exportButton,
    importFileInput,
    importButton,
  }
}

export function getSelectedCommandId(ui: RestUiState): number | null {
  return parseDatasetCommandId(ui.root.dataset.selectedCommandId)
}

export function getGlassSelectedCommandId(ui: RestUiState): number | null {
  return parseDatasetCommandId(ui.root.dataset.glassSelectedCommandId)
}

export function syncSelectedCommandById(ui: RestUiState, commandId: number): void {
  setSelectedCommandId(ui, commandId)
}

export function syncGlassSelectedCommandById(ui: RestUiState, commandId: number | null): void {
  if (commandId === null) {
    delete ui.root.dataset.glassSelectedCommandId
  } else {
    ui.root.dataset.glassSelectedCommandId = String(commandId)
  }
  applyRowMarkers(ui)
}

export function readCommandInput(ui: RestUiState): { url: string; name: string; tagsInput: string } {
  return {
    url: ui.urlInput.value.trim(),
    name: ui.nameInput.value.trim(),
    tagsInput: ui.tagsInput.value,
  }
}

export function clearCommandInput(ui: RestUiState): void {
  ui.urlInput.value = ''
  ui.nameInput.value = ''
  ui.tagsInput.value = ''
}

export function rebuildTagsAutocomplete(ui: RestUiState, tags: string[]): void {
  ui.tagsDatalist.innerHTML = ''
  for (const tag of tags) {
    const option = document.createElement('option')
    option.value = tag
    ui.tagsDatalist.append(option)
  }
}

export function rebuildCommandTable(
  ui: RestUiState,
  commands: RestCommand[],
  selectedCommandId?: number,
): void {
  const currentId = selectedCommandId ?? getSelectedCommandId(ui)
  ui.commandTableBody.innerHTML = ''

  if (commands.length === 0) {
    setSelectedCommandId(ui, null)

    const emptyRow = document.createElement('tr')
    const emptyCell = document.createElement('td')
    emptyCell.colSpan = 4
    emptyCell.textContent = 'No commands configured.'
    emptyCell.className = 'restapi-command-empty'
    emptyRow.append(emptyCell)
    ui.commandTableBody.append(emptyRow)
    return
  }

  const resolvedSelectedId = currentId && commands.some((command) => command.id === currentId)
    ? currentId
    : commands[0]?.id ?? null
  setSelectedCommandId(ui, resolvedSelectedId)

  for (const command of commands) {
    const row = document.createElement('tr')
    row.dataset.commandId = String(command.id)
    row.dataset.selectCommandId = String(command.id)

    const nameCell = document.createElement('td')
    nameCell.textContent = displayName(command)

    const tagsCell = document.createElement('td')
    tagsCell.textContent = command.tags.length > 0 ? command.tags.map((tag) => `#${tag}`).join(', ') : '-'

    const urlCell = document.createElement('td')
    urlCell.textContent = command.url

    const removeCell = document.createElement('td')
    const removeButton = document.createElement('button')
    removeButton.type = 'button'
    removeButton.className = 'restapi-row-remove'
    removeButton.dataset.removeCommandId = String(command.id)
    removeButton.textContent = 'Remove'
    removeCell.append(removeButton)

    row.append(nameCell, tagsCell, urlCell, removeCell)
    ui.commandTableBody.append(row)
  }

  applyRowMarkers(ui)
}

export function getActiveTagFilter(ui: RestUiState): string {
  return ui.root.dataset.activeTagFilter ?? TAG_ALL
}

function applyTagFilterButtonState(group: HTMLDivElement, activeTag: string): void {
  const buttons = group.querySelectorAll<HTMLButtonElement>('button[data-tag-filter]')
  for (const button of buttons) {
    const isActive = button.dataset.tagFilter === activeTag
    button.classList.toggle('restapi-tag-filter-active', isActive)
    button.setAttribute('aria-pressed', String(isActive))
  }
}

export function rebuildTagFilterSelect(
  ui: RestUiState,
  tags: string[],
  activeTag: string,
): void {
  ui.tagFilterGroup.innerHTML = ''
  const available = [TAG_ALL, ...tags]
  const resolvedActive = available.includes(activeTag) ? activeTag : TAG_ALL
  ui.root.dataset.activeTagFilter = resolvedActive

  const allButton = document.createElement('button')
  allButton.type = 'button'
  allButton.dataset.tagFilter = TAG_ALL
  allButton.textContent = 'All tags'
  ui.tagFilterGroup.append(allButton)

  for (const tag of tags) {
    const button = document.createElement('button')
    button.type = 'button'
    button.dataset.tagFilter = tag
    button.textContent = `#${tag}`
    ui.tagFilterGroup.append(button)
  }

  applyTagFilterButtonState(ui.tagFilterGroup, resolvedActive)
}

export function syncTagFilter(ui: RestUiState, tagFilter: string): void {
  const buttonExists = Array.from(ui.tagFilterGroup.querySelectorAll<HTMLButtonElement>('button[data-tag-filter]'))
    .some((button) => button.dataset.tagFilter === tagFilter)
  const resolvedTag = buttonExists ? tagFilter : TAG_ALL
  ui.root.dataset.activeTagFilter = resolvedTag
  applyTagFilterButtonState(ui.tagFilterGroup, resolvedTag)
}
