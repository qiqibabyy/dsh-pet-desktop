/**
 * Pet registry — discovers sprite2d pets and status decorations from Codex /
 * dsh-web style pet directories and resolves their frame-animated tracks.
 *
 * Discovery sources (later sources override earlier ones by pet id):
 *   1. <package>/assets/pets        (starter pets shipped with this plugin)
 *   2. ${CODEX_HOME:-~/.codex}/pets (native Codex desktop-pet directories)
 *   3. <DSH_HOME>/pets              (dsh user pets)
 *   4. configured extra directories (settings "petDirs")
 * Decorations are scanned from a `decorations/` subdirectory of every source.
 *
 * Manifest support: legacy flat (Codex hatch-pet shape, no petManifestVersion)
 * and v2 `sprite2d` blocks. Other renderers (live2d/frames2d) are skipped with
 * a warning — the desktop companion renders the 9-track sprite contract.
 *
 * @module @linxin666/dsh-pet-desktop/src/registry
 */

import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** The 9 animation rows, in fixed atlas order (Codex contract). */
export const ANIMATIONS = ['idle', 'running-right', 'running-left', 'waving', 'jumping', 'failed', 'waiting', 'running', 'review']
export const ROW_OF = Object.fromEntries(ANIMATIONS.map((a, i) => [a, i]))
export const PHASES = ['idle', 'waiting', 'thinking', 'tool', 'review', 'done', 'failed']

/** Per-row used frame counts when a manifest omits `frames`. */
export const DEFAULT_FRAME_COUNTS = [6, 8, 8, 4, 5, 8, 6, 6, 6]

/** Default per-track rhythm (the shared slow baseline every sprite2d pet plays). */
export const DEFAULT_TRACK_PATTERNS = {
  idle: { durations: [500, 500, 600, 500, 500, 600], loop: true },
  'running-right': { durations: [300, 300, 300, 300, 300, 300, 300, 400], loop: true },
  'running-left': { durations: [300, 300, 300, 300, 300, 300, 300, 400], loop: true },
  waving: { durations: [450, 450, 450, 450], loop: true },
  jumping: { durations: [400, 400, 400, 450, 450], loop: false, fallback: 'idle' },
  failed: { durations: [550, 550, 550, 600, 650, 700, 550, 550], loop: false, fallback: 'idle' },
  waiting: { durations: [550, 550, 600, 550, 550, 600], loop: true },
  running: { durations: [330, 330, 330, 330, 330, 400], loop: true },
  review: { durations: [650, 650, 650, 650, 650, 650], loop: true },
}

/** Activity phase → animation track (the visual state machine's mapping). */
export function animationForPhase(phase) {
  switch (phase) {
    case 'thinking': return 'running'
    case 'tool': return 'running-right'
    case 'review': return 'review'
    case 'waiting': return 'waiting'
    case 'done': return 'jumping'
    case 'failed': return 'failed'
    default: return 'idle'
  }
}

export function dshHome() {
  const raw = process.env.DSH_HOME
  if (!raw) return path.join(os.homedir(), '.dsh')
  const expanded = raw === '~' ? os.homedir() : raw.startsWith('~/') ? path.join(os.homedir(), raw.slice(2)) : raw
  return path.isAbsolute(expanded) ? expanded : path.resolve(process.cwd(), expanded)
}

const ID_RE = /^[a-z0-9][a-z0-9-]*$/
const SAFE_SEG_RE = /^[A-Za-z0-9._-]+$/

/** Safe relative asset path: no absolute, no backslash, no `..`, clean segments. */
function safeRelativePath(value) {
  if (typeof value !== 'string' || !value || path.isAbsolute(value) || value.includes('\\')) return undefined
  const segments = value.split('/')
  if (segments.some((s) => !SAFE_SEG_RE.test(s))) return undefined
  return segments.join('/')
}

const finite = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

