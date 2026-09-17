/**
 * Desktop pet service — the standalone state machine: affinity/treats ledger,
 * per-session activity projection from harness events, bubble/whisper copy
 * selection, and the pollable state view the companion window renders.
 *
 * Formulas ported 1:1 from the dsh-pet family (docs/PET-SPEC.md §1-2):
 * pet +1 (10 s cooldown), feed +5 (30 s cooldown, consumes 1 treat), completed
 * turn +1 (idempotent per session+turn); treats +1 per 30 turns and +1 per 5 h,
 * capped at 20, settled lazily on economic events (never on read, never timers);
 * affinity never decays. done/failed animations settle back to idle after 2400 ms.
 *
 * State lives in <DSH_HOME>/desktop-pet.json — independent of the web pet's
 * pet.json, so both plugins can coexist without sharing a ledger.
 *
 * @module @qiqibabyy/dsh-pet-desktop/src/service
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { animationForPhase, dshHome, PHASES } from './registry.js'
import {
  BUILTIN_REMARKS,
  WHISPER_TTL_MS,
  StatusVoice,
  WhisperEngine,
  countedRemark,
  displayToolName,
  looksLikeTestTool,
  toolArgHint,
  toolCategory,
  whisperCategoryOf,
} from './chatter.js'

export const AFFINITY_MAX = 999_999_999
export const RANKS = [
  { min: 0, name: '幼鲸', emoji: '*' },
  { min: 25, name: '伙伴', emoji: '**' },
  { min: 50, name: '挚友', emoji: '***' },
  { min: 80, name: '深海羁绊', emoji: '****' },
  { min: 200, name: '心有灵犀', emoji: '*****' },
  { min: 500, name: '传说羁绊', emoji: '******' },
  { min: 2000, name: '神话羁绊', emoji: '*******' },
  { min: 10000, name: '永恒之契', emoji: '********' },
  { min: 100000, name: '鲸生共渡', emoji: '*********' },
]
export function rankOf(points) {
  let rank = RANKS[0]
  for (const tier of RANKS) if (tier.min <= points) rank = tier
  return rank
}

const AFFINITY_CONFIG = { turnReward: 1, petReward: 1, petCooldownMs: 10_000, feedReward: 5, feedCooldownMs: 30_000 }
const TREAT_CONFIG = { turnsPerTreat: 30, timeTreatMs: 300 * 60_000, maxTreats: 20 }
const CELEBRATE_MS = 2400
const FAILURE_MS = 2400
const MAX_SESSION_BUBBLES = 12

const finite = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

function emptyPersist() {
  return {
    petId: '',
    names: {},
    decorationId: '',
    affinity: { points: 0, lastPetAt: 0, lastFeedAt: 0, pets: 0, feeds: 0, petRejects: 0, feedRejects: 0, turns: 0 },
    treats: { treats: 0, lastTreatGrantAt: 0, turnsAtLastTreatGrant: 0 },
    display: { visible: true, size: 160, right: 24, bottom: 120, bubbleScale: 1 },
  }
}

/** Read + clamp the persisted file; any failure yields defaults (never crashes). */
function loadPersist(file) {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    const base = emptyPersist()
    const a = raw.affinity ?? {}
    const t = raw.treats ?? {}
    const d = raw.display ?? {}
    const big = clamp(finite(a.points, 0), 0, AFFINITY_MAX)
    const names = {}
    if (raw.names && typeof raw.names === 'object') {
      for (const [k, v] of Object.entries(raw.names)) if (typeof v === 'string' && v.trim()) names[String(k).slice(0, 80)] = v.trim().slice(0, 20)
    }
    return {
      petId: typeof raw.petId === 'string' ? raw.petId.slice(0, 80) : '',
      names,
      decorationId: typeof raw.decorationId === 'string' ? raw.decorationId.slice(0, 80) : '',
      affinity: {
        points: Math.round(big),
        lastPetAt: clamp(finite(a.lastPetAt, 0), 0, Number.MAX_SAFE_INTEGER),
        lastFeedAt: clamp(finite(a.lastFeedAt, 0), 0, Number.MAX_SAFE_INTEGER),
        pets: Math.round(clamp(finite(a.pets, 0), 0, Number.MAX_SAFE_INTEGER)),
        feeds: Math.round(clamp(finite(a.feeds, 0), 0, Number.MAX_SAFE_INTEGER)),
        petRejects: Math.round(clamp(finite(a.petRejects, 0), 0, Number.MAX_SAFE_INTEGER)),
        feedRejects: Math.round(clamp(finite(a.feedRejects, 0), 0, Number.MAX_SAFE_INTEGER)),
        turns: Math.round(clamp(finite(a.turns, 0), 0, Number.MAX_SAFE_INTEGER)),
      },
      treats: {
        treats: Math.round(clamp(finite(t.treats, 0), 0, TREAT_CONFIG.maxTreats)),
        lastTreatGrantAt: clamp(finite(t.lastTreatGrantAt, 0), 0, Number.MAX_SAFE_INTEGER),
        turnsAtLastTreatGrant: clamp(finite(t.turnsAtLastTreatGrant, 0), 0, Number.MAX_SAFE_INTEGER),
      },
      display: {
        visible: d.visible !== false,
        size: Math.round(clamp(finite(d.size, 160), 32, 1024)),
        right: Math.round(clamp(finite(d.right, 24), 0, 10000)),
        bottom: Math.round(clamp(finite(d.bottom, 120), 0, 10000)),
        bubbleScale: clamp(finite(d.bubbleScale, 1), 0.5, 2),
      },
    }
  } catch {
    return emptyPersist()
  }
}

