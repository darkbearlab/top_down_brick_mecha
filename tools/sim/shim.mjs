// 最小的假瀏覽器環境：遊戲模組在載入時會碰到的 document / window / canvas / localStorage / AudioContext
const noop = () => {};
const ctx2d = new Proxy({}, { get: (t, k) => k in t ? t[k] : (k === 'getImageData' || k === 'createImageData' ? (w = 1, h = 1) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }) : k === 'measureText' ? () => ({ width: 0 }) : noop), set: (t, k, v) => (t[k] = v, true) });
const el = () => {
  const e = {
    style: {}, dataset: {}, children: [], width: 300, height: 150, classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    appendChild: c => c, removeChild: noop, append: noop, remove: noop, addEventListener: noop, removeEventListener: noop, setAttribute: noop, getAttribute: () => null,
    querySelector: () => el(), querySelectorAll: () => [], getContext: () => ctx2d, getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }), getClientRects: () => [],
    animate: () => ({}), focus: noop, click: noop, set innerHTML(v) {}, get innerHTML() { return ''; }, textContent: '', offsetWidth: 0, offsetHeight: 0,
  };
  return e;
};
globalThis.window = globalThis;
globalThis.document = { createElement: el, getElementById: el, querySelector: () => el(), querySelectorAll: () => [], body: el(), documentElement: el(), addEventListener: noop, removeEventListener: noop, pointerLockElement: null, exitPointerLock: noop };
globalThis.addEventListener = noop; globalThis.removeEventListener = noop;
globalThis.innerWidth = 1280; globalThis.innerHeight = 720; globalThis.devicePixelRatio = 1;
globalThis.requestAnimationFrame = () => 0;
globalThis.localStorage = (() => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; })();
globalThis.getComputedStyle = () => ({});
Object.defineProperty(globalThis, 'navigator', { value: { getGamepads: () => [], userAgent: 'node' }, configurable: true });
globalThis.AudioContext = undefined;
// 假的 WebGLRenderer：只有遊戲在載入時會呼叫到的東西
globalThis.__fakeRenderer = () => new Proxy({ domElement: el(), shadowMap: {}, capabilities: { isWebGL2: true }, info: { render: {} } }, { get: (t, k) => k in t ? t[k] : noop });