/** Cycle/trim a duration array to exactly `n` entries. */
function fitDurations(source, n) {
  if (!Array.isArray(source) || !source.length) return Array.from({ length: n }, () => 200)
  return Array.from({ length: n }, (_, i) => Math.max(20, Math.round(clamp(finite(source[i % source.length], 200), 20, 2000))))
}

/**
 * Build the 9-track playback table from per-row frame counts + manifest track
 * overrides ({durations, loop, fallback}).
 */
export function buildTracks(rowCounts, overrides = {}) {
  const out = {}
  ANIMATIONS.forEach((name, row) => {
    const pattern = DEFAULT_TRACK_PATTERNS[name]
    const override = overrides && typeof overrides === 'object' ? overrides[name] : undefined
    const n = Math.max(1, Math.min(32, Math.round(clamp(finite(rowCounts[row], DEFAULT_FRAME_COUNTS[row] ?? 6), 1, 32))))
    const durations = fitDurations(Array.isArray(override?.durations) ? override.durations : pattern.durations, n)
    const fallback = ANIMATIONS.includes(override?.fallback) ? override.fallback : pattern.fallback
    out[name] = {
      frames: Array.from({ length: n }, (_, i) => i),
      durations,
      loop: typeof override?.loop === 'boolean' ? override.loop : pattern.loop,
      ...(fallback ? { fallback } : {}),
    }
  })
  return out
}

/** Validate + normalize one pet directory manifest into an internal entry. */
function readPetDir(dir) {
  const warnings = []
  let raw
  try {
    const file = path.join(dir, 'pet.json')
    if (!existsSync(file) || !statSync(file).isFile() || statSync(file).size > 64 * 1024) return { entry: undefined, warnings: [`missing or oversized pet.json in ${path.basename(dir)}`] }
    raw = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    return { entry: undefined, warnings: [`unparsable pet.json in ${dir}: ${error.message}`] }
  }
  if (!raw || typeof raw !== 'object') return { entry: undefined, warnings: [`bad manifest in ${dir}`] }

  const renderer = raw.renderer ?? 'sprite2d'
  if (renderer !== 'sprite2d') return { entry: undefined, skipped: true, warnings: [`renderer "${renderer}" not supported on desktop (${dir})`] }

  // v1 flat and v2 sprite2d both funnel into one shape here.
  const sprite2d = raw.petManifestVersion === 2 ? raw.sprite2d ?? {} : raw
  const id = typeof raw.id === 'string' && ID_RE.test(raw.id) ? raw.id : path.basename(dir).toLowerCase().replace(/[^a-z0-9-]/g, '-')
  if (!ID_RE.test(id)) return { entry: undefined, warnings: [`invalid pet id "${id}" in ${dir}`] }

  const sheet = safeRelativePath(sprite2d.spritesheetPath ?? 'spritesheet.webp') ?? 'spritesheet.webp'
  if (!existsSync(path.join(dir, sheet))) return { entry: undefined, warnings: [`spritesheet "${sheet}" missing in ${dir}`] }

  const cell = {
    width: Math.round(clamp(finite(sprite2d.cell?.width, 192), 16, 2048)),
    height: Math.round(clamp(finite(sprite2d.cell?.height, 208), 16, 2048)),
  }
  const columns = Math.round(clamp(finite(sprite2d.columns, 8), 1, 32))
  const versionTwo = finite(raw.spriteVersionNumber, 1) >= 2 || sprite2d.atlasRows === 11
  const atlasRows = versionTwo ? 11 : 9
  const rows = Array.isArray(sprite2d.frames) && sprite2d.frames.length >= 9
    ? DEFAULT_FRAME_COUNTS.map((d, i) => Math.round(clamp(finite(sprite2d.frames[i], d), 1, columns)))
    : [...DEFAULT_FRAME_COUNTS]

  const sequences = {}
  if (raw.sequences && typeof raw.sequences === 'object') {
    for (const [phase, tracks] of Object.entries(raw.sequences)) {
      if (!PHASES.includes(phase) || !Array.isArray(tracks)) continue
      const list = tracks.filter((t) => ANIMATIONS.includes(t))
      if (list.length) sequences[phase] = list
    }
  }

  const remarks = {}
  if (raw.remarks && typeof raw.remarks === 'object') {
    for (const kind of ['pet', 'petCooldown', 'feed', 'feedCooldown', 'noTreats']) {
      const pool = Array.isArray(raw.remarks[kind]) ? raw.remarks[kind].filter((l) => typeof l === 'string' && l.length && l.length <= 120).slice(0, 64) : undefined
      if (pool?.length) remarks[kind] = pool
    }
  }

  return {
    warnings,
    entry: {
      id,
      dir,
      displayName: (typeof raw.displayName === 'string' && raw.displayName.trim() ? raw.displayName : id).slice(0, 80),
      description: typeof raw.description === 'string' ? raw.description.slice(0, 500) : '',
      sheetFile: sheet,
      cell,
      columns,
      rows,
      atlasRows,
      tracks: buildTracks(rows, sprite2d.tracks),
      ...(Object.keys(sequences).length ? { sequences } : {}),
      ...(Object.keys(remarks).length ? { remarks } : {}),
      servable: new Set(['pet.json', sheet]),
    },
  }
}