/** One session's activity record + its render() (settle windows, bubble precedence). */
class SessionActivity {
  constructor() {
    this.phase = 'idle'
    this.line = undefined
    this.phrase = undefined
    this.whisper = undefined // {text, at}
    this.doneAt = 0
    this.failedAt = 0
    this.activeTools = new Set()
    this.testCalls = new Set()
    this.stepHadFailure = false
  }

  setInput({ phase, line, phrase }) {
    this.phase = PHASES.includes(phase) ? phase : 'idle'
    this.line = line
    this.phrase = phrase
    if (this.phase === 'done') this.doneAt = Date.now()
    else if (this.phase === 'failed') this.failedAt = Date.now()
    else { this.doneAt = 0; this.failedAt = 0 }
  }

  render(now) {
    let animation = animationForPhase(this.phase)
    let settled = this.phase === 'idle'
    if (this.phase === 'done' && now - this.doneAt > CELEBRATE_MS) { animation = 'idle'; settled = true }
    if (this.phase === 'failed' && now - this.failedAt > FAILURE_MS) { animation = 'idle'; settled = true }
    return {
      animation,
      phase: this.phase,
      bubble: settled ? undefined : (this.phrase ?? this.line),
      whisper: this.whisper && now - this.whisper.at < WHISPER_TTL_MS ? this.whisper.text : undefined,
    }
  }
}

/** Affinity + treats ledger over one persisted file; verbs flush once, reads never write. */
export class PetLedger {
  constructor(file) {
    this.file = file
    this.state = loadPersist(file)
    this.turnKeys = new Map() // sessionId -> Set<turn>
  }

  save() {
    try {
      mkdirSync(path.dirname(this.file), { recursive: true })
      const tmp = this.file + '.tmp'
      writeFileSync(tmp, JSON.stringify(this.state, null, 2))
      renameSync(tmp, this.file)
    } catch { /* persistence is best effort; the in-memory ledger keeps running */ }
  }

