/**
 * DSH 桌宠伴生窗口 — @linxin666/dsh-pet-desktop 的桌面渲染端。
 *
 * 数据面：全部来自本插件宿主的 loopback API —— /api/desktop-pet/state 快照
 * (animation/phase/sessions/decoration/announcement/affinity/treats/display)
 * 与 /api/desktop-pet/pets 定义；互动经 /api/desktop-pet/interact、/set-name
 * 回写 <DSH_HOME>/desktop-pet.json。视觉面：pet.module.css 原样移植 +
 * PetSprite.tsx 的 DOM 契约 (气泡栈/碎碎念/+N 角标/装饰纹样/反馈气泡/公告卡/
 * 悬停面板)。帧循环语义与网页一致：非循环轨道停在末帧由宿主切轨。
 * 窗口用 setShape 收缩到内容矩形，透明区域不拦鼠标。
 * 无 npm 依赖；任意 electron.exe 指向本目录即可运行（插件会自动做起）。
 */
const { app, BrowserWindow, ipcMain, screen, Menu, shell } = require('electron')
const http = require('http')
const fs = require('fs')
const os = require('os')
const path = require('path')

const BASE = (() => {
  const arg = process.argv.find(a => a.startsWith('--base='))
  return (arg ? arg.slice(7) : process.env.DSH_PET_BASE || 'http://127.0.0.1:43129').replace(/\/$/, '')
})()
const SELFTEST = process.argv.includes('--selftest')
// 可写运行时目录（与插件 supervisor 的 runtimeDir() 对齐；包目录安装后可能只读）。
const RUNTIME_DIR = (() => {
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  const dir = path.join(home, 'desktop-pet-run')
  try { fs.mkdirSync(dir, { recursive: true }) } catch { /* best effort */ }
  return dir
})()
const SETTINGS_FILE = path.join(RUNTIME_DIR, 'desktop-pet-window.json')
const PET_URL = new URL(BASE)
const API = '/api/desktop-pet'

const ROW_ORDER = ['idle', 'running-right', 'running-left', 'waving', 'jumping', 'failed', 'waiting', 'running', 'review']
// 窗口布局常量：气泡预留高 / 面板预留高 / 总宽。
const BUB_RESERVE = 300
const PANEL_RESERVE = 180
const WIN_WIDTH = 360
// 与 persist.bubbleScaleFor 相同的公式（renderer 也要算 --pet-bubble-scale）。
const BUBBLE_BASE_SIZE_PX = 160, BUBBLE_BASE_FONT_PX = 12, BUBBLE_FONT_MIN_PX = 10, BUBBLE_FONT_MAX_PX = 24

const settings = Object.assign(
  { pos: null, zoom: 1, topmost: true, clickThrough: false, hidden: false },
  (() => {
    // 新运行时目录优先；旧包内 window.json 作一次性迁移来源。
    for (const f of [SETTINGS_FILE, path.join(__dirname, 'window.json')]) {
      try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { /* next */ }
    }
    return {}
  })(),
)
if (Array.isArray(settings.pos)) settings.pos = { x: settings.pos[0], y: settings.pos[1] }
const saveSettings = () => fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings))

function request(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: PET_URL.hostname, port: PET_URL.port || 80, path: urlPath, method, headers: body ? { 'content-type': 'application/json' } : {} },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          if (res.statusCode >= 400) return reject(new Error(urlPath + ' -> HTTP ' + res.statusCode))
          resolve(Buffer.concat(chunks))
        })
      },
    )
    req.on('error', reject)
    if (body) req.write(JSON.stringify(body))
    req.end()
  })
}
const get = async (p) => JSON.parse((await request('GET', p)).toString('utf8'))
let win = null
let pollTimer = null
let lastPetId = null
let lastDecoId = null
let spriteH = 0

function bubbleScaleFor(display) {
  const size = Number.isFinite(display.size) ? display.size : BUBBLE_BASE_SIZE_PX
  const multiplier = typeof display.bubbleScale === 'number' && Number.isFinite(display.bubbleScale) ? display.bubbleScale : 1
  const scaled = (size / BUBBLE_BASE_SIZE_PX) * multiplier
  const min = BUBBLE_FONT_MIN_PX / BUBBLE_BASE_FONT_PX
  const max = BUBBLE_FONT_MAX_PX / BUBBLE_BASE_FONT_PX
  return Math.round(Math.min(max, Math.max(min, scaled)) * 100) / 100
}

function windowHeightFor(h) {
  return BUB_RESERVE + h + PANEL_RESERVE
}

