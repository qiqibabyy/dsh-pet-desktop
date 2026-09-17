# Adding a desktop pet (Codex sprite2d format)

Drop a folder into one of the scanned sources (later wins on same id):

1. `~/.codex/pets/<id>/` — native Codex / hatch-pet directory
2. `~/.dsh/pets/<id>/` (or `$DSH_HOME/pets/<id>/`)
3. this package's `assets/pets/<id>/`
4. any directory listed in the `petDirs` plugin config setting

Each pet folder needs:

```
<id>/
├── pet.json           # manifest, ≤64 KiB
└── spritesheet.webp   # the atlas (PNG also works)
```

Minimal `pet.json` (v1 flat — the Codex shape):

```json
{
  "id": "my-pet",
  "displayName": "我的宠物",
  "description": "一句话介绍",
  "spritesheetPath": "spritesheet.webp"
}
```

Atlas contract (defaults shown; all overridable per manifest):

- cell `192×208`, `columns: 8`
- 9 fixed animation rows, in order:
  `idle, running-right, running-left, waving, jumping, failed, waiting, running, review`
- used frames per row default to `[6, 8, 8, 4, 5, 8, 6, 6, 6]`
- `spriteVersionNumber: 2` makes the atlas 11 rows tall (2 extra "look" rows)

Optional `pet.json` fields: `cell`, `columns`, `frames`, `tracks`
(per-track `{durations, loop, fallback}` — durations are cycled/trimmed to the
frame count), `sequences` (per-phase multi-track timelines:
`{"done": ["jumping","waving","idle"]}`), and `remarks` (per-kind reply pools
`pet|petCooldown|feed|feedCooldown|noTreats`, ≤64 lines × ≤120 chars).

`renderer: "live2d" | "frames2d"` pets from Codex are skipped by design —
this plugin renders sprite2d atlases.

The pet list refreshes on plugin start; pick it in
Settings → 桌面宠物 (or `POST /api/desktop-pet/set-pet` on the loopback API).