  affinityView(now = Date.now()) {
    const a = this.state.affinity
    const rank = rankOf(a.points)
    return {
      points: a.points,
      rank: rank.name,
      rankEmoji: rank.emoji,
      pets: a.pets,
      feeds: a.feeds,
      turns: a.turns,
      petCooldown: a.lastPetAt !== 0 && now - a.lastPetAt < AFFINITY_CONFIG.petCooldownMs,
      feedCooldown: a.lastFeedAt !== 0 && now - a.lastFeedAt < AFFINITY_CONFIG.feedCooldownMs,
    }
  }

  settleTreats(now = Date.now()) {
    const a = this.state.affinity
    const t = this.state.treats
    if (!t.lastTreatGrantAt) { t.lastTreatGrantAt = now; t.turnsAtLastTreatGrant = a.turns; return }
    let changed = false
    const turnGrants = Math.floor((a.turns - t.turnsAtLastTreatGrant) / TREAT_CONFIG.turnsPerTreat)
    const timeGrants = Math.floor((now - t.lastTreatGrantAt) / TREAT_CONFIG.timeTreatMs)
    if (turnGrants > 0 || timeGrants > 0) {
      t.treats = Math.min(TREAT_CONFIG.maxTreats, t.treats + Math.max(0, turnGrants) + Math.max(0, timeGrants))
      if (turnGrants > 0) t.turnsAtLastTreatGrant += turnGrants * TREAT_CONFIG.turnsPerTreat
      if (timeGrants > 0) t.lastTreatGrantAt += timeGrants * TREAT_CONFIG.timeTreatMs
      changed = true
    }
    if (changed) this.save()
  }

  treatView() {
    return { stocked: this.state.treats.treats, max: TREAT_CONFIG.maxTreats }
  }

  interactPet(remarks, now = Date.now()) {
    const a = this.state.affinity
    if (a.lastPetAt !== 0 && now - a.lastPetAt < AFFINITY_CONFIG.petCooldownMs) {
      a.petRejects += 1
      this.save()
      return { reaction: countedRemark(remarks?.petCooldown ?? BUILTIN_REMARKS.petCooldown, a.petRejects), delta: 0, affinity: this.affinityView(now) }
    }
    a.points = clamp(a.points + AFFINITY_CONFIG.petReward, 0, AFFINITY_MAX)
    a.pets += 1
    a.lastPetAt = now
    this.save()
    return { reaction: countedRemark(remarks?.pet ?? BUILTIN_REMARKS.pet, a.pets), delta: AFFINITY_CONFIG.petReward, affinity: this.affinityView(now) }
  }

  interactFeed(remarks, now = Date.now()) {
    this.settleTreats(now)
    const a = this.state.affinity
    const t = this.state.treats
    if (a.lastFeedAt !== 0 && now - a.lastFeedAt < AFFINITY_CONFIG.feedCooldownMs) {
      a.feedRejects += 1
      this.save()
      return { reaction: countedRemark(remarks?.feedCooldown ?? BUILTIN_REMARKS.feedCooldown, a.feedRejects), delta: 0, affinity: this.affinityView(now) }
    }
    if (t.treats < 1) {
      a.feedRejects += 1
      this.save()
      return { reaction: countedRemark(remarks?.noTreats ?? BUILTIN_REMARKS.noTreats, a.feedRejects), delta: 0, affinity: this.affinityView(now) }
    }
    t.treats -= 1
    a.points = clamp(a.points + AFFINITY_CONFIG.feedReward, 0, AFFINITY_MAX)
    a.feeds += 1
    a.lastFeedAt = now
    this.save()
    return { reaction: countedRemark(remarks?.feed ?? BUILTIN_REMARKS.feed, a.feeds), delta: AFFINITY_CONFIG.feedReward, affinity: this.affinityView(now) }
  }

  /** Idempotent per (sessionId, turn): first sighting rewards. */
  turnReward(sessionId, turn, now = Date.now()) {
    const key = `${sessionId}:${turn}`
    let set = this.turnKeys.get(sessionId)
    if (!set) { set = new Set(); this.turnKeys.set(sessionId, set) }
    if (set.has(key)) return false
    set.add(key)
    const a = this.state.affinity
    a.turns += 1
    a.points = clamp(a.points + AFFINITY_CONFIG.turnReward, 0, AFFINITY_MAX)
    this.save()
    return true
  }

