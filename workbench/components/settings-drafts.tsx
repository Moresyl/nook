import { createContext, useContext, useLayoutEffect } from 'react';
import type { SettingsDraftSource } from '../lib/settings-drafts';

export type SettingsLeaveAction = () => void | Promise<void>;
type SettingsDraftControl = {
  updateDirty(source: SettingsDraftSource, active: boolean): void;
  updateBusy(source: SettingsDraftSource, active: boolean): void;
  leave(action: SettingsLeaveAction, required?: boolean, detail?: string): Promise<void>;
};
export const SettingsDraftContext = createContext<SettingsDraftControl | null>(null);

export function useSettingsDraft(source: SettingsDraftSource, dirty: boolean, busy = false) {
  const control = useContext(SettingsDraftContext);
  const updateDirty = control?.updateDirty, updateBusy = control?.updateBusy;
  useLayoutEffect(() => {
    updateDirty?.(source, dirty); updateBusy?.(source, busy);
    return () => { updateDirty?.(source, false); updateBusy?.(source, false); };
  }, [source, dirty, busy, updateDirty, updateBusy]);
  return (action: SettingsLeaveAction, detail?: string) => control ? control.leave(action, dirty, detail) : Promise.resolve().then(action);
}
