// 用最小 DOM 桩在 Node 里跑一遍游戏逻辑,抓运行时错误
const fs = require('fs');
const vm = require('vm');

const noop = () => {};
function mkCtx() {
  return new Proxy({}, {
    get(t, k) {
      if (k === 'canvas') return null;
      if (['fillStyle','strokeStyle','font','textAlign','globalAlpha','lineWidth',
           'imageSmoothingEnabled'].includes(k)) return t[k];
      return noop;
    },
    set(t, k, v) { t[k] = v; return true; }
  });
}

// --- 元素桩:记录事件监听器,方便后面派发合成事件 ---
const elems = {};
function mkEl(id) {
  const cls = new Set();
  const listeners = {};
  return {
    id, width: 0, height: 0, dataset: {},
    style: { _v: {}, setProperty(k, v) { this._v[k] = v; }, getPropertyValue(k) { return this._v[k] || ''; } },
    _text: '', disabled: false, innerHTML: '', _rect: { left: 0, top: 0, width: 448, height: 448 },
    get textContent() { return this._text; },
    set textContent(v) { this._text = String(v); },
    getContext: mkCtx,
    getBoundingClientRect() { return this._rect; },
    classList: {
      add: c => cls.add(c), remove: c => cls.delete(c), contains: c => cls.has(c),
      toggle: (c, on) => { on ? cls.add(c) : cls.delete(c); }, _set: cls
    },
    appendChild: noop, insertAdjacentHTML: noop,
    addEventListener(t, fn) { (listeners[t] = listeners[t] || []).push(fn); },
    removeEventListener: noop,
    querySelectorAll: () => [],
    _fire(t, ev) { (listeners[t] || []).forEach(f => f(ev || {})); return (listeners[t] || []).length; },
    _has(t) { return !!(listeners[t] && listeners[t].length); }
  };
}

const body = mkEl('body');
const docEl = mkEl('html');
docEl.scrollHeight = 0;
const dpadButtons = [
  Object.assign(mkEl('up'), { dataset: { d: '0,-1' } }),
  Object.assign(mkEl('left'), { dataset: { d: '-1,0' } }),
  Object.assign(mkEl('down'), { dataset: { d: '0,1' } }),
  Object.assign(mkEl('right'), { dataset: { d: '1,0' } })
];
const document = {
  body, documentElement: docEl,
  createElement: mkEl,
  getElementById: id => (elems[id] = elems[id] || mkEl(id)),
  addEventListener: (ev, fn) => { document['_' + ev] = fn; },
  querySelectorAll: sel => (sel === '#dpad button' ? dpadButtons : [])
};

const win = {
  innerWidth: 1440, innerHeight: 900,
  matchMedia: () => ({ matches: false }),
  addEventListener: noop, removeEventListener: noop,
  AudioContext: null
};
const sandbox = {
  document, console, window: win, navigator: { maxTouchPoints: 0 },
  performance: { now: () => Date.now() },
  requestAnimationFrame: noop,
  setTimeout: noop, clearTimeout: noop, setInterval: noop, clearInterval: noop,
  getComputedStyle: el => el.style,
  localStorage: {
    _d: {},
    getItem(k) { return this._d[k] ?? null; },
    setItem(k, v) { this._d[k] = v; }
  },
  Date, Math, JSON, String, Number, Object, Set, Array, isNaN, parseInt
};
sandbox.window.getComputedStyle = sandbox.getComputedStyle;
// 面板 id 在浏览器里是隐式全局,这里用 Proxy 兜住
const ctxObj = vm.createContext(new Proxy(sandbox, {
  has: () => true,
  get(t, k) {
    if (k in t) return t[k];
    if (typeof k === 'string' && /^[a-zA-Z]/.test(k)) return document.getElementById(k);
    return undefined;
  }
}));

const html = fs.readFileSync(__dirname + '/魔塔-拯救公主.html', 'utf-8');
const src = html.match(/<script>\n([\s\S]*)\n<\/script>/)[1];
vm.runInContext(src, ctxObj);
const g = k => vm.runInContext(k, ctxObj);
const cv = document.getElementById('cv');

let fails = 0;
function ok(name, fn) {
  try { fn(); console.log('  ✓', name); }
  catch (e) { fails++; console.log('  ✗', name, '=>', e.message); }
}
function assert(c, m) { if (!c) throw new Error(m); }