  forgetSession(sessionId) {
    this.turnKeys.delete(sessionId)
  }
}

/**
 * The cordis-facing service: subscribes to harness session events, feeds the
 * per-session state machines, and answers the companion/settings verbs. The
 * view build is pure (no persistence, no timers); the 2 s companion poll is
 * the only clock driver.
 */
export class DesktopPetService {
  constructor({ registry, file = path.join(dshHome(), 'desktop-pet.json') }) {
    this.registry = registry
    this.ledger = new PetLedger(file)
    this.sessions = new Map() // sessionId -> {sid, act, lastAt} — insertion order = recency (tail newest)
    this.voice = new StatusVoice()
    this.whispers = new WhisperEngine()
    this.announcement = undefined
    this.mirrored = undefined
    this.enabled = true
  }

  actOf(sid) {
    let record = this.sessions.get(sid)
    if (record) {
      // Move to tail (recency) without rebuilding the Map.
      this.sessions.delete(sid)
      this.sessions.set(sid, record)
      return record
    }
    record = { sid, act: new SessionActivity() }
    this.sessions.set(sid, record)
    while (this.sessions.size > MAX_SESSION_BUBBLES) this.sessions.delete(this.sessions.keys().next().value)
    return record
  }

  commit(sid, input) {
    if (!this.enabled) return
    const { act } = this.actOf(sid)
    act.setInput(input)
  }

  whisper(sid, text) {
    if (!text || !this.enabled) return
    const { act } = this.actOf(sid)
    act.whisper = { text, at: Date.now() }
  }

