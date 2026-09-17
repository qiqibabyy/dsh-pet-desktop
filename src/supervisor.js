/**
 * Companion supervisor — owns the desktop window process for as long as the
 * harness host runs: locate Electron, spawn detached with the real listening
 * port, keep it alive, take over stragglers from earlier sessions, and tear
 * it down on host exit (or when the setting flips off).
 *
 * Conventions shared with the companion app (companion/main.cjs): runtime
 * files live in a writable dir under DSH_HOME (see runtimeDir below) —
 *   .pid           pid of whichever instance currently holds the
 *                  single-instance lock (killed on takeover)
 *   .quit-intent   written by the companion's own 退出 menu; suppresses
 *                  respawn for the current host session
 *
 * @module @linxin666/dsh-pet-desktop/src/supervisor
 */

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { dshHome } from './registry.js'

/**
 * Writable runtime dir shared with the companion app (the package directory
 * itself may sit in a read-only pnpm store once installed from npm):
 *   <DSH_HOME>/desktop-pet-run/desktop-pet-window.json  window pos/zoom
 *   <DSH_HOME>/desktop-pet-run/.pid                     lock holder (takeover)
 *   <DSH_HOME>/desktop-pet-run/.quit-intent             menu 退出 = stay down this session
 */
export function runtimeDir() {
  const dir = path.join(dshHome(), 'desktop-pet-run')
  try { mkdirSync(dir, { recursive: true }) } catch { /* best effort */ }
  return dir
}

export function findElectron({ configPath, packageDir }) {
  const candidates = [
    configPath,
    process.env.DSH_PET_ELECTRON,
    existsSync(path.join(packageDir, 'electron.local')) && readFileSync(path.join(packageDir, 'electron.local'), 'utf8').trim(),
    path.join(packageDir, 'node_modules', 'electron', 'dist', 'electron.exe'),
    process.env.APPDATA && path.join(process.env.APPDATA, 'npm', 'node_modules', 'electron', 'dist', 'electron.exe'),
  ]
  for (const candidate of candidates) if (candidate && existsSync(candidate)) return candidate
  return undefined
}

export class CompanionSupervisor {
  /**
   * @param opts.companionDir - Electron app directory to spawn
   * @param opts.packageDir - plugin package root (electron.local / own node_modules)
   * @param opts.getPort - current webServer port (undefined before listen)
   * @param opts.getConfig - () => {enabled, electronPath}
   */
  constructor({ companionDir, packageDir, getPort, getConfig }) {
    this.companionDir = companionDir
    this.packageDir = packageDir
    this.getPort = getPort
    this.getConfig = getConfig
    this.child = null
    this.retryTimer = null
    this.stopped = false
    this.manualStop = false
  }

  get section() {
    return this.getConfig() ?? { enabled: true, electronPath: '' }
  }

  status() {
    return {
      ok: true,
      running: !!this.child,
      pid: this.child?.pid ?? null,
      enabled: !!this.section.enabled,
      electronFound: !!findElectron({ configPath: this.section.electronPath, packageDir: this.packageDir }),
      quitIntent: existsSync(path.join(runtimeDir(), '.quit-intent')),
    }
  }

  ensure() {
    this.retryTimer = null
    if (this.stopped || !this.section.enabled || this.child) return
    if (existsSync(path.join(runtimeDir(), '.quit-intent'))) return
    const port = this.getPort()
    if (!port) {
      this.retryTimer = setTimeout(() => this.ensure(), 1000)
      return
    }
    this._takeover()
    const exe = findElectron({ configPath: this.section.electronPath, packageDir: this.packageDir })
    if (!exe) {
      console.log('[pet-desktop] 未找到 electron.exe（设置「electron 路径」/ DSH_PET_ELECTRON / npm i -g electron）')
      return
    }
    let child
    try {
      child = spawn(exe, [this.companionDir, `--base=http://127.0.0.1:${port}`], { detached: true, stdio: 'ignore', windowsHide: true })
    } catch (error) {
      console.log('[pet-desktop] 启动失败: ' + (error?.message ?? error))
      return
    }
    this.child = child
    child.on('exit', (code) => {
      if (this.child !== child) return
      this.child = null
      // Quiet immediate exit usually means the single-instance lock was held
      // by a straggler; keep retrying so we take over once it frees.
      if (!this.stopped && !this.manualStop && this.section.enabled) {
        this.retryTimer = setTimeout(() => this.ensure(), code === 0 ? 10000 : 3000)
      }
    })
    child.unref()
    this.manualStop = false
    console.log(`[pet-desktop] 桌面宠物已启动 (pid ${child.pid}, base=${port})`)
  }

  /** Kill a companion left running by an earlier session/hand launch. */
  _takeover() {
    // legacy first position (pre-runtimeDir builds / hand-launched bats) is
    // also checked once so stragglers from an older install get taken over.
    for (const pidFile of [path.join(runtimeDir(), '.pid'), path.join(this.companionDir, '.pid')]) {
      if (!existsSync(pidFile)) continue
      try {
        const old = parseInt(readFileSync(pidFile, 'utf8'), 10)
        if (Number.isFinite(old)) {
          try {
            process.kill(old, 0)
            if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(old), '/T', '/F'])
            else process.kill(old, 'SIGTERM')
          } catch { /* already gone */ }
        }
      } catch { /* unreadable pid file */ }
      try { rmSync(pidFile, { force: true }) } catch { /* noop */ }
    }
  }

  /** User quit the app menu this session: clear intent + respawn. */
  startNow() {
    this.manualStop = false
    try { rmSync(path.join(runtimeDir(), '.quit-intent'), { force: true }) } catch { /* noop */ }
    this.ensure()
  }

  /** Stop and stay stopped (until startNow / next host session). */
  stopNow() {
    this.manualStop = true
    this._kill()
  }

  /** Full teardown (host disposal). */
  stop() {
    this.stopped = true
    this._kill()
  }

  _kill() {
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null }
    const child = this.child
    this.child = null
    if (!child) return
    const pid = child.pid
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'])
    else { try { process.kill(-pid, 'SIGTERM') } catch { /* already gone */ } }
  }
}