console.log('=== 逻辑冒烟测试 ===');
ok('初始化完成', () => assert(g('pos').f === 0, '起点不在 1 层'));
ok('render 不抛错', () => vm.runInContext('render()', ctxObj));
ok('走一步', () => vm.runInContext('closeIntro(); move(1,0); move(0,1);', ctxObj));
ok('手册渲染(全塔)', () => vm.runInContext('hasManual=true; manTab=1; renderManual();', ctxObj));
ok('手册渲染(本层)', () => vm.runInContext('manTab=0; renderManual();', ctxObj));
ok('商店开合', () => vm.runInContext('st.gold=999; openShop(); buy(1); hide("shop");', ctxObj));
ok('传送面板', () => vm.runInContext('hasTele=true; openTele(); hide("tele");', ctxObj));
ok('存/读档往返', () => {
  vm.runInContext('st.atk=77; saveGame(1); st.atk=1; loadGame(1);', ctxObj);
  assert(g('st').atk === 77, '读档后属性不一致');
});
ok('死亡流程', () => vm.runInContext('st.hp=1; die("测试"); ', ctxObj));
ok('伤害公式:特性生效', () => {
  vm.runInContext('dead=false; st={hp:5000,atk:100,def:50,gold:0,yk:9,bk:9,rk:9};', ctxObj);
  const base = g('calcDmg(4)'), dbl = g('calcDmg(3)'), mag = g('calcDmg(5)'), drn = g('calcDmg(11)');
  assert([base, dbl, mag, drn].every(v => v !== null), '返回 null');
  assert(drn >= 5000 * 0.15, '吸血未生效');
  console.log('    骷髅兵', base, '/ 小蝙蝠', dbl, '/ 幽灵', mag, '/ 吸血鬼', drn);
});
ok('打不动的怪返回 null', () => {
  vm.runInContext('st.atk=5;', ctxObj);
  assert(g('calcDmg(14)') === null, '应为 null');
});
ok('全塔怪物均有合法数据', () => {
  const MON = g('MON');
  for (const k of Object.keys(MON)) {
    const m = MON[k];
    assert(m.length === 6 && Array.isArray(m[5]), '第 ' + k + ' 项结构错误');
    for (const a of m[5]) assert(g('ABIL')[a], '未知特性 ' + a);
  }
});
ok('重开游戏', () => vm.runInContext('newGame();', ctxObj));

console.log('\n=== 响应式布局 ===');
const WSTEP = g('WSTEP');
function layoutAt(w, h) {
  win.innerWidth = w; win.innerHeight = h;
  vm.runInContext('fitLayout()', ctxObj);
  return {
    cw: parseInt(docEl.style.getPropertyValue('--cw'), 10),
    mode: [...docEl.classList._set], // 占位,真正的类在 body 上
    cls: [...body.classList._set]
  };
}
const cases = [
  ['iPhone 竖屏 390x844', 390, 844, 'stack'],
  ['iPhone SE 竖屏 360x640', 360, 640, 'stack'],
  ['iPhone 横屏 844x390', 844, 390, 'land'],
  ['iPad 竖屏 820x1180', 820, 1180, null],
  ['iPad 横屏 1180x820', 1180, 820, null],
  ['iPad mini 竖屏 744x1133', 744, 1133, 'stack'],
  ['桌面 1440x900', 1440, 900, null]
];
for (const [name, w, h, want] of cases) {
  ok(name, () => {
    const r = layoutAt(w, h);
    assert(WSTEP.includes(r.cw), `--cw=${r.cw} 不是整数倍档位`);
    assert(r.cw % 11 === 0 && (r.cw / 11) % 8 === 0, `每格 ${r.cw / 11}px,精灵放大非整数倍`);
    const box = r.cw + 8;
    if (r.cls.includes('stack')) assert(box <= w - 20, `竖排时地图 ${box} 宽于屏幕 ${w}`);
    else assert(box <= w - 200, `分栏时地图 ${box} 挤掉了侧栏`);
    assert(box <= h - 16 || r.cls.includes('stack'), `地图 ${box} 高于屏幕 ${h}`);
    if (want) assert(r.cls.includes(want), `期望 ${want} 模式,实际 ${r.cls.join('+') || '(无)'}`);
    else assert(!r.cls.includes('stack') && !r.cls.includes('land'), '不该进小屏模式');
    console.log(`    ${r.cls.filter(c => c !== 'touch').join('+') || '分栏'} · 地图 ${box}px · 每格 ${r.cw / 11}px`);
  });
}
ok('小屏一定显示方向键', () => {
  layoutAt(390, 844);
  assert(body.classList.contains('showpad'), '竖屏手机未显示方向键');
  layoutAt(844, 390);
  assert(body.classList.contains('showpad'), '横屏手机未显示方向键');
});

