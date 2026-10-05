import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { userDataDirectory } from '../desktop/services/user-data-directory';

describe('Nook profile selection', () => {
  it('uses the explicit profile without probing other directories', () => {
    const exists = vi.fn();
    expect(userDataDirectory('/data', '/isolated/中文', exists)).toBe('/isolated/中文');
    expect(exists).not.toHaveBeenCalled();
  });
  it('keeps the complete legacy profile without moving or merging its files', () => {
    const exists = vi.fn(() => true);
    expect(userDataDirectory('/data', undefined, exists)).toBe(join('/data', 'Qiyao'));
    expect(exists).toHaveBeenCalledExactlyOnceWith(join('/data', 'Qiyao'));
  });
  it('uses Nook for a fresh installation or empty override', () => {
    expect(userDataDirectory('/data', '', () => false)).toBe(join('/data', 'Nook'));
  });
  it('supports the real filesystem probe', () => {
    expect(userDataDirectory(join(process.cwd(), 'node_modules', '__absent_nook_profile__'))).toBe(join(process.cwd(), 'node_modules', '__absent_nook_profile__', 'Nook'));
  });
});