async function poll() {
  try {
    const state = await get(`${API}/state`)
    const petId = state.pet && state.pet.id
    if (!petId) return
    if (petId !== lastPetId) {
      const defs = await get(`${API}/pets`)
      const def = defs.find(d => d.id === petId)
      if (!def || def.renderer !== 'sprite2d') return
      def.rowsIndex = Object.fromEntries(ROW_ORDER.map((name, i) => [name, i]))
      // file:// 渲染页加载 http:// 子资源会被拦，图集与装饰图统一走主进程 data URL。
      const bytes = await request('GET', def.atlasUrl)
      def.atlasDataUrl = 'data:image/webp;base64,' + bytes.toString('base64')
      lastPetId = petId
      if (win) win.webContents.send('pet-def', def)
    }
    const decoId = state.decoration && state.decoration.id
    if (decoId !== lastDecoId) {
      lastDecoId = decoId
      if (decoId) {
        try {
          const bytes = await request('GET', state.decoration.entryUrl)
          const mime = /\.webp$/i.test(state.decoration.entryUrl) ? 'image/webp' : 'image/png'
          if (win) win.webContents.send('pet-deco', { id: decoId, dataUrl: 'data:' + mime + ';base64,' + bytes.toString('base64') })
        } catch { lastDecoId = null }
      }
    }
    const base = state.display && Number.isFinite(state.display.size) ? state.display.size : 160
    const h = Math.max(64, Math.min(512, Math.round(base * settings.zoom)))
    if (h !== spriteH) {
      const oldH = spriteH
      spriteH = h
      if (win) {
        const [x, y] = win.getPosition()
        // 精灵底边锚定；越界交给 clampToScreen（按所在显示器）。
        win.setBounds({ x, y: y + (oldH === 0 ? 0 : oldH - h), width: WIN_WIDTH, height: windowHeightFor(h) })
        clampToScreen()
      }
    }
    win && win.webContents.send('pet-state', {
      spriteH,
      bubbleScale: bubbleScaleFor(state.display ?? {}),
      snapshot: {
        animation: state.animation, phase: state.phase, bubble: state.bubble,
        sessions: state.sessions, decoration: state.decoration, announcement: state.announcement,
        affinity: state.affinity, treats: state.treats, name: state.name,
        displayName: state.pet.displayName,
      },
    })
  } catch {
    clearInterval(pollTimer)
    pollTimer = setInterval(poll, 5000)
  }
}

function applyTopmost() { if (win) win.setAlwaysOnTop(settings.topmost, 'screen-saver') }
function applyClickThrough() { if (win) win.setIgnoreMouseEvents(!!settings.clickThrough, { forward: true }) }

// 整窗收进「所在显示器」的工作区：气泡层在窗口内部，窗不越屏气泡就不可能被裁。
// 用 getDisplayMatching 而非主屏，副屏用户拖过去不会被拽回来。
function clampToScreen() {
  if (!win) return
  const b = win.getBounds()
  const wa = screen.getDisplayMatching(b).workArea
  const x = Math.max(wa.x, Math.min(b.x, wa.x + wa.width - b.width))
  const y = Math.max(wa.y, Math.min(b.y, wa.y + wa.height - b.height))
  if (x !== b.x || y !== b.y) win.setBounds({ ...b, x, y })
}

function buildMenu() {
  return Menu.buildFromTemplate([
    { label: settings.hidden ? '召唤桌宠' : '收起桌宠', click: () => { settings.hidden = !settings.hidden; saveSettings(); if (win) win.webContents.send('pet-hidden', settings.hidden) } },
    { label: '窗口置顶', type: 'checkbox', checked: settings.topmost, click: (it) => { settings.topmost = it.checked; saveSettings(); applyTopmost() } },
    { label: '鼠标穿透', type: 'checkbox', checked: settings.clickThrough, click: (it) => { settings.clickThrough = it.checked; saveSettings(); applyClickThrough() } },
    { label: '缩放', submenu: [0.6, 0.8, 1, 1.25, 1.5, 2].map(z => ({
      label: Math.round(z * 100) + '%', type: 'radio', checked: Math.abs(settings.zoom - z) < 0.01,
      click: () => { settings.zoom = z; saveSettings(); lastPetId = null; poll() },
    })) },
    { type: 'separator' },
    { label: '退出', click: () => { try { fs.writeFileSync(path.join(RUNTIME_DIR, '.quit-intent'), '') } catch { /* best effort */ } app.quit() } },
  ])
}