  /** Wire harness events into the state machines (spec §2.3, minus legacy paths). */
  attach(ctx) {
    const official = new WeakSet()

    ctx.on('session/event', (session, event) => {
      if (!this.enabled || !session || !event || typeof event.type !== 'string') return
      const sid = String(session.id ?? '')
      if (!sid) return
      official.add(session)
      const type = event.type
      const data = event.data ?? {}
      switch (type) {
        case 'turn/start': {
          const { act } = this.actOf(sid)
          act.activeTools.clear(); act.testCalls.clear(); act.stepHadFailure = false
          this.commit(sid, { phase: 'waiting', line: this.voice.line('prepare') })
          break
        }
        case 'step/start': {
          const { act } = this.actOf(sid)
          act.activeTools.clear(); act.stepHadFailure = false
          this.commit(sid, { phase: 'waiting', line: this.voice.line('waiting') })
          break
        }
        case 'assistant/message':
          this.commit(sid, { phase: 'review', line: this.voice.line('review') })
          break
        case 'tool/call': {
          const name = typeof data.name === 'string' ? data.name : 'tool'
          const family = toolCategory(name)
          const hint = toolArgHint(family, data.arguments)
          const { act } = this.actOf(sid)
          if (typeof data.callId === 'string') act.activeTools.add(data.callId)
          if (looksLikeTestTool(name, data.arguments) && typeof data.callId === 'string') act.testCalls.add(data.callId)
          this.commit(sid, { phase: 'tool', line: this.voice.toolLine(family, displayToolName(name), hint) })
          this.whisper(sid, this.whispers.feed(whisperCategoryOf(family) ?? 'generic'))
          break
        }
        case 'tool/result': {
          const isError = data.message?.content?.[0]?.isError === true || data.error
          const { act } = this.actOf(sid)
          const callId = data.message?.source?.callId ?? data.callId
          if (typeof callId === 'string') act.activeTools.delete(callId)
          const wasTest = typeof callId === 'string' && act.testCalls.has(callId)
          if (typeof callId === 'string') act.testCalls.delete(callId)
          if (isError) act.stepHadFailure = true
          const remaining = act.activeTools.size
          if (remaining > 0) {
            this.commit(sid, { phase: 'tool', line: this.voice.remaining(remaining) })
          } else if (act.stepHadFailure) {
            this.commit(sid, { phase: 'failed', line: this.voice.line('toolFailed') })
            this.whisper(sid, this.whispers.result('fail'))
          } else {
            this.commit(sid, { phase: 'thinking', line: this.voice.line('toolResult') })
            if (wasTest) this.whisper(sid, this.whispers.result('pass'))
          }
          break
        }
        case 'turn/end': {
          const reason = data.reason?.kind ?? (typeof data.reason === 'string' ? data.reason : '')
          const { act } = this.actOf(sid)
          act.activeTools.clear()
          if (reason === 'completed') {
            this.commit(sid, { phase: 'done', line: this.voice.line('done') })
            if (typeof data.turn === 'number') this.ledger.turnReward(sid, data.turn)
            this.whisper(sid, this.whispers.result('done'))
          } else if (reason === 'error') {
            this.commit(sid, { phase: 'failed', line: this.voice.line('failed') })
            this.whisper(sid, this.whispers.result('fail'))
          } else if (reason === 'max-tokens') {
            this.commit(sid, { phase: 'failed', line: this.voice.line('maxTokens') })
          } else if (reason === 'interrupted') {
            this.commit(sid, { phase: 'failed', line: this.voice.line('interrupted') })
          } else if (reason === 'blocked') {
            this.commit(sid, { phase: 'waiting', line: this.voice.line('blocked') })
          } else {
            this.commit(sid, { phase: 'idle' })
          }
          break
        }
        default:
          break
      }
    })

    ctx.on('agent/assistant-stream', ({ agent, frame }) => {
      if (!this.enabled || !agent || frame?.type !== 'chunk') return
      const sid = String(agent.id ?? agent.sessionId ?? '')
      if (!sid) return
      const chunk = frame.chunk ?? frame.data ?? {}
      const text = typeof chunk.text === 'string' ? chunk.text : typeof chunk.delta === 'string' ? chunk.delta : ''
      if (chunk.type === 'reasoning-delta' && text) {
        this.commit(sid, { phase: 'thinking', line: this.voice.line('thinking') })
        this.whisper(sid, this.whispers.feed('thinking'))
      } else if (chunk.type === 'text-delta' && text) {
        this.commit(sid, { phase: 'review', line: this.voice.line('review') })
        this.whisper(sid, this.whispers.feed('writing'))
      }
    })

    ctx.on('session/disposed', (session) => {
      const sid = String(session?.id ?? '')
      if (!sid) return
      this.sessions.delete(sid)
      this.ledger.forgetSession(sid)
    })

    return () => { this.enabled = false }
  }

  selectedPet() {
    return this.registry.getPet(this.ledger.state.petId)
  }

  selectedDecoration() {
    const decoId = this.ledger.state.decorationId
    return decoId ? this.registry.decorations.get(decoId) : this.registry.getDecoration(this.registry.defaultDecorationId())
  }

  buildView(now = Date.now(), currentSid) {
    const led = this.ledger
    const pet = this.selectedPet()
    const entries = [...this.sessions.values()]
    let ordered = entries
    if (currentSid) {
      const lead = entries.find((e) => e.sid === String(currentSid))
      if (lead) ordered = [lead, ...entries.filter((e) => e !== lead)]
    } else {
      ordered = entries.reverse() // tail = most recent first
    }
    const sessions = ordered.map((e) => {
      const r = e.act.render(now)
      return { sessionId: e.sid, animation: r.animation, phase: r.phase, ...(r.bubble ? { bubble: r.bubble } : {}), ...(r.whisper ? { whisper: r.whisper } : {}) }
    })
    const lead = sessions[0]
    const announcement = this.announcement && now - this.announcement.at < this.announcement.ttlMs ? this.announcement : (this.mirrored && now - this.mirrored.at < this.mirrored.ttlMs ? this.mirrored : undefined)
    return {
      animation: lead?.animation ?? 'idle',
      phase: lead?.phase ?? 'idle',
      sessionActive: !!lead && lead.phase !== 'idle',
      ...(lead?.bubble ? { bubble: lead.bubble } : {}),
      ...(sessions.length ? { sessions } : {}),
      ...(announcement ? { announcement } : {}),
      affinity: led.affinityView(now),
      treats: led.treatView(),
      display: led.state.display,
      pet: pet ? { id: pet.id, displayName: pet.displayName, description: pet.description } : { id: '', displayName: '待领养', description: '把 Codex 宠物目录放进 ~/.codex/pets 或设置「宠物目录」' },
      name: (pet && led.state.names[pet.id]) || pet?.displayName || '桌宠',
      ...(this.selectedDecoration() ? { decoration: this.registry.decorationView(this.selectedDecoration()) } : {}),
    }
  }

