import { useEffect, useState } from 'react';
import type { Workspace } from '../../contracts/workspace';
import { desktopPreferencesSchema, type DesktopPreferences, type DesktopState } from '../../contracts/desktop-integration';
import { Button, Field, Input, Select, Toggle } from '../components/controls';
import { useSettingsDraft } from '../components/settings-drafts';

type Props = { state: Workspace; onState: (state: Workspace) => void; report: (error: unknown) => void };
export function DesktopSettings({ state, onState, report }: Props) {
  const settings = desktopPreferencesSchema.parse(state.preferences.desktop ?? {});
  const [accelerator, setAccelerator] = useState(settings.accelerator); const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<DesktopState>({ trayEnabled: false, shortcutRegistered: false });
  const valid = desktopPreferencesSchema.safeParse({ ...settings, accelerator }).success;
  useSettingsDraft('desktop', accelerator !== settings.accelerator, busy);
  useEffect(() => { setAccelerator(settings.accelerator); }, [settings.accelerator]);
  useEffect(() => { let active = true; void window.qiyao.desktopState().then((value) => { if (active) setStatus(value); }).catch(() => {}); return () => { active = false; }; }, [state.preferences.desktop]);
  async function save(desktop: DesktopPreferences) {
    setBusy(true);
    try { onState(await window.qiyao.savePreferences({ ...state.preferences, desktop })); }
    catch { report(new Error('桌面设置未能应用。请检查磁盘空间、托盘和快捷键占用后重试。')); }
    finally { try { setStatus(await window.qiyao.desktopState()); } catch {} setBusy(false); }
  }
  return <section className="desktop-settings" aria-label="桌面入口"><h4>桌面入口</h4>
    <Toggle label="显示系统托盘" disabled={busy} checked={settings.trayEnabled} onChange={(trayEnabled) => { void save({ ...settings, trayEnabled, closeToTray: trayEnabled && settings.closeToTray }); }} />
    <Toggle label="关闭窗口后保持运行" disabled={busy || !settings.trayEnabled} checked={settings.closeToTray} onChange={(closeToTray) => { void save({ ...settings, closeToTray }); }} />
    <p className="field-hint">开启后，关闭窗口会先保存草稿，再收起到托盘；自动计划继续运行。选择托盘中的“退出 Nook”可停止任务并退出。</p>
    <Toggle label={settings.shortcutTarget === 'quick-chat' ? '全局快捷键唤起快速聊天' : '全局快捷键唤起工作台'} disabled={busy || (!settings.shortcutEnabled && !valid)} checked={settings.shortcutEnabled} onChange={(shortcutEnabled) => { void save({ ...settings, shortcutEnabled, accelerator: shortcutEnabled ? accelerator : settings.accelerator }); }} />
    <Field label="快捷键打开"><Select disabled={busy} value={settings.shortcutTarget ?? 'workbench'} onChange={event => { void save({ ...settings, shortcutTarget: event.target.value as 'workbench' | 'quick-chat' }); }}><option value="workbench">工作台</option><option value="quick-chat">快速聊天</option></Select></Field>
    <Field label="唤起快捷键" hint="例如 Ctrl+Alt+Space 或 Ctrl+Shift+F12。快捷键被其他软件占用时，原有设置会保留。"><Input disabled={busy} value={accelerator} maxLength={80} aria-invalid={!valid} onChange={(event) => setAccelerator(event.target.value)} /></Field>
    <Button disabled={busy || !valid || accelerator === settings.accelerator} onClick={() => { void save({ ...settings, accelerator }); }}>应用快捷键</Button>
    <p className="field-hint" role="status">{status.trayEnabled ? '托盘已启用' : '托盘未启用'} · {status.shortcutRegistered ? '快捷键已注册' : '快捷键未注册'}</p>
    {status.error && <p className="field-hint">桌面入口未能完整应用，请检查设置后重试。窗口仍可正常退出。</p>}
  </section>;
}