console.log('\n=== 触摸操作 ===');
function touch(x, y) { return { clientX: x, clientY: y }; }
// 出生点紧挨着仙子,朝右走会触发对话而不是移动 —— 手势测试挪到一段空走廊上
function fresh() { vm.runInContext('restart(); closeIntro(); pos={f:0,r:8,c:2}; buildBg();', ctxObj); }
ok('canvas 绑定了触摸事件', () => {
  ['touchstart', 'touchmove', 'touchend'].forEach(t => assert(cv._has(t), '缺少 ' + t));
});
ok('滑动走路', () => {
  fresh();
  const before = { ...g('pos') };
  cv._fire('touchstart', { touches: [touch(100, 100)] });
  cv._fire('touchmove', { touches: [touch(140, 100)], preventDefault: noop });
  cv._fire('touchend', { changedTouches: [touch(140, 100)] });
  const after = g('pos');
  assert(after.c !== before.c || after.r !== before.r, '滑动没有移动勇者');
  console.log(`    (${before.r},${before.c}) → (${after.r},${after.c})`);
});
ok('滑一段连走多格', () => {
  fresh();
  const before = { ...g('pos') };
  cv._fire('touchstart', { touches: [touch(60, 100)] });
  for (let i = 1; i <= 3; i++) cv._fire('touchmove', { touches: [touch(60 + i * 40, 100)], preventDefault: noop });
  cv._fire('touchend', { changedTouches: [touch(180, 100)] });
  const after = g('pos');
  assert(Math.abs(after.c - before.c) >= 2, `只走了 ${Math.abs(after.c - before.c)} 格`);
  console.log(`    走了 ${Math.abs(after.c - before.c)} 格`);
});
ok('轻点格子走一步', () => {
  fresh();
  const p = g('pos');
  const cell = (cv._rect.width - 8) / 11;
  const tx = 4 + (p.c + 3) * cell + cell / 2, ty = 4 + p.r * cell + cell / 2;
  cv._fire('touchstart', { touches: [touch(tx, ty)] });
  cv._fire('touchend', { changedTouches: [touch(tx, ty)] });
  const after = g('pos');
  assert(after.c === p.c + 1 && after.r === p.r, `点击后到了 (${after.r},${after.c}),应只走一步`);
});
ok('覆盖层打开时手势失效', () => {
  vm.runInContext('newGame();', ctxObj); // intro 默认开着
  const before = { ...g('pos') };
  cv._fire('touchstart', { touches: [touch(100, 100)] });
  cv._fire('touchmove', { touches: [touch(160, 100)], preventDefault: noop });
  cv._fire('touchend', { changedTouches: [touch(160, 100)] });
  const after = g('pos');
  assert(after.c === before.c && after.r === before.r, '弹窗开着还能走');
});
ok('方向键按下即走', () => {
  fresh();
  const before = { ...g('pos') };
  const fired = dpadButtons[3]._fire('pointerdown', { preventDefault: noop, pointerId: 1 });
  assert(fired > 0, '方向键没有绑定 pointerdown');
  const after = g('pos');
  assert(after.c !== before.c || after.r !== before.r, '按方向键没有移动');
});
ok('滑向仙子会触发对话而不是穿过去', () => {
  vm.runInContext('restart(); closeIntro(); pos={f:0,r:9,c:1}; buildBg();', ctxObj);
  cv._fire('touchstart', { touches: [touch(100, 100)] });
  cv._fire('touchmove', { touches: [touch(150, 100)], preventDefault: noop });
  cv._fire('touchend', { changedTouches: [touch(150, 100)] });
  assert(g('pos').c === 1, '把仙子当成空地走过去了');
  assert(g('hasManual') === true, '没有拿到怪物手册');
});
ok('多指触摸不误触', () => {
  fresh();
  const before = { ...g('pos') };
  cv._fire('touchstart', { touches: [touch(100, 100), touch(200, 200)] });
  cv._fire('touchmove', { touches: [touch(160, 100), touch(260, 200)], preventDefault: noop });
  cv._fire('touchend', { changedTouches: [touch(160, 100)] });
  const after = g('pos');
  assert(after.c === before.c && after.r === before.r, '双指缩放被当成了移动');
});

console.log(fails ? `\n${fails} 项失败` : '\n全部通过');
process.exit(fails ? 1 : 0);
