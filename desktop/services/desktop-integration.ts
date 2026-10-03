import { desktopPreferencesSchema, type DesktopPreferences, type DesktopState } from '../../contracts/desktop-integration';
import { preferencesSchema, type Workspace } from '../../contracts/workspace';
import type { WorkspaceVault } from './vault';

export type DesktopTray = { destroy: () => void };
export type DesktopRuntime = {
  createTray: (actions: { open: () => void; quit: () => void }) => DesktopTray;
  registerShortcut: (accelerator: string, callback: () => void) => boolean;
  unregisterShortcut: (accelerator: string) => void;
  open: () => void; quit: () => void;
};
type Shortcut = { accelerator: string };
const unavailable = 'The system tray or global shortcut could not be enabled. Check desktop settings and try again.';
const storageFailed = 'Desktop settings could not be saved. Check local storage and try again.';

export class DesktopIntegration {
  private tray: DesktopTray | null = null; private shortcut: Shortcut | null = null; private error: string | undefined;
  private tail: Promise<unknown> = Promise.resolve(); private closed = false;
  constructor(private readonly vault: WorkspaceVault, private readonly runtime: DesktopRuntime) {}
  state(): DesktopState { return { trayEnabled: Boolean(this.tray), shortcutRegistered: Boolean(this.shortcut), ...(this.error ? { error: this.error } : {}) }; }
  canHide(): boolean { return !this.closed && Boolean(this.tray) && this.vault.snapshot().preferences.desktop?.closeToTray === true; }
  private available() { if (this.closed) throw new Error('Desktop integration is closing. Reopen the workspace.'); }
  private enqueue<T>(operation: () => Promise<T>): Promise<T> { const result = this.tail.then(operation); this.tail = result.catch(() => {}); return result; }
  private release(tray: DesktopTray | null, shortcut: Shortcut | null) {
    if (shortcut) try { this.runtime.unregisterShortcut(shortcut.accelerator); } catch { this.error = 'Could not release the global shortcut.'; }
    if (tray) try { tray.destroy(); } catch { this.error = 'Could not release the system tray.'; }
  }
  private prepare(settings: DesktopPreferences) {
    let createdTray: DesktopTray | null = null; let registeredShortcut: Shortcut | null = null;
    try {
      if (settings.trayEnabled && !this.tray) {
        createdTray = this.runtime.createTray({
          open: () => { if (!this.closed && this.tray === createdTray) this.runtime.open(); },
          quit: () => { if (!this.closed && this.tray === createdTray) this.runtime.quit(); },
        });
      }
      if (settings.shortcutEnabled && this.shortcut?.accelerator !== settings.accelerator) {
        const candidate: Shortcut = { accelerator: settings.accelerator };
        if (!this.runtime.registerShortcut(candidate.accelerator, () => { if (!this.closed && this.shortcut === candidate) this.runtime.open(); })) throw new Error(unavailable);
        registeredShortcut = candidate;
      }
      return {
        cancel: () => this.release(createdTray, registeredShortcut),
        commit: () => {
          const oldTray = this.tray; const oldShortcut = this.shortcut;
          this.tray = settings.trayEnabled ? createdTray ?? oldTray : null;
          this.shortcut = settings.shortcutEnabled ? registeredShortcut ?? oldShortcut : null;
          this.error = undefined; this.release(oldTray === this.tray ? null : oldTray, oldShortcut === this.shortcut ? null : oldShortcut);
        },
      };
    } catch { this.release(createdTray, registeredShortcut); throw new Error(unavailable); }
  }
  refresh(): Promise<void> {
    return this.enqueue(async () => {
      this.available();
      try { this.prepare(desktopPreferencesSchema.parse(this.vault.snapshot().preferences.desktop ?? {})).commit(); }
      catch { this.error = unavailable; throw new Error(unavailable); }
    });
  }
  savePreferences(raw: unknown): Promise<Workspace> {
    const preferences = preferencesSchema.parse(raw);
    return this.enqueue(async () => {
      this.available(); let change: ReturnType<DesktopIntegration['prepare']>;
      try { change = this.prepare(desktopPreferencesSchema.parse(preferences.desktop ?? {})); }
      catch { this.error = unavailable; throw new Error(unavailable); }
      let state: Workspace;
      try { state = await this.vault.update((draft) => { draft.preferences = preferences; }); }
      catch { change.cancel(); this.error = storageFailed; throw new Error(storageFailed); }
      if (this.closed) change.cancel(); else change.commit(); return state;
    });
  }
  async shutdown(): Promise<void> { this.closed = true; await this.tail; this.release(this.tray, this.shortcut); this.tray = null; this.shortcut = null; }
}
