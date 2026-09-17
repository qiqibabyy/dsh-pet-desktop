# dsh-pet-desktop

> DeepSeek Harness 桌面宠物插件 — 把 Codex 桌宠完整移植到 DSH 桌面上。

一个**自包含**的 DSH（DeepSeek Harness）插件：harness 启动时自动在你的桌面上养一只帧动画桌宠。它不依赖网页端桌宠，自带状态机、文案引擎与宠物注册表，直接订阅 harness 会话事件。

## 功能

- 🖥️ **桌面常驻**：无边框、置顶、透明**智能穿透**可切换（开启后拖不动、摸不到、滚轮无效，唯独右键仍能唤出菜单关掉它，永不自锁）；右键菜单（收起/召唤、缩放、鼠标穿透、退出）；互动栏（名字/亲密度/喂食/改名）只在轻点她时出现，路过或悬停不打扰
- 📌 **贴边拖拽**：光标 1:1 跟手 + 触边吸附——撞上屏幕边的那刻钉住，回拉鼠标不会把她带离（重新按住才走）。气泡与设置卡随边自动翻向：左右贴边时向内生长，顶贴边时降到脚下，任何位置都不会被屏幕裁掉
- 🎬 **Codex 宠物格式原生支持**：自动发现 `~/.codex/pets`、`~/.dsh/pets` 与包内 `assets/pets`（`pet.json` + `spritesheet.webp`），9 条标准轨道（idle / running-right / running-left / waving / jumping / failed / waiting / running / review）+ 每宠物 `tracks/sequences` 覆盖
- 💬 **活动气泡**：直接监听 harness 会话事件，投影为 waiting / thinking / tool / review / done / failed 六相位；389 条内置中文文案按 4s 轮转，工具碎碎念（「」小气泡）带 9s/5s 冷却与 8s 上屏时限；多会话气泡栈 + `+N` 角标
- 💕 **亲密度系统**：摸头 +1（10s 冷却）、喂食 +5（消耗 1 小鱼干，30s 冷却）、完成对话 +1（按会话轮次幂等）；小鱼干每 30 轮 +1、每 5 小时 +1、上限 20；亲密度**永不衰减**
- 🐋 **装扮**：内置小鲸鱼陪伴装饰层（随相位播放帧段），设置页可换/可关
- 📊 **用量公告回显**：若同时安装了网页端 dsh-pet/dsh-usage，余额/套餐公告会镜像到桌宠（纯回显，无依赖）
- ⚙️ **设置页集成**：harness Web 设置 →「桌面宠物」：自动启动、状态与立即启动/停止、窗口控制（置顶/鼠标穿透/收起召唤/大小滑杆）、带精灵缩略图的宠物选择卡、装扮选择、electron 路径。鼠标穿透随时可在本页关回来——不存在救不回来的锁死

## 安装

需要 DSH Desktop（或任何带 web server 的 harness 宿主）。

```bash
dsh plugin --profile web add @linxin666/dsh-pet-desktop
# 本地开发：
dsh plugin --profile web add link:../dsh-pet-desktop
```

Electron 运行时按以下顺序查找（任一命中即可）：

1. 设置页「electron 路径」字段
2. 环境变量 `DSH_PET_ELECTRON`
3. 本包 `node_modules/electron/dist/electron.exe`（在包目录 `npm i electron` 过）
4. 全局 npm：`%APPDATA%/npm/node_modules/electron`（Windows）

> 找不到 Electron 时，设置页会红字提示；装一个 `npm i -g electron` 即全部解决。

## 宠物与装扮

宠物文件夹格式见 [`assets/pets/README.md`](assets/pets/README.md)。同名 id 后者覆盖前者，发现顺序：

1. 本包 `assets/pets/`
2. `${CODEX_HOME:-~/.codex}/pets/` — Codex 原生目录
3. `${DSH_HOME:-~/.dsh}/pets/` — 用户目录（装扮也扫这里的 `decorations/`）
4. 插件配置 `petDirs` 列出的额外目录

`renderer: live2d / frames2d` 的宠物按设计跳过（本插件渲染 sprite2d 图集）。

## 段位（亲密度点数）

| 点数 ≥ | 段位 | 星迹 |
|---|---|---|
| 0 | 幼鲸 | `*` |
| 25 | 伙伴 | `**` |
| 50 | 挚友 | `***` |
| 80 | 深海羁绊 | `****` |
| 200 | 心有灵犀 | `*****` |
| 500 | 传说羁绊 | `******` |
| 2000 | 神话羁绊 | `*******` |
| 10000 | 永恒之契 | `********` |
| 100000 | 鲸生共渡 | `*********` |

## 开发

```bash
npm install            # 只有 schemastery 一个运行时依赖
node scripts/smoke.mjs # 无宿主烟测：注册表 / 账本 / 文案引擎 / 事件投影
```

目录结构：

| 路径 | 作用 |
| --- | --- |
| `index.js` | 插件装配（cordis host 半边） |
| `src/service.js` | 状态机 + 亲密度账本 + 事件投影（`~/.dsh/desktop-pet.json` 原子持久化） |
| `src/chatter.js` | 文案引擎（389 条，逐条移植自 dsh-pet，Apache-2.0） |
| `src/registry.js` | 宠物与装扮发现（Codex v1/v2 manifest 兼容） |
| `src/routes.js` | `/api/desktop-pet/*` loopback 路由（含图集/装扮静态资产） |
| `src/supervisor.js` | Electron 伴生窗口的查径、启动、接管、守护 |
| `client.js` | 设置页卡片（模块宿主 CJS 工厂格式，免构建） |
| `companion/` | Electron 伴生窗口（主进程 + 渲染层，零 npm 依赖） |
| `assets/decorations/` | 内置装扮（whale，MIT，见其 LICENSE.txt） |

## 许可

- 代码：Apache-2.0（见 [LICENSE](LICENSE)）
- `src/chatter.js` 文案池与 `assets/decorations/whale` 装扮衍生自
  [dsh-web](https://github.com/zhu1090093659/dsh-web) `@linxin666/dsh-pet`
  （代码 Apache-2.0；whale 装扮按其清单声明为 MIT）
- 桌宠交互概念与宠物格式向 Codex Desktop Pet 致敬