  petsView() {
    return [...this.registry.pets.values()].map((entry) => this.registry.petView(entry))
  }

  decorationsView() {
    return [...this.registry.decorations.values()].map((deco) => this.registry.decorationView(deco))
  }

  setPet(id) {
    if (!this.registry.pets.has(id)) return { ok: false, error: 'unknown-pet' }
    this.ledger.state.petId = id
    this.ledger.save()
    return { ok: true, petId: id }
  }

  setDecoration(id) {
    if (id && id !== 'none' && !this.registry.decorations.has(id)) return { ok: false, error: 'unknown-decoration' }
    this.ledger.state.decorationId = id === 'none' ? '' : id
    this.ledger.save()
    return { ok: true, decorationId: id }
  }

  setName(name) {
    const clean = typeof name === 'string' ? name.trim() : ''
    if (!clean) return { ok: false, error: 'name-empty' }
    if (clean.length > 20) return { ok: false, error: 'name-too-long' }
    const pet = this.selectedPet()
    if (!pet) return { ok: false, error: 'no-pet' }
    this.ledger.state.names[pet.id] = clean
    this.ledger.save()
    return { ok: true, name: clean }
  }

  setDisplay(patch) {
    const d = this.ledger.state.display
    if (typeof patch.visible === 'boolean') d.visible = patch.visible
    if (Number.isFinite(patch.size)) d.size = Math.round(clamp(patch.size, 32, 1024))
    if (Number.isFinite(patch.right)) d.right = Math.round(clamp(patch.right, 0, 10000))
    if (Number.isFinite(patch.bottom)) d.bottom = Math.round(clamp(patch.bottom, 0, 10000))
    if (Number.isFinite(patch.bubbleScale)) d.bubbleScale = clamp(patch.bubbleScale, 0.5, 2)
    this.ledger.save()
    return { ok: true, display: d }
  }

  announce(raw) {
    const a = raw && typeof raw === 'object' ? raw : {}
    const kind = ['balance', 'cost', 'plan'].includes(a.kind) ? a.kind : undefined
    const title = typeof a.title === 'string' ? a.title.slice(0, 80) : ''
    if (!kind || !title) return { ok: false, error: 'invalid-announcement' }
    const entry = {
      source: typeof a.source === 'string' ? a.source.slice(0, 64) : 'unknown',
      kind,
      title,
      ...(typeof a.amount === 'string' ? { amount: a.amount.slice(0, 120) } : {}),
      ...(Number.isFinite(a.percent) ? { percent: clamp(a.percent, 0, 100) } : {}),
      ...(typeof a.note === 'string' ? { note: a.note.slice(0, 120) } : {}),
      ...(typeof a.resetAt === 'string' ? { resetAt: a.resetAt.slice(0, 40) } : {}),
      tone: ['ok', 'warn', 'low'].includes(a.tone) ? a.tone : 'ok',
      ttlMs: clamp(finite(a.ttlMs, 10_000), 1000, 2 * 60 * 60_000),
      at: Date.now(),
    }
    this.announcement = entry
    return { ok: true }
  }
}
