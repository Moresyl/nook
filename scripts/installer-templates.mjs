const replacements = [
  ['SetLnkAUMI', 'QiyaoSetShortcutAppID', 2],
  ['UninstShortcut', 'QiyaoUnpinShortcut', 1],
  ['UninstAppUserModelId', 'QiyaoClearAppDestinations', 1],
];

export function rewriteInstallerTemplate(source, variant) {
  if (typeof source !== 'string' || !source.trim() || !['installer', 'uninstaller'].includes(variant)) throw new Error('Invalid Windows installer template');
  const counts = { SetLnkAUMI: 0, UninstShortcut: 0, UninstAppUserModelId: 0 };
  let result = source;
  for (const [original, replacement, argumentsCount] of replacements) {
    const expression = new RegExp(`^(\\s*)WinShell::${original}((?:[ \\t]+"[^"\\r\\n]+"){${argumentsCount}})[ \\t]*(\\r?)$`, 'gm');
    result = result.replace(expression, (_, indent, parameters, carriageReturn) => {
      counts[original]++;
      return `${indent}!insertmacro ${replacement}${parameters}${carriageReturn}`;
    });
  }
  const expected = variant === 'installer' ? { SetLnkAUMI: 5, UninstShortcut: 2, UninstAppUserModelId: 0 } : { SetLnkAUMI: 0, UninstShortcut: 2, UninstAppUserModelId: 1 };
  if (Object.keys(expected).some((name) => counts[name] !== expected[name]) || /WinShell::/i.test(result)) throw new Error('Windows installer shell calls changed; review the template before packaging');
  return `; Modified by Qiyao: original electron-builder MIT template with System/COM shell calls.\n${result}`;
}

export function rewritePortableTemplate(source) {
  if (typeof source !== 'string' || !source.trim()) throw new Error('Invalid Windows portable template');
  let count = 0;
  let result = source.replace(/^([ \t]*)RMDir \/r \$INSTDIR[ \t]*(\r?)$/gm, (_, indent, carriageReturn) => {
    count++;
    return `${indent}RMDir /r "\\\\?\\$INSTDIR"${carriageReturn}`;
  });
  if (count !== 2 || /RMDir\s+\/r\s+\$INSTDIR/i.test(result)) throw new Error('Windows portable cleanup changed; review the template before packaging');
  let destinations = 0;
  result = result.replace(/^([ \t]*)SetOutPath \$INSTDIR[ \t]*(\r?)$/gm, (_, indent, carriageReturn) => {
    destinations++;
    return `${indent}SetOutPath "\\\\?\\$INSTDIR"${carriageReturn}`;
  });
  if (destinations !== 1) throw new Error('Windows portable extraction changed; review the template before packaging');
  return `; Modified by Qiyao: original electron-builder MIT template with Windows extended-path extraction and cleanup.\n${result}`;
}
