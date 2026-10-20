export type SidebarSection = 'pinned' | 'recent';

const prefix = 'nook.sidebar.collapsed.';

export function readSidebarCollapsed(section: SidebarSection): boolean {
  try { return localStorage.getItem(`${prefix}${section}`) === 'true'; }
  catch { return false; }
}

export function saveSidebarCollapsed(section: SidebarSection, collapsed: boolean): void {
  try { localStorage.setItem(`${prefix}${section}`, String(collapsed)); }
  catch { /* Keep the current view usable when preference storage is unavailable. */ }
}
