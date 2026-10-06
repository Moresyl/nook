import { z } from 'zod';

export const desktopPreferencesSchema = z.object({
  trayEnabled: z.boolean().default(false), closeToTray: z.boolean().default(false), shortcutEnabled: z.boolean().default(false),
  shortcutTarget: z.enum(['workbench', 'quick-chat']).optional(),
  accelerator: z.string().trim().max(80).regex(/^(?:CommandOrControl|Control|Ctrl|Command|Super)\+(?:(?:Alt|Shift)\+){1,2}(?:Space|[A-Z0-9]|F(?:[1-9]|1[0-2]))$/).refine((value) => new Set(value.split('+')).size === value.split('+').length, 'Shortcut modifiers must be unique').default('CommandOrControl+Alt+Space'),
}).strict().refine((settings) => !settings.closeToTray || settings.trayEnabled, 'Enable the tray before closing to the background');
export type DesktopPreferences = z.infer<typeof desktopPreferencesSchema>;
export type DesktopState = { trayEnabled: boolean; shortcutRegistered: boolean; error?: string };
