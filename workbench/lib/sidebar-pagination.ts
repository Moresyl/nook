export function observeSidebarPage(target: HTMLElement, onVisible: () => void): () => void {
  if (typeof IntersectionObserver === 'undefined') return () => {};
  let active = true;
  const document = target.ownerDocument;
  const observer = new IntersectionObserver(entries => {
    if (!active || !entries.some(entry => entry.target === target && entry.isIntersecting)) return;
    if (!target.isConnected || target.ownerDocument.hidden || target.closest('[inert], [hidden]') || target.contains(target.ownerDocument.activeElement)) return;
    active = false;
    observer.disconnect();
    document.removeEventListener('visibilitychange', retry);
    onVisible();
  });
  const retry = () => { if (active && !document.hidden) { observer.disconnect(); observer.observe(target); } };
  document.addEventListener('visibilitychange', retry);
  observer.observe(target);
  return () => { active = false; observer.disconnect(); document.removeEventListener('visibilitychange', retry); };
}
