/**
 * dsh-pet-desktop client half — the "桌面宠物" first-level settings section.
 * Reads/writes the plugin's own loopback API (/api/desktop-pet/*): auto-start
 * toggle, electron path, live status with start/stop, pet picker (Codex-format
 * registry), decoration picker, and the affinity chip.
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

    async function api(path, body) {
      const res = await fetch(API + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined);
      if (!res.ok) throw new Error(String(res.status));
      return res.json();
    }

    const cardStyle = { display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 640 };
    const rowStyle = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 };
    const hintStyle = { fontSize: 12, opacity: 0.6, lineHeight: 1.5 };
    const btnStyle = { border: '1px solid rgba(126,152,255,.45)', borderRadius: 8, padding: '5px 14px', fontSize: 13, cursor: 'pointer', color: '#e6ebf8', background: 'linear-gradient(180deg,#4a68f5,#3a55e0)' };
    const inputStyle = { flex: 1, minWidth: 0, border: '1px solid rgba(126,152,255,.35)', borderRadius: 6, background: 'rgba(19,28,54,.9)', color: '#e6ebf8', fontSize: 12, padding: '4px 8px', outline: 'none' };
    const selectStyle = { ...inputStyle, flex: '0 1 320px' };
    const chipStyle = { fontSize: 12, border: '1px solid rgba(126,152,255,.35)', borderRadius: 999, padding: '2px 10px' };

    function DesktopPetSection(props) {
      const scope = props.scope;
      const [snapshot, setSnapshot] = useState(() => scope.getSnapshot());
      const [status, setStatus] = useState(null);
      const [view, setView] = useState(null);
      const [pets, setPets] = useState([]);
      const [decorations, setDecorations] = useState([]);
      const [pathDraft, setPathDraft] = useState('');
      const [busy, setBusy] = useState(false);

      useEffect(() => scope.subscribe(() => setSnapshot(scope.getSnapshot())), [scope]);
      const refresh = useCallback(() => {
        api('/status').then(setStatus).catch(() => setStatus(null));
        api('/state').then(setView).catch(() => {});
      }, []);
      useEffect(() => { refresh(); const timer = setInterval(refresh, 4000); return () => clearInterval(timer); }, [refresh]);
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

      let statusText = '未知', statusColor = '#9db4ff';
      if (status && status.running) { statusText = '运行中（pid ' + status.pid + '）'; statusColor = '#6ee7b7'; }
      else if (status && status.quitIntent) { statusText = '已退出（点「立即启动」找回）'; statusColor = '#fbbf24'; }
      else if (status && !status.electronFound) { statusText = '未找到 electron 运行时'; statusColor = '#f87171'; }
      else if (status) { statusText = '已停止'; statusColor = '#fbbf24'; }

      const aff = view ? view.affinity : null;
      const currentPet = view && view.pet ? view.pet.id : '';
      const currentDeco = view && view.decoration ? view.decoration.id : 'none';

      return h('div', { style: cardStyle },
        h('div', { style: rowStyle },
          h('span', null, '随 harness 自动启动桌面宠物'),
          h('input', {
            type: 'checkbox', checked: enabled, disabled: snapshot.status !== 'ready' || busy,
            onChange: (e) => act(() => scope.set('enabled', e.target.checked)),
          }),
        ),
        h('div', { style: hintStyle },
          '桌宠直接订阅 harness 会话：摸头 +1（10s 冷却）、喂食 +5（消耗 1 小鱼干）、完成对话 +1；亲密度永不衰减。状态独立存储（desktop-pet.json），与网页端桌宠互不影响。'),
        h('div', { style: rowStyle },
          h('span', null, '当前状态：', h('span', { style: { color: statusColor, fontWeight: 600 } }, statusText),
            aff && h('span', { style: { ...chipStyle, marginLeft: 10 } }, (aff.rankEmoji || '') + ' ' + aff.rank + ' · ' + aff.points + ' 点 · 小鱼干 ' + (view.treats ? view.treats.stocked : 0) + '/' + (view.treats ? view.treats.max : 20))),
          h('span', { style: { display: 'flex', gap: 8 } },
            h('button', { style: btnStyle, disabled: busy || !!(status && status.running), onClick: () => act(() => api('/start', {})) }, '立即启动'),
            h('button', { style: btnStyle, disabled: busy || !(status && status.running), onClick: () => act(() => api('/stop', {})) }, '停止'),
          ),
        ),
        h('div', { style: rowStyle },
          h('span', { style: { flexShrink: 0 } }, '宠物'),
          pets.length
            ? h('select', {
              style: selectStyle, value: currentPet || (pets[0] ? pets[0].id : ''), disabled: busy,
              onChange: (e) => act(() => api('/set-pet', { petId: e.target.value })),
            }, pets.map((p) => h('option', { key: p.id, value: p.id }, p.displayName + '（' + p.id + '）')))
            : h('span', { style: { ...hintStyle, color: '#fbbf24' } }, '未发现宠物：把 Codex 格式宠物目录放进 ~/.codex/pets 或设置「额外宠物目录」'),
        ),
        h('div', { style: rowStyle },
          h('span', { style: { flexShrink: 0 } }, '装扮'),
          h('select', {
            style: selectStyle, value: currentDeco, disabled: busy,
            onChange: (e) => act(() => api('/set-decoration', { decorationId: e.target.value })),
          },
            h('option', { value: 'none' }, '无装扮'),
            decorations.map((d) => h('option', { key: d.id, value: d.id }, d.displayName || d.id))),
        ),
        h('div', { style: rowStyle },
          h('span', { style: { flexShrink: 0 } }, 'electron 路径'),
          h('input', { style: inputStyle, value: pathDraft, placeholder: '留空自动查找（DSH_PET_ELECTRON / 本包 node_modules / 全局 npm）', onChange: (e) => setPathDraft(e.target.value) }),
          h('button', { style: btnStyle, disabled: busy || pathDraft === electronPath, onClick: () => act(() => scope.set('electronPath', pathDraft.trim())) }, '保存'),
        ),
        status && !status.electronFound && h('div', { style: { ...hintStyle, color: '#f87171' } },
          '装一个 electron（任意项目 npm i electron，或 npm i -g electron）后把 electron.exe 的完整路径填到上面即可。'),
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