/** Validate + normalize one decoration directory (decoration.json v1 contract). */
function readDecorationDir(dir) {
  try {
    const file = path.join(dir, 'decoration.json')
    if (!existsSync(file) || statSync(file).size > 64 * 1024) return undefined
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    const id = raw.id
    if (typeof id !== 'string' || !ID_RE.test(id)) return undefined
    const entry = safeRelativePath(raw.entry)
    if (!entry || !/\.(webp|png)$/i.test(entry) || !existsSync(path.join(dir, entry))) return undefined
    const cell = {
      width: Math.round(clamp(finite(raw.cell?.width, 64), 1, 256)),
      height: Math.round(clamp(finite(raw.cell?.height, 48), 1, 256)),
    }
    const columns = Math.round(clamp(finite(raw.columns, 4), 1, 16))
    const frameMs = clamp(finite(raw.frameMs, 160), 20, 2000)
    const durations = Array.isArray(raw.durations) && raw.durations.length
      ? raw.durations.slice(0, 64).map((d) => Math.round(clamp(finite(d, frameMs), 20, 2000)))
      : undefined
    const total = Math.max(columns, durations?.length ?? 0, 1)
    const phases = {}
    if (raw.phases && typeof raw.phases === 'object') {
      for (const [phase, bind] of Object.entries(raw.phases)) {
        if (!PHASES.includes(phase)) continue
        if (bind === 'hide') { phases[phase] = 'hide'; continue }
        const from = Math.round(clamp(finite(bind?.from, 0), 0, total - 1))
        const to = Math.round(clamp(finite(bind?.to, from), from, total - 1))
        phases[phase] = { from, to }
      }
    }
    if (!Object.keys(phases).length) return undefined
    return {
      id,
      dir,
      displayName: (typeof raw.displayName === 'string' && raw.displayName ? raw.displayName : id).slice(0, 80),
      entryFile: entry,
      cell,
      columns,
      durations: durations ?? Array.from({ length: total }, () => Math.round(frameMs)),
      loop: typeof raw.loop === 'boolean' ? raw.loop : true,
      phases,
      servable: new Set(['decoration.json', entry]),
    }
  } catch {
    return undefined
  }
}

function scanDirectory(root, onEntry) {
  if (!root || !existsSync(root)) return
  let names
  try { names = readdirSync(root) } catch { return }
  for (const name of names) {
    const dir = path.join(root, name)
    try { if (statSync(dir).isDirectory()) onEntry(dir) } catch { /* skip */ }
  }
}

/**
 * The pet + decoration registry. `load()` (re)scans all sources; views are
 * plain JSON-safe shapes for the companion and the settings card.
 */
export class PetRegistry {
  constructor(extraDirs = []) {
    this.extraDirs = extraDirs
    this.pets = new Map()
    this.decorations = new Map()
    this.diagnostics = []
  }

