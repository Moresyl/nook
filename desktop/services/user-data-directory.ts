import { join } from 'node:path';
import { existsSync } from 'node:fs';

export function userDataDirectory(appData: string, override?: string, exists = existsSync): string {
  if (override) return override;
  const legacy = join(appData, 'Qiyao');
  // Keep the complete existing profile together, including encrypted credentials and Chromium storage.
  return exists(legacy) ? legacy : join(appData, 'Nook');
}
