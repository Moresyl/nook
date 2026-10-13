export type SettingsDraftSource = 'models' | 'desktop' | 'worktrees' | 'mcp' | 'plugins' | 'memories';

export function updateSettingsActivity(current: ReadonlySet<SettingsDraftSource>, source: SettingsDraftSource, active: boolean): ReadonlySet<SettingsDraftSource> {
  if (current.has(source) === active) return current;
  const next = new Set(current);
  if (active) next.add(source); else next.delete(source);
  return next;
}
