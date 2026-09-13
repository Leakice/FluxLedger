// Shared test environment for Node-run browser code: registers the Vue SFC
// loader and copies a happy-dom window onto globalThis so src/App.vue can be
// imported and mounted under `node --test` without a bundler.
import { register } from 'node:module';
import { Window } from 'happy-dom';

export function registerVueLoader() {
  if (globalThis.__fluxVueLoaderRegistered) return;
  globalThis.__fluxVueLoaderRegistered = true;
  register('./vue-loader.mjs', import.meta.url);
}

function defineGlobal(key, value) {
  if (value === undefined) return;
  try {
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  } catch {
    // Node owns some globals (navigator, crypto, fetch); keep those as-is.
  }
}

export function setupDom() {
  if (globalThis.__fluxDomReady) return;
  globalThis.__fluxDomReady = true;
  const window = new Window({ url: 'https://localhost/' });
  const keys = [
    'window', 'document', 'navigator', 'location', 'history', 'screen',
    'Document', 'HTMLElement', 'Element', 'Node', 'Text', 'SVGElement', 'SVGGraphicsElement',
    'DocumentFragment', 'ShadowRoot', 'CSSStyleDeclaration',
    'HTMLDialogElement', 'HTMLInputElement', 'HTMLSelectElement', 'HTMLAnchorElement',
    'HTMLTextAreaElement', 'HTMLFormElement', 'HTMLButtonElement', 'HTMLDivElement',
    'Event', 'CustomEvent', 'InputEvent', 'KeyboardEvent', 'MouseEvent', 'PointerEvent',
    'FocusEvent', 'UIEvent', 'EventTarget',
    'MutationObserver', 'ResizeObserver', 'IntersectionObserver',
    'requestAnimationFrame', 'cancelAnimationFrame',
    'getComputedStyle', 'matchMedia',
    'localStorage', 'sessionStorage',
    'customElements', 'DOMParser', 'XMLSerializer',
    'File', 'FileList', 'FormData',
  ];
  for (const key of keys) defineGlobal(key, window[key]);
  if (window.ResizeObserver === undefined) {
    defineGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  }
  if (window.HTMLDialogElement && !window.HTMLDialogElement.prototype.showModal) {
    window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
    window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  }
  // Export creates a temporary <a download> and clicks it; a real click would
  // send happy-dom navigating to a blob: URL. Tests capture the Blob through a
  // URL.createObjectURL stub instead, so anchor clicks are dropped entirely.
  if (window.HTMLAnchorElement) window.HTMLAnchorElement.prototype.click = function () {};
}

// String-only storage emulation matching browser localStorage semantics:
// values are coerced to strings, missing keys read back as null.
export class MapStorage {
  constructor(initial = {}) {
    this.map = new Map(Object.entries(initial));
  }
  getItem(key) {
    return this.map.has(key) ? this.map.get(key) : null;
  }
  setItem(key, value) {
    this.map.set(key, String(value));
  }
  removeItem(key) {
    this.map.delete(key);
  }
  clear() {
    this.map.clear();
  }
  key(index) {
    return [...this.map.keys()][index] ?? null;
  }
  get length() {
    return this.map.size;
  }
}
