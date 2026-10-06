import { rm } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { desktopPreferencesSchema } from '../contracts/desktop-integration';
import { emptyWorkspace, workspaceSchema } from '../contracts/workspace';
import { DesktopIntegration, type DesktopRuntime } from '../desktop/services/desktop-integration';
import { WorkspaceVault } from '../desktop/services/vault';
import { codec, testVault } from './fixtures';

const services: DesktopIntegration[] = []; const directories: string[] = [];
afterEach(async () => { await Promise.all(services.splice(0).map((service) => service.shutdown())); await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
async function setup() {
  const { vault, directory } = await testVault(); directories.push(directory);
  const shortcuts = new Map<string, () => void>(); const trays: { open: () => void; quit: () => void; destroy: ReturnType<typeof vi.fn> }[] = [];
  const runtime: DesktopRuntime = {
    createTray: vi.fn((actions) => { const tray = { ...actions, destroy: vi.fn() }; trays.push(tray); return tray; }),
    registerShortcut: vi.fn((key, callback) => { if (shortcuts.has(key)) return false; shortcuts.set(key, callback); return true; }),
    unregisterShortcut: vi.fn((key) => { shortcuts.delete(key); }), open: vi.fn(), quit: vi.fn(),
  };
  const service = new DesktopIntegration(vault, runtime); services.push(service);
  const preferences = (settings: Record<string, unknown> = {}) => ({ ...vault.snapshot().preferences, desktop: desktopPreferencesSchema.parse(settings) });
  return { vault, directory, runtime, shortcuts, trays, service, preferences };
}
describe('desktop integration contracts and lifecycle', () => {
  it('keeps legacy preferences optional, requires an enabled tray for background close and bounds shortcut syntax', () => {
    expect(workspaceSchema.parse(emptyWorkspace()).preferences.desktop).toBeUndefined(); expect(desktopPreferencesSchema.parse({})).toMatchObject({ trayEnabled: false, closeToTray: false, shortcutEnabled: false });
    for (const input of [{ closeToTray: true }, { accelerator: 'Alt+F4' }, { accelerator: 'Ctrl+Alt+Alt+A' }, { accelerator: 'Ctrl+Alt+space' }, { accelerator: 'Ctrl+Alt+F13' }, { unknown: true }]) expect(desktopPreferencesSchema.safeParse(input).success).toBe(false);
    expect(desktopPreferencesSchema.parse({ accelerator: ' Ctrl+Alt+Shift+F12 ' }).accelerator).toBe('Ctrl+Alt+Shift+F12');
    expect(desktopPreferencesSchema.parse({}).shortcutTarget).toBeUndefined(); expect(desktopPreferencesSchema.parse({ shortcutTarget: 'quick-chat' }).shortcutTarget).toBe('quick-chat');
    expect(desktopPreferencesSchema.safeParse({ shortcutTarget: 'unknown' }).success).toBe(false);
  });
  it('starts without desktop side effects and never hides without a working enabled tray', async () => {
    const { service, runtime } = await setup(); await service.refresh(); expect(service.state()).toEqual({ trayEnabled: false, shortcutRegistered: false }); expect(service.canHide()).toBe(false); expect(runtime.createTray).not.toHaveBeenCalled(); expect(runtime.registerShortcut).not.toHaveBeenCalled();
  });
  it('persists settings before activating tray/menu/hotkey callbacks, preserves other preferences and releases only its resources', async () => {
    const { service, preferences, vault, trays, shortcuts, runtime } = await setup(); shortcuts.set('Ctrl+Shift+F12', vi.fn());
    const saved = await service.savePreferences({ ...preferences({ trayEnabled: true, closeToTray: true, shortcutEnabled: true }), theme: 'dark' }); expect(saved.preferences.theme).toBe('dark'); expect(vault.snapshot().preferences.desktop?.closeToTray).toBe(true); expect(service.canHide()).toBe(true);
    trays[0].open(); trays[0].quit(); shortcuts.get('CommandOrControl+Alt+Space')!(); expect(runtime.open).toHaveBeenCalledTimes(2); expect(runtime.quit).toHaveBeenCalledOnce();
    await service.savePreferences(preferences()); expect(trays[0].destroy).toHaveBeenCalledOnce(); expect(shortcuts.has('CommandOrControl+Alt+Space')).toBe(false); expect(shortcuts.has('Ctrl+Shift+F12')).toBe(true); expect(service.canHide()).toBe(false);
    trays[0].open(); trays[0].quit(); expect(runtime.open).toHaveBeenCalledTimes(2); expect(runtime.quit).toHaveBeenCalledOnce();
  });
  it('reuses unchanged resources and invalidates stale shortcut callbacks after replacement', async () => {
    const { service, preferences, runtime, shortcuts } = await setup(); const input = preferences({ trayEnabled: true, shortcutEnabled: true }); await service.savePreferences(input); const stale = shortcuts.get('CommandOrControl+Alt+Space')!;
    await service.savePreferences({ ...input, enterToSend: false }); expect(runtime.createTray).toHaveBeenCalledOnce(); expect(runtime.registerShortcut).toHaveBeenCalledOnce();
    await service.savePreferences(preferences({ trayEnabled: true, shortcutEnabled: true, accelerator: 'Ctrl+Shift+F12' })); stale(); expect(runtime.open).not.toHaveBeenCalled(); shortcuts.get('Ctrl+Shift+F12')!(); expect(runtime.open).toHaveBeenCalledOnce();
  });
  it('rejects occupied shortcuts without saving or stealing registrations and destroys an uncommitted tray', async () => {
    const { service, preferences, vault, runtime, shortcuts, trays } = await setup(); const before = vault.snapshot(); shortcuts.set('CommandOrControl+Alt+Space', vi.fn());
    await expect(service.savePreferences(preferences({ trayEnabled: true, shortcutEnabled: true }))).rejects.toThrow('could not be enabled'); expect(vault.snapshot()).toEqual(before); expect(runtime.unregisterShortcut).not.toHaveBeenCalled(); expect(trays[0].destroy).toHaveBeenCalledOnce(); expect(service.state()).toMatchObject({ trayEnabled: false, shortcutRegistered: false, error: expect.any(String) });
  });
  it('redacts native failures, retains old resources on failed changes and retries after correction', async () => {
    const { service, preferences, runtime, shortcuts } = await setup(); await service.savePreferences(preferences({ trayEnabled: true, shortcutEnabled: true })); vi.mocked(runtime.registerShortcut).mockImplementationOnce(() => { throw new Error('PRIVATE_NATIVE_VALUE'); });
    await expect(service.savePreferences(preferences({ trayEnabled: true, shortcutEnabled: true, accelerator: 'Ctrl+Shift+F12' }))).rejects.toThrow('could not be enabled'); expect(service.state().error).not.toContain('PRIVATE_NATIVE_VALUE'); expect(shortcuts.has('CommandOrControl+Alt+Space')).toBe(true);
    await service.savePreferences(preferences({ trayEnabled: true, shortcutEnabled: true, accelerator: 'Ctrl+Shift+F12' })); expect(service.state().error).toBeUndefined();
  });
  it('leaves normal close available when startup cannot create the tray and accepts a later retry', async () => {
    const { service, preferences, vault, runtime } = await setup(); await vault.update((draft) => { draft.preferences = preferences({ trayEnabled: true, closeToTray: true }); }); vi.mocked(runtime.createTray).mockImplementationOnce(() => { throw new Error('PRIVATE_TRAY_PATH'); });
    await expect(service.refresh()).rejects.toThrow('could not be enabled'); expect(service.canHide()).toBe(false); expect(service.state().error).not.toContain('PRIVATE_TRAY_PATH'); await service.refresh(); expect(service.canHide()).toBe(true);
  });
  it('rolls back newly acquired resources on disk failure without dropping the old working shortcut', async () => {
    const { service, preferences, runtime, shortcuts, trays, vault } = await setup(); await service.savePreferences(preferences({ shortcutEnabled: true })); const original = vault.snapshot(); vi.spyOn(vault, 'updateSettings').mockRejectedValueOnce(new Error('PRIVATE_DISK_PATH'));
    await expect(service.savePreferences(preferences({ trayEnabled: true, shortcutEnabled: true, accelerator: 'Ctrl+Shift+F12' }))).rejects.toThrow('could not be saved'); expect(vault.snapshot()).toEqual(original); expect(shortcuts.has('CommandOrControl+Alt+Space')).toBe(true); expect(shortcuts.has('Ctrl+Shift+F12')).toBe(false); expect(trays[0].destroy).toHaveBeenCalledOnce(); expect(service.state().error).not.toContain('PRIVATE_DISK_PATH'); expect(runtime.open).not.toHaveBeenCalled();
  });
  it('serializes changes and keeps candidate callbacks inactive until persistence succeeds', async () => {
    const { service, preferences, vault, shortcuts, runtime, trays } = await setup(); const original = vault.updateSettings.bind(vault); let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
    vi.spyOn(vault, 'updateSettings').mockImplementationOnce(async (change) => { await gate; return original(change); }); const saving = service.savePreferences(preferences({ trayEnabled: true, shortcutEnabled: true })); await vi.waitFor(() => expect(trays).toHaveLength(1)); trays[0].open(); trays[0].quit(); shortcuts.get('CommandOrControl+Alt+Space')!(); expect(runtime.open).not.toHaveBeenCalled(); expect(runtime.quit).not.toHaveBeenCalled();
    const disabling = service.savePreferences(preferences()); release(); await saving; await disabling; expect(service.state()).toEqual({ trayEnabled: false, shortcutRegistered: false });
  });
  it('cancels candidates when shutdown begins during a save and rejects subsequent configuration work', async () => {
    const { service, preferences, vault, runtime, trays } = await setup(); const original = vault.updateSettings.bind(vault); let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
    vi.spyOn(vault, 'updateSettings').mockImplementationOnce(async (change) => { await gate; return original(change); }); const saving = service.savePreferences(preferences({ trayEnabled: true, closeToTray: true })); await vi.waitFor(() => expect(trays).toHaveLength(1)); const closing = service.shutdown(); release(); await saving; await closing; trays[0].open(); expect(runtime.open).not.toHaveBeenCalled(); expect(service.canHide()).toBe(false); expect(trays[0].destroy).toHaveBeenCalledOnce();
    await expect(service.savePreferences(preferences())).rejects.toThrow('closing'); await expect(service.refresh()).rejects.toThrow('closing');
  });
  it('restores saved configuration on restart and releases resources when backup import turns options off', async () => {
    const { service, preferences, vault, directory, runtime } = await setup(); await service.savePreferences(preferences({ trayEnabled: true, closeToTray: true, shortcutEnabled: true })); await service.shutdown();
    const reopened = new WorkspaceVault(directory, codec); await reopened.initialize(); const next = new DesktopIntegration(reopened, runtime); services.push(next); await next.refresh(); expect(next.canHide()).toBe(true);
    await reopened.update((draft) => { draft.preferences.desktop = desktopPreferencesSchema.parse({ accelerator: 'Ctrl+Shift+F12' }); }); await next.refresh(); expect(next.state()).toEqual({ trayEnabled: false, shortcutRegistered: false }); expect(vault.snapshot().preferences.desktop?.trayEnabled).toBe(true);
  });
  it('continues cleanup after native release errors and prevents all late callbacks from reopening after shutdown', async () => {
    const { service, preferences, runtime, trays, shortcuts } = await setup(); await service.savePreferences(preferences({ trayEnabled: true, shortcutEnabled: true })); const callback = shortcuts.get('CommandOrControl+Alt+Space')!;
    vi.mocked(runtime.unregisterShortcut).mockImplementationOnce(() => { throw new Error('PRIVATE_RELEASE_PATH'); }); trays[0].destroy.mockImplementationOnce(() => { throw new Error('PRIVATE_DESTROY_PATH'); }); await service.shutdown(); callback(); trays[0].open(); trays[0].quit(); expect(runtime.open).not.toHaveBeenCalled(); expect(runtime.quit).not.toHaveBeenCalled(); expect(service.state()).toMatchObject({ trayEnabled: false, shortcutRegistered: false }); expect(service.state().error).not.toContain('PRIVATE');
  });
});
