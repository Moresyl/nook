// Evaluated in Electron's main process; all helpers stay inside this closure.
export async function preserveSystemClipboard() {
  const { clipboard, ClipboardItem } = require('electron');
  const { createHash } = require('node:crypto');
  const assert = require('node:assert/strict');
  async function fingerprint(items) {
    const result = [];
    for (const item of items) {
      const row = [];
      for (const type of [...item.types].sort()) {
        const value = await item.getType(type);
        const bytes = value instanceof Blob ? Buffer.from(await value.arrayBuffer()) : Buffer.from(JSON.stringify(value));
        row.push({ type, sha256: createHash('sha256').update(bytes).digest('hex') });
      }
      result.push(row);
    }
    return result;
  }
  function firstDifference(expected, actual) {
    for (let index = 0; index < Math.max(expected.length, actual.length); index++) {
      const before = new Map((expected[index] ?? []).map(row => [row.type, row.sha256]));
      const after = new Map((actual[index] ?? []).map(row => [row.type, row.sha256]));
      for (const type of new Set([...before.keys(), ...after.keys()])) {
        if (before.get(type) !== after.get(type)) return {
          item: index, type: type.replace('electron application/osclipboard;format=', 'os:').slice(0, 80),
          expected: before.get(type)?.slice(0, 16) ?? null, actual: after.get(type)?.slice(0, 16) ?? null,
        };
      }
    }
    return { expectedItems: expected.length, actualItems: actual.length };
  }
  async function snapshot(items) {
    const originals = [], copies = [];
    for (const item of items) {
      const original = {}, data = {};
      for (const type of item.types) {
        // Native read-side items are lazy. Materialize each payload once so
        // the fingerprint and restoration refer to the same captured bytes.
        const value = await item.getType(type);
        assert.ok(!(process.platform === 'win32' && value instanceof Blob && value.size === 0 && type !== 'text/plain'),
          'Cannot safely preserve an empty or unavailable non-text Windows clipboard payload.');
        original[type] = value;
        // A Windows NUL-terminated empty string retains the native text format.
        // Its original public read payload remains zero bytes.
        data[type] = process.platform === 'win32' && type === 'text/plain' && value.size === 0 ? '\0' : value;
      }
      originals.push(new ClipboardItem(original)); copies.push(new ClipboardItem(data));
    }
    return { items: copies, before: await fingerprint(originals) };
  }
  const items = await clipboard.read(), { items: backup, before } = await snapshot(items);
  const current = await fingerprint(await clipboard.read());
  assert.deepEqual(current, before, `Clipboard changed during snapshot; clipboard was not modified: ${JSON.stringify(firstDifference(before, current))}`);
  globalThis.nookTableClipboardBackup = { items: backup, fingerprint, before };
  let emptyPlainTextRoundTrip = null;
  if (process.platform === 'win32') {
    try {
      await clipboard.write([...backup, new ClipboardItem({ 'text/plain': '\0' })]);
      const empty = await snapshot(await clipboard.read()), expected = empty.before;
      assert.equal(await clipboard.has('text/plain'), true);
      assert.equal(await clipboard.readText(), '');
      await clipboard.write(empty.items);
      const readback = await fingerprint(await clipboard.read());
      assert.deepEqual(readback, expected, `Empty-text clipboard round trip: ${JSON.stringify(firstDifference(expected, readback))}`);
      emptyPlainTextRoundTrip = true;
    } finally {
      if (backup.length) await clipboard.write(backup); else clipboard.clear();
      const restored = await fingerprint(await clipboard.read());
      assert.deepEqual(restored, before, `Original clipboard restoration: ${JSON.stringify(firstDifference(before, restored))}`);
    }
  }
  return { supported: true, formats: items.flatMap(item => item.types), emptyPlainTextRoundTrip };
}