function createWindow() {
  const wa = screen.getPrimaryDisplay().workArea
  spriteH = Math.max(64, Math.min(512, Math.round(160 * settings.zoom)))
  const h = windowHeightFor(spriteH)
  const clamp = (p) => {
    const wa = screen.getDisplayMatching({ x: p.x, y: p.y, width: WIN_WIDTH, height: h }).workArea
    return {
      x: Math.max(wa.x, Math.min(p.x, wa.x + wa.width - WIN_WIDTH)),
      y: Math.max(wa.y, Math.min(p.y, wa.y + wa.height - h)),
    }
  }
  const onScreen = screen.getAllDisplays().some(d =>
    settings.pos && settings.pos.x >= d.bounds.x - 40 && settings.pos.x < d.bounds.x + d.bounds.width &&
    settings.pos.y >= d.bounds.y - 40 && settings.pos.y < d.bounds.y + d.bounds.height)
  const pos = clamp(onScreen ? settings.pos : { x: wa.x + wa.width - WIN_WIDTH - 24, y: wa.y + wa.height - h - 8 })
  win = new BrowserWindow({
    x: pos.x, y: pos.y, width: WIN_WIDTH, height: h,
    transparent: true, frame: false, resizable: false, movable: false,
    hasShadow: false, skipTaskbar: true, alwaysOnTop: true, focusable: true,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  })
  applyTopmost()
  applyClickThrough()
  win.setMenu(null)
  win.loadFile(path.join(__dirname, 'pet.html'))
  win.on('close', () => { const [x, y] = win.getPosition(); settings.pos = { x, y }; saveSettings() })
  win.webContents.on('render-process-gone', (_e, d) => console.log('[win] render-process-gone: ' + JSON.stringify(d)))
  win.webContents.on('console-message', (e, legacyLevel, legacyMessage) => {
    const params = typeof e === 'object' && e ? e : {}
    const level = params.level ?? legacyLevel
    const message = params.message ?? legacyMessage
    if (level === 3 || level === 'error' || level === 'warning' || level === 2) console.log('[renderer-' + level + '] ' + message)
  })
  win.webContents.on('ipc-message', (_e, channel, arg) => { if (channel === 'pet-debug') console.log('[debug] ' + JSON.stringify(arg)) })
  win.webContents.on('did-fail-load', (_e, c, d) => console.log('[win] did-fail-load: ' + c + ' ' + d))
  win.on('closed', () => { win = null })
  win.webContents.once('did-finish-load', () => win.webContents.send('pet-hidden', settings.hidden))
}

ipcMain.on('pet-menu', () => { if (win) buildMenu().popup({ window: win }) })
ipcMain.on('pet-drag', (_e, dx, dy) => {
  if (!win) return
  const [x, y] = win.getPosition()
  win.setPosition(x + Math.round(dx), y + Math.round(dy))
  clampToScreen()
})
ipcMain.on('pet-drag-end', () => { if (win) { const [x, y] = win.getPosition(); settings.pos = { x, y }; saveSettings() } })
ipcMain.on('pet-wheel', (_e, delta) => {
  settings.zoom = Math.max(0.4, Math.min(3.2, settings.zoom * Math.pow(1.0015, -delta)))
  saveSettings()
  poll()
})
ipcMain.on('pet-shape', (_e, rects) => {
  if (process.env.DSH_PET_NOSHAPE) return
  if (win && Array.isArray(rects) && rects.length > 0) {
    try {
      // Windows setShape 用窗口左上角相对的 DIP，且必须按面积降序。
      const shaped = rects.map(r => ({
        x: Math.round(r.x), y: Math.round(r.y),
        width: Math.round(r.width), height: Math.round(r.height),
      })).sort((a, b) => b.width * b.height - a.width * a.height)
      win.setShape(shaped)
    } catch (err) { console.log('[shape] ' + err.message) }
  }
})
ipcMain.handle('pet-call', async (_e, p, body) => JSON.parse((await request('POST', p, body)).toString('utf8')))
ipcMain.on('pet-open-gui', () => { shell.openExternal(BASE) })
ipcMain.on('pet-self-hide', () => { settings.hidden = true; saveSettings(); if (win) win.webContents.send('pet-hidden', true) })
ipcMain.on('pet-summon', () => { settings.hidden = false; saveSettings(); if (win) win.webContents.send('pet-hidden', false) })

if (!app.requestSingleInstanceLock()) app.quit()
else {
  // 供插件监督方接管：记录当前持有单实例锁的进程 id。
  try { fs.writeFileSync(path.join(RUNTIME_DIR, '.pid'), String(process.pid)) } catch { /* best effort */ }
  app.whenReady().then(() => {
    if (SELFTEST) {
      ;(async () => {
        const state = await get(`${API}/state`)
        const defs = await get(`${API}/pets`)
        const def = defs.find(d => d.id === state.pet.id)
        console.log(JSON.stringify({ ok: true, base: BASE, pet: def.id, renderer: def.renderer, animation: state.animation, tracks: Object.keys(def.tracks).length }))
        app.exit(0)
      })().catch((err) => { console.error('[selftest] FAIL: ' + err.message); app.exit(1) })
      return
    }
    createWindow()
    pollTimer = setInterval(poll, 2000)
    poll()
  })
  app.on('window-all-closed', () => app.quit())
}
