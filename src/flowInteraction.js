// Delegated events survive SVG replacement; dispose before rebinding or unmounting.
export function bindFlowInteraction(container, translate = value => value) {
  if (!container) return () => {};
  const doc = container.ownerDocument;
  const tip = doc.createElement('div');
  tip.className = 'flow-tooltip';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  doc.body.append(tip);
  let active = null;
  const elements = () => [...container.querySelectorAll('[data-flow-id]')];
  function clear() {
    container.classList.remove('flow-has-hover');
    elements().forEach(el => el.classList.remove('flow-highlight'));
    tip.hidden = true;
    active = null;
  }
  function position(event) {
    const rect = active.getBoundingClientRect();
    const x = Number.isFinite(event.clientX) ? event.clientX : rect.left + rect.width / 2;
    const y = Number.isFinite(event.clientY) ? event.clientY : rect.top + rect.height / 2;
    const win = doc.defaultView;
    tip.style.left = Math.max(8, Math.min(x + 14, win.innerWidth - tip.offsetWidth - 8)) + 'px';
    tip.style.top = Math.max(8, Math.min(y + 14, win.innerHeight - tip.offsetHeight - 8)) + 'px';
  }
  function show(event) {
    const el = event.target.closest?.('[data-flow-id]');
    if (!el || !container.contains(el)) { clear(); return; }
    if (el !== active) {
      clear(); active = el;
      const data = el.dataset;
      const ids = new Set([data.flowId, data.source, data.target].filter(Boolean));
      const links = elements().filter(item => item.dataset.source &&
        (item === el || (!data.source && (item.dataset.source === data.flowId || item.dataset.target === data.flowId))));
      links.forEach(item => { ids.add(item.dataset.source); ids.add(item.dataset.target); });
      container.classList.add('flow-has-hover');
      elements().forEach(item => item.classList.toggle('flow-highlight', item === el || links.includes(item) || ids.has(item.dataset.flowId)));
      const title = doc.createElement('strong');
      title.textContent = data.title;
      const amount = doc.createElement('span');
      const value = Number(data.value), total = Number(data.total);
      amount.textContent = '¥' + value.toLocaleString('zh-CN', {minimumFractionDigits: 2, maximumFractionDigits: 2});
      const percent = doc.createElement('span');
      percent.textContent = translate('Share of capacity') + ': ' + (total > 0 ? (value / total * 100).toFixed(1) + '%' : '—');
      tip.replaceChildren(title, amount, percent);
      tip.hidden = false;
    }
    position(event);
  }
  const keydown = event => { if (event.key === 'Escape') clear(); };
  const events = { pointermove: show, pointerdown: show, pointerleave: clear, focusin: show, focusout: clear, keydown };
  Object.entries(events).forEach(([name, handler]) => container.addEventListener(name, handler));
  doc.defaultView.addEventListener('scroll', clear, true);
  return () => {
    clear(); tip.remove();
    Object.entries(events).forEach(([name, handler]) => container.removeEventListener(name, handler));
    doc.defaultView.removeEventListener('scroll', clear, true);
  };
}
