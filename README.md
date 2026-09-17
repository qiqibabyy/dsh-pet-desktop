# dsh-pet-desktop

[中文 README](README.zh.md)

> A desktop-pet plugin for DeepSeek Harness — the Codex pet experience, fully ported to your desktop.

A **self-contained** [DSH](https://github.com/deepseek-ai) harness plugin: when the harness starts, a frame-animated pet lives on your desktop. No web-pet dependency — it ships its own state machine, chatter engine and pet registry, and subscribes directly to harness session events.

## Features

- 🖥️ **Desktop overlay**: frameless, always-on-top, transparent **smart click-through** — when on, she's inert to dragging/clicking/scroll and only a right-click still reaches her control menu (so you can never trap yourself); the info card (name/rank/feed/rename) appears only on a tap, not on hover
- 📌 **Edge-aware dragging**: 1:1 pointer tracking with snap — the instant she hits a screen edge she sticks there (recycling the mouse can't drag her back off; a fresh grab moves her again). Bubbles and the settings card auto-flip near edges — grow inward at left/right, drop below her feet at the top — nothing ever clips off-screen
- 🎬 **Native Codex pet format**: drop Codex pet folders straight into `~/.codex/pets` — also auto-discovers `~/.dsh/pets` and bundled `assets/pets` (`pet.json` + `spritesheet.webp`); the 9 standard tracks (idle / running-right / running-left / waving / jumping / failed / waiting / running / review) with per-pet `tracks` / `sequences` overrides
- 💬 **Live activity bubbles**: harness session events project onto six phases (waiting / thinking / tool / review / done / failed); 389 built-in zh chatter lines rotating every 4 s; tool "whispers" («…」) with 9 s / 5 s cooldowns and 8 s on-screen TTL; multi-session bubble stack with `+N` badge
- 💕 **Affinity**: pet +1 (10 s cooldown), feed +5 (costs 1 treat, 30 s cooldown), completed turn +1 (idempotent per session turn); treats accrue +1 per 30 turns and +1 per 5 h, capped at 20; affinity **never decays**
- 🐋 **Decoration**: bundled whale status ornament, phase-driven frame segments, switchable/off in settings
- ⚙️ **Settings integration**: a “桌面宠物” section — auto-start, status + start/stop, window controls (always-on-top, click-through, hide/summon, size slider), pet picker with sprite thumbnails, decoration picker, electron path. Click-through can always be undone here — no way to trap yourself

## Install

Requires DSH Desktop (or any harness host with the web server).

```bash
dsh plugin --profile web add @qiqibabyy/dsh-pet-desktop
# local development:
dsh plugin --profile web add link:../dsh-pet-desktop
```

Electron runtime lookup order (first hit wins):

1. the `electronPath` setting
2. `DSH_PET_ELECTRON` env var
3. this package's `node_modules/electron/dist/electron.exe`
4. global npm: `%APPDATA%/npm/node_modules/electron` (Windows)

If nothing is found the settings card says so in red; `npm i -g electron` fixes it everywhere.

## Pets & decorations

Format details: [`assets/pets/README.md`](assets/pets/README.md). Sources scanned in order (later overrides same pet ids):

1. bundled `assets/pets/`
2. `${CODEX_HOME:-~/.codex}/pets/` — native Codex directory
3. `${DSH_HOME:-~/.dsh}/pets/` — user directory (`decorations/` subfolders scanned too)
4. extra directories from the `petDirs` plugin config

Pets declaring `renderer: live2d / frames2d` are skipped by design — this plugin renders sprite2d atlases.

### Porting pets from Codex

**Drop them in as-is, zero conversion**: copy a Codex pet folder (`pet.json` + atlas) into `~/.codex/pets/<id>/` and it is discovered automatically (`CODEX_HOME` is honored). Both Codex manifest generations are understood — the legacy flat hatch-pet shape and v2 `sprite2d` blocks. No CLI needed to swap pets: harness settings → "Desktop Pet" → the appearance picker; click a thumbnail and the companion re-skins live.

## Ranks (affinity points)

| points ≥ | rank | star trail |
|---|---|---|
| 0 | Baby Whale 幼鲸 | `*` |
| 25 | Companion 伙伴 | `**` |
| 50 | Close Friend 挚友 | `***` |
| 80 | Deep Sea Bond 深海羁绊 | `****` |
| 200 | Kindred Spirit 心有灵犀 | `*****` |
| 500 | Legendary Bond 传说羁绊 | `******` |
| 2000 | Mythic Bond 神话羁绊 | `*******` |
| 10000 | Eternal Covenant 永恒之契 | `********` |
| 100000 | Lifelong Companion 鲸生共渡 | `*********` |

## Loopback API

Served by the plugin on the harness web port, loopback-only:

| Route | Purpose |
| --- | --- |
| `GET /api/desktop-pet/state?current=<sid>` | full view for the companion renderer |
| `GET /api/desktop-pet/pets` / `decorations` | registries |
| `POST /api/desktop-pet/interact` `{kind}` | pet / feed (+reaction) |
| `POST /api/desktop-pet/set-pet` / `set-decoration` / `set-name` / `set-display` / `announce` | verbs |
| `GET /api/desktop-pet/status` · `POST start` / `stop` | companion supervisor |
| `GET /desktop-pet-assets/**` | atlases & decoration frames (allow-listed, containment-checked) |

## Development

```bash
npm install            # one runtime dep: schemastery
node scripts/smoke.mjs # host-free smoke test: registry / ledger / chatter / projection
```

| Path | Role |
| --- | --- |
| `index.js` | plugin assembly (cordis host half) |
| `src/service.js` | state machine + affinity ledger + event projection |
| `src/chatter.js` | chatter engine (ported line-by-line from dsh-pet) |
| `src/registry.js` | pet/decoration discovery (Codex v1 + v2 manifests) |
| `src/routes.js` | loopback routes + asset serving |
| `src/supervisor.js` | Electron companion process discovery/spawn/keepalive |
| `client.js` | settings card (build-free CJS module-loader factory) |
| `companion/` | Electron overlay app (zero npm deps; any `electron.exe` runs it) |

## License

- Code: Apache-2.0 ([LICENSE](LICENSE))
- `src/chatter.js` text pools and `assets/decorations/whale` are derived from
  [dsh-web](https://github.com/zhu1090093659/dsh-web) `@linxin666/dsh-pet`
  (code Apache-2.0; the whale decoration declares MIT in its own manifest)
- Pet interaction concepts and the sprite format salute Codex Desktop Pet
