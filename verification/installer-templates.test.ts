import { describe, expect, it } from 'vitest';
import { rewriteInstallerTemplate, rewritePortableTemplate } from '../scripts/installer-templates.mjs';

const set = '  WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"';
const unpin = '    WinShell::UninstShortcut "$oldDesktopLink"';
const clear = '  WinShell::UninstAppUserModelId "${APP_ID}"';
const fixture = (separator = '\n') => [
  '# Original template comments and unrelated install logic',
  ...Array.from({ length: 5 }, () => set), unpin, unpin, 'CreateShortCut "$newDesktopLink" "$appExe"',
].join(separator);

describe('Windows installer template transformation', () => {
  it.each(['\n', '\r\n'])('replaces every audited installer shell call and preserves original logic with %j newlines', (separator) => {
    const result = rewriteInstallerTemplate(fixture(separator), 'installer');
    expect(result.match(/!insertmacro QiyaoSetShortcutAppID/g)).toHaveLength(5);
    expect(result.match(/!insertmacro QiyaoUnpinShortcut/g)).toHaveLength(2);
    expect(result).toContain('"$newDesktopLink" "${APP_ID}"');
    expect(result).toContain('# Original template comments and unrelated install logic');
    expect(result).toContain('CreateShortCut "$newDesktopLink" "$appExe"');
    expect(result).not.toContain('WinShell::');
    expect(result.startsWith('; Modified by Qiyao: original electron-builder MIT')).toBe(true);
    expect(result.slice(result.indexOf('\n') + 1).split(separator)).toHaveLength(9);
  });
  it('replaces uninstall application cleanup and both shortcut removals', () => {
    const result = rewriteInstallerTemplate([clear, unpin, unpin, 'Delete "$oldDesktopLink"'].join('\n'), 'uninstaller');
    expect(result).toContain('!insertmacro QiyaoClearAppDestinations "${APP_ID}"');
    expect(result.match(/!insertmacro QiyaoUnpinShortcut/g)).toHaveLength(2);
    expect(result).toContain('Delete "$oldDesktopLink"');
    expect(result).not.toContain('WinShell::');
  });
  it('fails when a builder update adds, removes, changes or hides a shell call', () => {
    for (const source of [fixture().replace(set, ''), `${fixture()}\n${set}`, fixture().replace('WinShell::SetLnkAUMI', 'winshell::SetLnkAUMI'), fixture().replace(set, 'WinShell::SetLnkAUMI "$link"'), `${fixture()}\nWinShell::NewOperation "$link"`]) {
      expect(() => rewriteInstallerTemplate(source, 'installer')).toThrow('shell calls changed');
    }
    expect(() => rewriteInstallerTemplate(fixture(), 'uninstaller')).toThrow('shell calls changed');
  });
  it('rejects missing inputs or unsupported template variants', () => {
    for (const source of ['', ' ', undefined, null, {}]) expect(() => rewriteInstallerTemplate(source as string, 'installer')).toThrow('Invalid');
    expect(() => rewriteInstallerTemplate(fixture(), 'portable' as 'installer')).toThrow('Invalid');
  });
});

describe('Windows portable cleanup transformation', () => {
  const portable = (separator = '\n') => [
    '# Original portable template', '  RMDir /r $INSTDIR', 'SetOutPath $INSTDIR',
    'ExecWait "$INSTDIR\\${APP_EXECUTABLE_FILENAME} $R0" $0', 'SetErrorLevel $0',
    'SetOutPath $EXEDIR', '\tRMDir /r $INSTDIR',
  ].join(separator);
  it.each(['\n', '\r\n'])('retains launch arguments and exit code while extending both cleanup paths with %j newlines', (separator) => {
    const result = rewritePortableTemplate(portable(separator));
    const lines = result.slice(result.indexOf('\n') + 1).split(separator);
    expect(lines[1]).toBe('  RMDir /r "\\\\?\\$INSTDIR"');
    expect(lines[6]).toBe('\tRMDir /r "\\\\?\\$INSTDIR"');
    expect(lines[2]).toBe('SetOutPath "\\\\?\\$INSTDIR"');
    for (const index of [0, 3, 4, 5]) expect(lines[index]).toBe(portable(separator).split(separator)[index]);
    expect(lines).toHaveLength(7);
    expect(result.startsWith('; Modified by Qiyao: original electron-builder MIT')).toBe(true);
  });
  it('rejects changed cleanup locations, counts and syntax', () => {
    for (const source of [portable().replace('  RMDir /r $INSTDIR', ''), `${portable()}\nRMDir /r $INSTDIR`, portable().replace('RMDir /r $INSTDIR', 'RMDir /r "$INSTDIR"'), portable().replace('RMDir /r $INSTDIR', 'RMDir /r $TEMP'), `${portable()}\nRMDir  /r $INSTDIR`]) expect(() => rewritePortableTemplate(source)).toThrow('cleanup changed');
  });
  it('rejects missing, duplicate or changed extraction destinations', () => {
    for (const source of [portable().replace('SetOutPath $INSTDIR', ''), `${portable()}\nSetOutPath $INSTDIR`, portable().replace('SetOutPath $INSTDIR', 'SetOutPath $TEMP')]) expect(() => rewritePortableTemplate(source)).toThrow('extraction changed');
  });
  it('rejects missing or non-text templates', () => {
    for (const source of ['', ' ', undefined, null, {}]) expect(() => rewritePortableTemplate(source as string)).toThrow('Invalid');
  });
});
