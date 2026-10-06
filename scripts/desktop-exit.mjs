import assert from 'node:assert/strict';

export function verifyDesktopExit(code, signal) {
  assert.equal(code, 0, 'The desktop must report a successful native exit.');
  assert.equal(signal, null, 'The desktop must exit without a terminating signal.');
}
