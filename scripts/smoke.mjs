/**
 * Host-free smoke test: node scripts/smoke.mjs
 * Covers registry discovery/track building/asset containment, the affinity &
 * treats ledger rules, the event-projected state view, and the chatter engine.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PetRegistry, buildTracks, animationForPhase, DEFAULT_FRAME_COUNTS } from '../src/registry.js'
import { DesktopPetService, PetLedger, rankOf, AFFINITY_MAX } from '../src/service.js'
import { StatusVoice, WhisperEngine, toolCategory, whisperCategoryOf, displayToolName, toolArgHint, looksLikeTestTool, countedRemark, BUILTIN_REMARKS } from '../src/chatter.js'

const t0 = Date.now()
const tmp = mkdtempSync(path.join(os.tmpdir(), 'dsh-pet-smoke-'))
try {
  /* ---------- fixtures: one Codex v1 pet + one decoration ---------- */
  const root = path.join(tmp, 'pets')
  const petDir = path.join(root, 'test-pet')
  mkdirSync(petDir, { recursive: true })
  writeFileSync(path.join(petDir, 'pet.json'), JSON.stringify({
    id: 'test-pet', displayName: '测试宠物', spriteVersionNumber: 2, spritesheetPath: 'spritesheet.webp',
    tracks: { idle: { durations: [120] }, jumping: { loop: true } },
    sequences: { done: ['jumping', 'waving', 'idle'] },
    remarks: { pet: ['喵！'] },
  }))
  writeFileSync(path.join(petDir, 'spritesheet.webp'), Buffer.from('RIFFfakewebpdata'))
  const decoDir = path.join(root, 'decorations', 'test-deco')
  mkdirSync(decoDir, { recursive: true })
  writeFileSync(path.join(decoDir, 'decoration.json'), JSON.stringify({
    decorationManifestVersion: 1, id: 'test-deco', displayName: '测试装饰', entry: 'frames.png',
    cell: { width: 64, height: 48 }, columns: 4, frameMs: 160, loop: true,
    phases: { idle: 'hide', thinking: { from: 0, to: 3 } },
  }))
  writeFileSync(path.join(decoDir, 'frames.png'), Buffer.from('PNGfaketry'))

  const registry = new PetRegistry([root]).load()
  const entry = registry.pets.get('test-pet')
  assert.ok(entry, 'pet discovered')
  assert.equal(entry.atlasRows, 11, 'spriteVersionNumber:2 -> 11 rows')
  assert.deepEqual(entry.rows, DEFAULT_FRAME_COUNTS, 'default frame counts')
  assert.equal(entry.tracks.idle.frames.length, 6)
  assert.deepEqual(entry.tracks.idle.durations.slice(0, 6), [120, 120, 120, 120, 120, 120], 'durations cycled to frame count')
  assert.equal(entry.tracks.jumping.loop, true, 'manifest track override')
  assert.deepEqual(entry.sequences.done, ['jumping', 'waving', 'idle'])
  const def = registry.petView(entry)
  assert.equal(def.atlasUrl, '/desktop-pet-assets/test-pet/spritesheet.webp')
  assert.ok(registry.resolveAsset('pet', 'test-pet', 'spritesheet.webp'), 'servable sheet')
  assert.equal(registry.resolveAsset('pet', 'test-pet', '../../../etc/passwd'), undefined, 'traversal blocked')
  assert.equal(registry.resolveAsset('pet', 'test-pet', 'random.txt'), undefined, 'allow-list enforced')
  const deco = registry.decorations.get('test-deco')
  assert.ok(deco, 'decoration discovered')
  assert.equal(deco.durations.length, 4)
  assert.equal(deco.phases.idle, 'hide')
  assert.ok(registry.petView(entry).tracks.review.durations.every((d) => d === 650), 'default patterns for untouched tracks')

  /* ---------- ledger rules ---------- */
  const file = path.join(tmp, 'desktop-pet.json')
  const led = new PetLedger(file)
  let r = led.interactPet(undefined, t0)
  assert.equal(r.delta, 1, 'first pet lands (+1)')
  r = led.interactPet(undefined, t0 + 5000)
  assert.equal(r.delta, 0, 'pet cooldown reject at 5s')
  r = led.interactPet(undefined, t0 + 11_000)
  assert.equal(r.delta, 1, 'pet lands at 11s')
  r = led.interactFeed(undefined, t0 + 12_000)
  assert.match(r.reaction, /.+/, 'feed without treats gives a noTreats reaction')
  assert.equal(r.delta, 0)
  led.state.treats.treats = 3
  r = led.interactFeed(undefined, t0 + 12_000)
  assert.equal(r.delta, 5, 'feed +5 with treats')
  assert.equal(led.state.treats.treats, 2)
  // treats settle: +1 per 30 turns (fresh grant anchor)
  led.state.affinity.turns = led.state.treats.turnsAtLastTreatGrant + 30
  led.settleTreats(t0 + 13_000)
  assert.equal(led.state.treats.treats, 3, 'turn grant +1')
  assert.equal(led.state.treats.treats, Math.min(20, led.state.treats.treats), 'cap respected')
  // idempotent turn reward per (session, turn)
  assert.equal(led.turnReward('s1', 7), true)
  assert.equal(led.turnReward('s1', 7), false, 'same turn not double-paid')
  assert.equal(led.turnReward('s1', 8), true)
  led.forgetSession('s1')
  assert.equal(led.turnReward('s1', 7), true, 'forgotten session can re-pay')
  assert.equal(rankOf(0).name, '幼鲸')
  assert.equal(rankOf(79).name, '挚友')
  assert.equal(rankOf(80).name, '深海羁绊')
  assert.equal(rankOf(200).name, '心有灵犀')
  assert.equal(rankOf(AFFINITY_MAX).name, '鲸生共渡')
  // persisted + reload clamps
  led.state.affinity.points = 12345
  led.save()
  assert.equal(new PetLedger(file).state.affinity.points, 12345, 'roundtrip')
  // daily token bucket: fold / total / local-day rollover / persistence
  const usageFile = path.join(tmp, 'usage.json')
  const led2 = new PetLedger(usageFile)
  led2.foldUsage({ inputTokens: 100, outputTokens: 50, cacheReadTokens: 25 }, Date.parse('2026-01-01T10:00:00'))
  led2.foldUsage({ inputTokens: 10, outputTokens: 5 }, Date.parse('2026-01-01T11:00:00'))
  assert.deepEqual(led2.usageView(), { day: '2026-01-01', total: 190, input: 110, output: 55, cacheRead: 25, cacheWrite: 0, calls: 2 }, 'usage folds with totals')
  led2.foldUsage({ inputTokens: 7 }, Date.parse('2026-01-02T09:00:00'))
  assert.equal(led2.usageView().total, 7, 'local-day rollover zeroes the bucket')
  assert.equal(new PetLedger(usageFile).usageView().calls, 1, 'usage persists across reload')

  /* ---------- chatter engine ---------- */
  assert.ok(BUILTIN_REMARKS.pet.length >= 8, 'remark pools ported')
  assert.equal(countedRemark(['a', 'b'], 3), 'b', 'count round-robin')
  assert.equal(toolCategory('bash'), 'shell')
  assert.equal(toolCategory('pwsh'), 'generic', 'source regex: pwsh falls to generic (parity with web copy)')
  assert.equal(whisperCategoryOf('shell'), 'running')
  assert.equal(displayToolName('some_very_long_tool_name_over_24_chars').length <= 24, true)
  assert.equal(toolArgHint('read', { file_path: '/a/b/C.ts' }), 'C.ts')
  assert.equal(looksLikeTestTool('pwsh', { command: 'pnpm test' }), true)
  assert.equal(looksLikeTestTool('pwsh', { command: 'pnpm build' }), false)
  const voice = new StatusVoice()
  const w0 = voice.line('thinking', 0)
  const w1 = voice.line('thinking', 1000)
  const w2 = voice.line('thinking', 5000)
  assert.equal(w1, w0, 'scene stable within 4s')
  assert.notEqual(w2, w0, 'rotates after 4s')
  const whispers = new WhisperEngine()
  const y0 = whispers.feed('thinking', 10_000)
  const y1 = whispers.feed('reading', 13_000)
  assert.ok(y0, 'first whisper lands after initial cooldown window')
  assert.equal(y1, null, '9s category cooldown')

  /* ---------- event projection + view (fake cordis ctx) ---------- */
  const handlers = {}
  const fakeCtx = { on: (name, fn) => { handlers[name] = fn } }
  const service = new DesktopPetService({ registry, file: path.join(tmp, 'svc.json') })
  service.ledger.state.petId = 'test-pet'
  service.attach(fakeCtx)
  const session = { id: 'sess-1' }
  handlers['session/event'](session, { type: 'turn/start', data: {} })
  let view = service.buildView(Date.now())
  assert.equal(view.animation, animationForPhase('waiting'))
  assert.ok(view.bubble, 'waiting bubble present')
  handlers['session/event'](session, { type: 'tool/call', data: { name: 'pwsh', callId: 'c1', arguments: { command: 'npx vitest run' } } })
  view = service.buildView(Date.now())
  assert.equal(view.animation, 'running-right', 'tool phase track')
  assert.ok(String(view.bubble).includes('pwsh') || String(view.bubble).includes('vitest'), 'tool copy mentions the tool or hint: ' + view.bubble)
  handlers['session/event'](session, { type: 'turn/end', data: { reason: { kind: 'completed' }, turn: 1 } })
  view = service.buildView(Date.now())
  assert.equal(view.animation, 'jumping', 'done -> jumping')
  assert.equal(service.ledger.state.affinity.turns, 1, 'turn reward applied')
  view = service.buildView(Date.now() + 3000)
  assert.equal(view.animation, 'idle', 'done settles to idle after 2.4s')
  assert.equal(view.bubble, undefined, 'settled view has no bubble')
  // usage fold rides the same assistant/message event the phase machine uses
  handlers['session/event'](session, { type: 'assistant/message', data: { usage: { inputTokens: 42, outputTokens: 8 } } })
  assert.equal(service.buildView(Date.now()).usage.total, 50, 'assistant/message usage folds into the view')
  assert.equal(service.buildView(Date.now()).usage.source, 'local', 'no dsh-usage reachable → local observed bucket')
  // an installed dsh-usage ledger takes precedence over the local bucket
  const dd = new Date()
  const todayKey = `${dd.getFullYear()}-${String(dd.getMonth() + 1).padStart(2, '0')}-${String(dd.getDate()).padStart(2, '0')}`
  service.usageExt = { totals: { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 500, cacheWriteTokens: 0, calls: 7, cost: 3.5 }, day: todayKey, at: Date.now(), attemptAt: Date.now() }
  view = service.buildView(Date.now())
  assert.equal(view.usage.source, 'dsh-usage', 'external ledger wins')
  assert.equal(view.usage.total, 1700, 'external total = input+output+cacheRead+cacheWrite')
  assert.equal(view.usage.cost, 3.5, 'cost carried through for the ¥ display')
  handlers['session/disposed'](session)
  view = service.buildView(Date.now())
  assert.equal(view.animation, 'idle')
  assert.equal(service.ledger.turnReward('sess-1', 1), true, 'turn keys forgotten on dispose')
  // announce round-trips through the view while fresh
  service.announce({ source: 'x', kind: 'balance', title: 'T', amount: '1', tone: 'ok' })
  assert.equal(service.buildView(Date.now()).announcement.title, 'T')
  assert.equal(service.buildView(Date.now() + 60_000).announcement, undefined, 'announcement expires by ttl')

  console.log(`OK — registry / ledger / chatter / projection 全部通过（${Date.now() - t0}ms）`)
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
