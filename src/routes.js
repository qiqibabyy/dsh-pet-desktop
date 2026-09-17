/**
 * Loopback HTTP surface for the desktop pet:
 *
 *   GET  /api/desktop-pet/state            poll snapshot (?current=<sid> leads that session)
 *   GET  /api/desktop-pet/pets             PetDefinition[] (tracks/atlas URLs)
 *   GET  /api/desktop-pet/decorations      DecorationView[]
 *   GET  /api/desktop-pet/diagnostics      registry warnings
 *   POST /api/desktop-pet/interact         {kind:'pet'|'feed'} -> {reaction,delta,affinity}
 *   POST /api/desktop-pet/set-name         {name}
 *   POST /api/desktop-pet/set-pet          {petId}
 *   POST /api/desktop-pet/set-decoration   {decorationId} ('none' clears)
 *   POST /api/desktop-pet/set-display      {visible?,size?,right?,bottom?,bubbleScale?}
 *   POST /api/desktop-pet/announce         {source,kind,title,amount?,percent?,note?,tone?,ttlMs?}
 *   GET|HEAD /desktop-pet-assets/<petId>/<file>            (allow-listed pet files)
 *   GET|HEAD /desktop-pet-assets/decorations/<id>/<file>   (allow-listed decoration files)
 *
 * Fence: loopback socket + loopback Host + same-origin Origin (CSRF hygiene).
 * The companion and the browser GUI both reach it as 127.0.0.1.
 *
 * @module @linxin666/dsh-pet-desktop/src/routes
 */

import { readFileSync, statSync } from 'node:fs'

const MIME = { '.webp': 'image/webp', '.png': 'image/png', '.json': 'application/json; charset=utf-8', '.gif': 'image/gif', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' }

function writeJson(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(body)
}

function isLoopback(req) {
  const addr = req.socket?.remoteAddress ?? ''
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(addr)) return false
  if (req.headers['sec-fetch-site'] === 'cross-site') return false
  const host = String(req.headers.host ?? '').replace(/:\d+$/, '')
  if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(host)) return false
  const origin = req.headers.origin ? String(req.headers.origin).replace(/^https?:\/\//, '').replace(/:\d+$/, '') : undefined
  if (origin && origin !== host) return false
  return true
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > 64 * 1024) { resolve({}); req.destroy() ; return }
      chunks.push(c)
    })
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) ?? {}) } catch { resolve({}) }
    })
    req.on('error', () => resolve({}))
  })
}

/**
 * @param service DesktopPetService
 * @param registry PetRegistry (for asset resolution)
 * @param supervisor CompanionSupervisor (for /status)
 * @returns WebRoute[] to register on ctx.webServer
 */
export function makeDesktopPetRoutes(service, registry, supervisor) {
  const json = (method, run) => ({
    kind: 'exact',
    handler: (req, res) => {
      if (!isLoopback(req)) return writeJson(res, 403, { ok: false, error: 'forbidden: loopback-only' })
      if (req.method !== method) return writeJson(res, 405, { ok: false, error: 'method-not-allowed' })
      const raw = new URL(req.url ?? '/', 'http://127.0.0.1')
      Promise.resolve(method === 'POST' ? readBody(req).then(run) : run({ searchParams: raw.searchParams })).then(
        (value) => writeJson(res, 200, value ?? { ok: true }),
        (error) => writeJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) }),
      )
    },
  })

  const petRemarks = () => service.selectedPet()?.remarks

  const routes = [
    { ...json('GET', ({ searchParams }) => service.buildView(Date.now(), searchParams.get('current') ?? undefined)), path: '/api/desktop-pet/state' },
    { ...json('GET', () => service.petsView()), path: '/api/desktop-pet/pets' },
    { ...json('GET', () => service.decorationsView()), path: '/api/desktop-pet/decorations' },
    { ...json('GET', () => ({ diagnostics: registry.diagnostics })), path: '/api/desktop-pet/diagnostics' },
    { ...json('GET', () => supervisor.status()), path: '/api/desktop-pet/status' },
    { ...json('POST', () => { supervisor.startNow(); return { ok: true } }), path: '/api/desktop-pet/start' },
    { ...json('POST', () => { supervisor.stopNow(); return { ok: true } }), path: '/api/desktop-pet/stop' },
    {
      ...json('POST', async (body) => {
        const kind = typeof body === 'object' ? body.kind : undefined
        if (kind === 'pet') return service.ledger.interactPet(petRemarks())
        if (kind === 'feed') return service.ledger.interactFeed(petRemarks())
        return { ok: false, error: 'invalid-kind' }
      }),
      path: '/api/desktop-pet/interact',
    },
    { ...json('POST', (b) => service.setName(b?.name)), path: '/api/desktop-pet/set-name' },
    { ...json('POST', (b) => service.setPet(String(b?.petId ?? ''))), path: '/api/desktop-pet/set-pet' },
    { ...json('POST', (b) => service.setDecoration(String(b?.decorationId ?? ''))), path: '/api/desktop-pet/set-decoration' },
    { ...json('POST', (b) => service.setDisplay(b ?? {})), path: '/api/desktop-pet/set-display' },
    { ...json('POST', (b) => service.announce(b)), path: '/api/desktop-pet/announce' },
  ]

  const serve = (req, res, file) => {
    if (!isLoopback(req)) return writeJson(res, 403, { ok: false, error: 'forbidden: loopback-only' })
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405)
      return res.end()
    }
    try {
      const stat = statSync(file)
      const etag = `"${stat.size.toString(16)}-${Math.round(stat.mtimeMs).toString(16)}"`
      if (req.headers['if-none-match'] === etag) {
        res.writeHead(304)
        return res.end()
      }
      const ext = file.slice(file.lastIndexOf('.'))
      res.writeHead(200, { 'content-type': MIME[ext.toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'no-cache', etag })
      if (req.method === 'HEAD') return res.end()
      return res.end(readFileSync(file))
    } catch (error) {
      return writeJson(res, 404, { ok: false, error: String(error?.message ?? error) })
    }
  }

  // /desktop-pet-assets/decorations/<id>/<file>
  routes.push({
    kind: 'prefix',
    path: '/desktop-pet-assets/decorations',
    handler: (req, res) => {
      const raw = new URL(req.url ?? '/', 'http://127.0.0.1')
      const parts = decodeURIComponent(raw.pathname).replace(/^\/desktop-pet-assets\/decorations\/?/, '').split('/')
      return serve(req, res, registry.resolveAsset('decoration', parts[0], parts.slice(1).join('/')))
    },
  })
  // /desktop-pet-assets/<petId>/<file>
  routes.push({
    kind: 'prefix',
    path: '/desktop-pet-assets',
    handler: (req, res) => {
      const raw = new URL(req.url ?? '/', 'http://127.0.0.1')
      const parts = decodeURIComponent(raw.pathname).replace(/^\/desktop-pet-assets\/?/, '').split('/')
      return serve(req, res, registry.resolveAsset('pet', parts[0], parts.slice(1).join('/')))
    },
  })

  return routes
}
