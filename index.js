/**
 * @linxin666/dsh-pet-desktop — a self-contained desktop pet plugin for DeepSeek
 * Harness. Codex-style frame-animated pet living on the desktop: own affinity
 * ledger (<DSH_HOME>/desktop-pet.json), own pet registry (native Codex pet
 * directories + user pet dirs), activity bubbles wired directly to harness
 * session events, decorations, and a settings-page card. The web pet is not a
 * dependency; when it happens to be installed, its usage announcement is echoed
 * opportunistically.
 *
 * Layout:
 *   src/registry.js   pet/decoration discovery + track building
 *   src/service.js    ledger + session state machines + state view
 *   src/routes.js     loopback /api/desktop-pet/* + /desktop-pet-assets/*
 *   src/supervisor.js Electron companion lifecycle
 *   client.js         settings-page card (module-host CJS factory)
 *   companion/        the Electron desktop app
 *
 * @module @linxin666/dsh-pet-desktop
 */

import { get as httpRequest } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import z from 'schemastery'
import { PetRegistry } from './src/registry.js'
import { DesktopPetService } from './src/service.js'
import { makeDesktopPetRoutes } from './src/routes.js'
import { CompanionSupervisor } from './src/supervisor.js'

const dirname = path.dirname(fileURLToPath(import.meta.url))

/** Stable cordis plugin name (matches cordis.patch.yml insert id). */
export const name = 'pet-desktop'

/** Routes/companion need the real listening port. */
export const inject = ['webServer']

/** Settings section schema rendered by the web settings surface. */
export const schema = z.object({
  enabled: z.boolean().default(true).description('自动启动桌面宠物'),
  electronPath: z.string().default('').description('electron.exe 路径；留空自动查找（DSH_PET_ELECTRON / 本包 node_modules / 全局 npm）'),
  petDirs: z.array(z.string()).default([]).description('额外的 Codex 格式宠物目录（每项一个文件夹路径，内含 <pet>/pet.json + spritesheet.webp）'),
})

function webPetAnnouncement(port) {
  return new Promise((resolve) => {
    const req = httpRequest({ host: '127.0.0.1', port, path: '/api/pet/state', method: 'GET', timeout: 800 }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        if (res.statusCode !== 200) return resolve(undefined)
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')).announcement) } catch { resolve(undefined) }
      })
    })
    req.on('error', () => resolve(undefined))
    req.on('timeout', () => { req.destroy(); resolve(undefined) })
    req.end()
  })
}

export function applyImpl(ctx, config = {}) {
  let section = {
    enabled: config.enabled ?? true,
    electronPath: config.electronPath ?? '',
    petDirs: Array.isArray(config.petDirs) ? config.petDirs.filter((d) => typeof d === 'string' && d) : [],
  }

  const registry = new PetRegistry(section.petDirs).load()
  const service = new DesktopPetService({ registry })
  service.enabled = section.enabled
  const supervisor = new CompanionSupervisor({
    companionDir: path.join(dirname, 'companion'),
    packageDir: dirname,
    getPort: () => ctx.webServer?.port,
    getConfig: () => section,
  })

  ctx.effect(() => {
    const offs = makeDesktopPetRoutes(service, registry, supervisor).map((route) => ctx.webServer.register(route))
    return () => { for (const off of offs) if (typeof off === 'function') off() }
  }, 'pet-desktop: routes')

  ctx.effect(() => service.attach(ctx), 'pet-desktop: session events')

  ctx.effect(() => {
    supervisor.ensure()
    return () => supervisor.stop()
  }, 'pet-desktop: companion')

  // Opportunistic echo of the web pet's usage announcement (no dependency:
  // when dsh-pet is absent the probe simply fails and nothing is mirrored).
  ctx.effect(() => {
    const timer = setInterval(async () => {
      const port = ctx.webServer?.port
      if (!port || !section.enabled) return
      const announcement = await webPetAnnouncement(port)
      if (announcement && Date.now() - announcement.at < announcement.ttlMs) service.mirrored = announcement
    }, 5000)
    return () => clearInterval(timer)
  }, 'pet-desktop: usage mirror')

  ctx.inject(['settings'], (settingsCtx) => {
    try {
      const applySection = () => {
        service.enabled = section.enabled
        registry.extraDirs = section.petDirs
        registry.load()
        if (section.enabled) supervisor.startNow()
        else supervisor.stopNow()
      }
      if (typeof settingsCtx.settings?.installSection === 'function') {
        let getSection = () => section
        settingsCtx.settings.installSection(ctx, 'petDesktop', schema, section, {
          setSource: (source) => { getSection = source },
          onChange: () => { section = getSection(); applySection() },
        })
      } else if (typeof settingsCtx.settings?.register === 'function') {
        const scope = settingsCtx.settings.register('petDesktop', schema, { base: section })
        scope?.watch?.(() => { section = scope.get?.() ?? section; applySection() })
      }
    } catch {
      // Settings surface shape differences must not break the pet.
    }
  })
}

/**
 * Single-instance guard (same pattern as the dsh-web family's mountOnce): the
 * loader may mount this package twice (bundle patch row + user patch row); a
 * second supervisor must not spawn a competing companion.
 */
const MOUNTED = Symbol.for('dsh-web.mounted-plugins')
export const apply = ((fn) => (...args) => {
  const mounted = (globalThis[MOUNTED] ??= new Set())
  if (mounted.has('@linxin666/dsh-pet-desktop')) return
  mounted.add('@linxin666/dsh-pet-desktop')
  args[0]?.effect?.(() => () => mounted.delete('@linxin666/dsh-pet-desktop'))
  return fn(...args)
})(applyImpl)
