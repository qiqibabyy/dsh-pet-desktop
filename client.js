/**
 * dsh-pet-desktop client half — the "桌面宠物" first-level settings section.
 * Reads/writes the plugin's own loopback API (/api/desktop-pet/*): run state
 * (start/stop/auto-start), window controls (置顶/鼠标穿透/收起/大小 — also the
 * escape hatch for a click-through pet), pet picker with sprite thumbnails,
 * decoration picker, affinity chip and the electron path.
 *
 * Module-host CJS factory form (same shape tsdown emits for the dsh-pet
 * family): the factory's return value is the module namespace; bare
 * specifiers arrive through the injected require.
 */
window.__ModuleLoader__.load({
  id: "@linxin666/dsh-pet-desktop",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    let react = require("react");
    const h = react.createElement;
    const useState = react.useState;
    const useEffect = react.useEffect;
    const useCallback = react.useCallback;

    const API = '/api/desktop-pet';
    const CSS_ID = 'dsh-pet-desktop-css';
    const CSS = `
.dsp-card{display:flex;flex-direction:column;gap:12px;max-width:680px;color:#e6ebf8}
.dsp-group{border:1px solid rgba(126,152,255,.16);border-radius:12px;background:rgba(126,152,255,.05);padding:12px 14px;display:flex;flex-direction:column;gap:10px}
.dsp-gtitle{font-size:11px;letter-spacing:.08em;opacity:.55;font-weight:700}
.dsp-row{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.dsp-hint{font-size:12px;opacity:.6;line-height:1.5}
.dsp-btn{border:1px solid rgba(126,152,255,.45);border-radius:8px;padding:5px 14px;font-size:13px;cursor:pointer;color:#e6ebf8;background:linear-gradient(180deg,#4a68f5,#3a55e0);transition:filter .15s ease}
.dsp-btn:hover:not(:disabled){filter:brightness(1.15)}
.dsp-btn:disabled{opacity:.4;cursor:default}
.dsp-btnGhost{background:transparent;color:#9db4ff}
.dsp-input{flex:1;min-width:0;border:1px solid rgba(126,152,255,.35);border-radius:6px;background:rgba(19,28,54,.9);color:#e6ebf8;font-size:12px;padding:5px 8px;outline:none}
.dsp-input:focus{border-color:rgba(126,152,255,.7)}
.dsp-select{border:1px solid rgba(126,152,255,.35);border-radius:6px;background:rgba(19,28,54,.9);color:#e6ebf8;font-size:12px;padding:5px 8px;outline:none;flex:0 1 320px;min-width:0}
.dsw{position:relative;width:38px;height:21px;border-radius:999px;background:rgba(126,152,255,.22);border:none;padding:0;cursor:pointer;transition:background .18s ease;flex-shrink:0}
.dsw::after{content:'';position:absolute;top:2px;left:2px;width:17px;height:17px;border-radius:50%;background:#cdd8ff;transition:transform .18s cubic-bezier(.22,1,.36,1),background .18s ease}
.dsw[data-on="1"]{background:linear-gradient(180deg,#4a68f5,#3a55e0)}
.dsw[data-on="1"]::after{transform:translateX(17px);background:#fff}
.dsw:disabled{opacity:.4;cursor:default}
.dsp-range{width:150px;accent-color:#4d6bfe;cursor:pointer}
.dsp-chip{font-size:12px;border:1px solid rgba(126,152,255,.35);border-radius:999px;padding:2px 10px;white-space:nowrap}
.dsp-pets{display:flex;gap:10px;flex-wrap:wrap}
.dsp-petcard{border:1px solid rgba(126,152,255,.22);border-radius:10px;background:rgba(19,28,54,.55);padding:8px 10px 6px;cursor:pointer;text-align:center;transition:border-color .15s ease,transform .15s ease,box-shadow .15s ease;min-width:64px}
.dsp-petcard:hover{border-color:rgba(126,152,255,.65);transform:translateY(-1px)}
.dsp-petcard[data-sel="1"]{border-color:#4d6bfe;box-shadow:0 0 0 1px #4d6bfe,0 4px 14px rgba(77,107,254,.28)}
.dsp-petname{font-size:11px;margin-top:4px;max-width:72px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsp-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:7px;vertical-align:1px;box-shadow:0 0 6px currentColor}
`;

    async function api(path, body) {
      const res = await fetch(API + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined);
      if (!res.ok) throw new Error(String(res.status));
      return res.json();
    }

    function Switch({ on, onChange, disabled, title }) {
      return h('button', {
        type: 'button', className: 'dsw', 'data-on': on ? '1' : '0', role: 'switch', 'aria-checked': !!on,
        disabled, title, onClick: () => onChange(!on),
      });
    }
    function Group(title, rows) {
      return h('div', { className: 'dsp-group' }, h('div', { className: 'dsp-gtitle' }, title), ...rows);
    }
    function Row(label, control, hint) {
      return h('div', { style: { display: 'contents' } },
        h('div', { className: 'dsp-row' },
          h('span', null, label, hint && h('div', { className: 'dsp-hint' }, hint)),
          control),
      );
    }

    function DesktopPetSection(props) {
      const scope = props.scope;
      const [snapshot, setSnapshot] = useState(() => scope.getSnapshot());
      const [status, setStatus] = useState(null);
      const [view, setView] = useState(null);
      const [flags, setFlags] = useState(null);
      const [pets, setPets] = useState([]);
      const [decorations, setDecorations] = useState([]);
      const [pathDraft, setPathDraft] = useState('');
      const [zoomDraft, setZoomDraft] = useState(null);
      const [busy, setBusy] = useState(false);

      useEffect(() => {
        if (document.getElementById(CSS_ID)) return;
        const s = document.createElement('style');
        s.id = CSS_ID;
        s.textContent = CSS;
        document.head.appendChild(s);
      }, []);
      useEffect(() => scope.subscribe(() => setSnapshot(scope.getSnapshot())), [scope]);
      const refresh = useCallback(() => {
        api('/status').then(setStatus).catch(() => setStatus(null));
        api('/state').then(setView).catch(() => {});
        api('/window').then((r) => r && r.window && setFlags(r.window)).catch(() => {});
      }, []);
      useEffect(() => { refresh(); const timer = setInterval(refresh, 3000); return () => clearInterval(timer); }, [refresh]);
      useEffect(() => {
        api('/pets').then(setPets).catch(() => {});
        api('/decorations').then(setDecorations).catch(() => {});
      }, []);

      const value = snapshot.status === 'ready' ? snapshot.value : undefined;
      const enabled = value?.enabled ?? true;
      const electronPath = value?.electronPath ?? '';
      useEffect(() => { setPathDraft(electronPath); }, [electronPath]);

      const act = (fn) => {
        setBusy(true);
        Promise.resolve().then(fn).catch(() => {}).then(() => { setBusy(false); refresh(); });
      };
      const setWin = (patch) => act(async () => { const r = await api('/window', patch); if (r && r.window) setFlags(r.window); });

      let statusText = '未知', statusColor = '#9db4ff';
      if (status && status.running) { statusText = '运行中'; statusColor = '#6ee7b7'; }
      else if (status && status.quitIntent) { statusText = '已退出（点「立即启动」找回）'; statusColor = '#fbbf24'; }
      else if (status && !status.electronFound) { statusText = '未找到 electron 运行时'; statusColor = '#f87171'; }
      else if (status) { statusText = '已停止'; statusColor = '#fbbf24'; }

      const aff = view ? view.affinity : null;
      const currentPet = view && view.pet ? view.pet.id : '';
      const currentDeco = view && view.decoration ? view.decoration.id : 'none';
      const zoom = zoomDraft ?? (flags ? flags.zoom : 1);
      const ready = snapshot.status === 'ready';

      return h('div', { className: 'dsp-card' },
        Group('运行', [
          h('div', { className: 'dsp-row' },
            h('span', null,
              h('span', { className: 'dsp-dot', style: { background: statusColor, color: statusColor } }),
              h('b', null, statusText),
              status && status.running ? h('span', { style: { opacity: .55, fontSize: 12 } }, ' · pid ' + status.pid) : null,
              aff && h('span', { className: 'dsp-chip', style: { marginLeft: 10 } },
                (aff.rankEmoji || '') + ' ' + aff.rank + ' · ' + aff.points + ' 点 · 小鱼干 ' + (view.treats ? view.treats.stocked : 0) + '/' + (view.treats ? view.treats.max : 20))),
            h('span', { style: { display: 'flex', gap: 8 } },
              h('button', { className: 'dsp-btn', disabled: busy || !!(status && status.running), onClick: () => act(() => api('/start', {})) }, '立即启动'),
              h('button', { className: 'dsp-btn dsp-btnGhost', disabled: busy || !(status && status.running), onClick: () => act(() => api('/stop', {})) }, '停止'),
            ),
          ),
          Row('随 harness 自动启动', h(Switch, {
            on: enabled, disabled: !ready || busy, onChange: (v) => act(() => scope.set('enabled', v)),
          }), '摸头 +1、喂食 +5、完成对话 +1；亲密度永不衰减。拖到屏幕边缘会吸附钉住，气泡与卡片自动翻转不被裁切。'),
        ]),
        Group('窗口', flags ? [
          Row('窗口置顶', h(Switch, { on: !!flags.topmost, disabled: busy, onChange: (v) => setWin({ topmost: v }) })),
          Row('鼠标穿透', h(Switch, { on: !!flags.clickThrough, disabled: busy, onChange: (v) => setWin({ clickThrough: v }) }),
            '开启后她不再响应任何鼠标（含右键菜单）。如果点不到她了，回到这里关掉即可。'),
          Row('收起桌宠', h(Switch, { on: !!flags.hidden, disabled: busy, onChange: (v) => setWin({ hidden: v }) }),
            '收起后屏幕角落只留一枚小召唤钮。'),
          Row(h('span', null, '大小 ', h('span', { className: 'dsp-chip' }, Math.round(zoom * 100) + '%')),
            h('input', {
              type: 'range', className: 'dsp-range', min: 50, max: 250, step: 5, value: Math.round(zoom * 100),
              onMouseUp: () => { if (zoomDraft != null) { setWin({ zoom: zoomDraft }); setZoomDraft(null); } },
              onKeyUp: () => { if (zoomDraft != null) { setWin({ zoom: zoomDraft }); setZoomDraft(null); } },
              onTouchEnd: () => { if (zoomDraft != null) { setWin({ zoom: zoomDraft }); setZoomDraft(null); } },
              onChange: (e) => setZoomDraft(Number(e.target.value) / 100),
            })),
        ] : [h('div', { className: 'dsp-hint' }, '读取窗口状态…')]),
        Group('形象', [
          pets.length
            ? h('div', { className: 'dsp-pets' }, pets.map((p) => {
              const s = 48 / (p.cell && p.cell.height ? p.cell.height : 160);
              return h('button', {
                type: 'button', key: p.id, className: 'dsp-petcard', 'data-sel': p.id === currentPet ? '1' : '0',
                disabled: busy, title: p.description || p.displayName,
                onClick: () => act(() => api('/set-pet', { petId: p.id })),
              },
                h('div', {
                  style: {
                    width: Math.max(36, Math.round((p.cell ? p.cell.width : 192) * s)), height: 48, margin: '0 auto',
                    backgroundImage: 'url(' + p.atlasUrl + ')', backgroundRepeat: 'no-repeat',
                    backgroundSize: ((p.columns || 8) * (p.cell ? p.cell.width : 192) * s) + 'px ' + ((p.atlasRows || 9) * (p.cell ? p.cell.height : 208) * s) + 'px',
                  },
                }),
                h('div', { className: 'dsp-petname' }, p.displayName));
            }))
            : h('div', { className: 'dsp-hint', style: { color: '#fbbf24' } }, '未发现宠物：把 Codex 格式宠物目录放进 ~/.codex/pets，重启 harness 后即可选择'),
          Row('装扮', h('select', {
            className: 'dsp-select', value: currentDeco, disabled: busy,
            onChange: (e) => act(() => api('/set-decoration', { decorationId: e.target.value })),
          },
            h('option', { value: 'none' }, '无装扮'),
            decorations.map((d) => h('option', { key: d.id, value: d.id }, d.displayName || d.id)))),
        ]),
        Group('高级', [
          h('div', { className: 'dsp-row' },
            h('input', {
              className: 'dsp-input', value: pathDraft, placeholder: 'electron.exe 完整路径；留空自动查找（DSH_PET_ELECTRON / 本包 node_modules / 全局 npm）',
              onChange: (e) => setPathDraft(e.target.value),
            }),
            h('button', { className: 'dsp-btn', disabled: busy || !ready || pathDraft === electronPath, onClick: () => act(() => scope.set('electronPath', pathDraft.trim())) }, '保存'),
          ),
          status && !status.electronFound && h('div', { className: 'dsp-hint', style: { color: '#f87171' } },
            '装一个 electron（任意项目 npm i electron，或 npm i -g electron）后把 electron.exe 的完整路径填到上面即可。'),
        ]),
      );
    }

    function apply(ctx) {
      const binder = (ctx.get && ctx.get('webUiSettings')) || ctx.settingsScope;
      const scope = binder.bind({ namespace: 'petDesktop' });
      ctx.slots.inject('settings.section', () => {
        try {
          const unregister = ctx.slots.register({
            name: 'settings.section',
            id: 'pet-desktop',
            order: 131,
            label: () => '桌面宠物',
            inject: () => ({ scope }),
          }, DesktopPetSection);
          return () => unregister();
        } catch {
          return () => {};
        }
      });
    }

    exports.name = 'pet-desktop';
    exports.inject = ['slots', 'settingsScope'];
    exports.apply = apply;
    return exports;
  },
});
