import assert from 'node:assert/strict';

export function verifyDesktopExit(code, signal, diagnostics = '') {
  const tail = diagnostics.replace(/wss?:\/\/[^\s]+/g, '[test debugger]').slice(-4000);
  const detail = tail ? `\nDesktop stderr tail:\n${tail}` : '';
  assert.equal(code, 0, `The desktop must report a successful native exit.${detail}`);
  assert.equal(signal, null, `The desktop must exit without a terminating signal.${detail}`);
}
