import type { BrowserState } from '../../contracts/browser';

export type BrowserTab = { state: BrowserState; address: string; pending: boolean; error: string | null };
export type BrowserWorkspace = { tabs: BrowserTab[]; active: string | null; error: string | null };
export type BrowserTabsAction =
  | { type: 'created'; state: BrowserState; activate: boolean }
  | { type: 'received'; state: BrowserState }
  | { type: 'selected'; token: string }
  | { type: 'removed'; token: string }
  | { type: 'submitted'; token: string; preserveAddress?: boolean }
  | { type: 'edited'; token: string; address: string }
  | { type: 'failed'; token: string; message: string }
  | { type: 'open-failed'; message: string };

export function reduceBrowserTabs(workspace: BrowserWorkspace, action: BrowserTabsAction): BrowserWorkspace {
  if (action.type === 'open-failed') return { ...workspace, error: action.message };
  if (action.type === 'created') {
    const existing = workspace.tabs.find(tab => tab.state.token === action.state.token);
    const next = existing ? reduceBrowserTabs(workspace, { type: 'received', state: action.state }) : { ...workspace, tabs: [...workspace.tabs, { state: action.state, address: action.state.url, pending: false, error: null }] };
    return { ...next, active: action.activate || !next.active ? action.state.token : next.active, error: null };
  }
  const token = action.type === 'received' ? action.state.token : action.token, index = workspace.tabs.findIndex(tab => tab.state.token === token);
  if (index < 0) return workspace;
  if (action.type === 'selected') return { ...workspace, active: token, error: null };
  if (action.type === 'removed') {
    const tabs = workspace.tabs.filter(tab => tab.state.token !== token);
    return { ...workspace, tabs, active: workspace.active === token ? tabs[Math.min(index, tabs.length - 1)]?.state.token ?? null : workspace.active, error: null };
  }
  const current = workspace.tabs[index]; let next: BrowserTab;
  if (action.type === 'received') {
    if (action.state.sequence <= current.state.sequence) return workspace;
    const updateAddress = action.state.url !== current.state.url || (current.pending && !action.state.loading);
    next = { ...current, state: action.state, address: updateAddress ? action.state.url : current.address, pending: current.pending && action.state.loading };
  } else if (action.type === 'edited') next = { ...current, address: action.address, pending: false };
  else if (action.type === 'submitted') next = { ...current, pending: !action.preserveAddress, error: null };
  else next = { ...current, pending: false, error: action.message };
  return { ...workspace, tabs: workspace.tabs.map((tab, position) => position === index ? next : tab) };
}