  sources() {
    const codexHome = process.env.CODEX_HOME ? (process.env.CODEX_HOME === '~' ? os.homedir() : process.env.CODEX_HOME) : path.join(os.homedir(), '.codex')
    return [
      path.join(PKG_DIR, 'assets', 'pets'),
      path.join(codexHome, 'pets'),
      path.join(dshHome(), 'pets'),
      ...this.extraDirs,
    ]
  }

  load() {
    this.pets = new Map()
    this.decorations = new Map()
    this.diagnostics = []
    for (const root of this.sources()) {
      scanDirectory(root, (dir) => {
        if (dir.endsWith('.runtime') || dir.endsWith('.voice.json')) return
        const { entry, warnings, skipped } = readPetDir(dir)
        for (const message of warnings ?? []) {
          this.diagnostics.push({ level: skipped ? 'warning' : 'warning', source: path.basename(dir), message })
        }
        if (!entry) return
        if (this.pets.has(entry.id)) this.diagnostics.push({ level: 'warning', source: entry.id, message: `overridden by ${dir}` })
        this.pets.set(entry.id, entry)
      })
      scanDirectory(path.join(root, 'decorations'), (dir) => {
        const deco = readDecorationDir(dir)
        if (deco) this.decorations.set(deco.id, deco)
      })
      // Sibling layout (<pkg>/assets/pets + <pkg>/assets/decorations) too.
      scanDirectory(path.join(root, '..', 'decorations'), (dir) => {
        const deco = readDecorationDir(dir)
        if (deco) this.decorations.set(deco.id, deco)
      })
    }
    return this
  }

  getPet(id) {
    return this.pets.get(id) ?? this.pets.values().next().value
  }

  getDecoration(id) {
    if (id === '' || id === 'none') return undefined
    return this.decorations.get(id) ?? (this.decorations.has('whale') && id == null ? this.decorations.get('whale') : undefined)
  }

  defaultPetId() {
    return this.pets.size ? this.pets.values().next().value.id : undefined
  }

  defaultDecorationId() {
    return this.decorations.has('whale') ? 'whale' : this.decorations.keys().next().value
  }

  /** Browser-facing definition (the companion consumes this verbatim). */
  petView(entry) {
    return {
      id: entry.id,
      displayName: entry.displayName,
      description: entry.description,
      renderer: 'sprite2d',
      cell: entry.cell,
      columns: entry.columns,
      rows: entry.rows,
      atlasRows: entry.atlasRows,
      tracks: entry.tracks,
      ...(entry.sequences ? { sequences: entry.sequences } : {}),
      ...(entry.remarks ? { remarks: entry.remarks } : {}),
      atlasUrl: `/desktop-pet-assets/${entry.id}/${entry.sheetFile}`,
      manifestUrl: `/desktop-pet-assets/${entry.id}/pet.json`,
    }
  }

  /** Browser-facing decoration descriptor (fields match the companion ornament renderer). */
  decorationView(deco) {
    return {
      id: deco.id,
      displayName: deco.displayName,
      entryUrl: `/desktop-pet-assets/decorations/${deco.id}/${deco.entryFile}`,
      cell: deco.cell,
      columns: deco.columns,
      durations: deco.durations,
      loop: deco.loop,
      phases: deco.phases,
    }
  }

  /** Resolve a served asset to an absolute file, or undefined (allow-list + containment). */
  resolveAsset(kind, id, file) {
    const holder = kind === 'decoration' ? this.decorations.get(id) : this.pets.get(id)
    if (!holder) return undefined
    const clean = safeRelativePath(file)
    if (!clean || !holder.servable.has(clean)) return undefined
    const candidate = path.join(holder.dir, clean)
    try {
      if (!statSync(candidate).isFile()) return undefined
      if (realpathSync(candidate) !== path.join(realpathSync(holder.dir), clean)) return undefined
      if (statSync(candidate).size > 32 * 1024 * 1024) return undefined
      return candidate
    } catch {
      return undefined
    }
  }
}
