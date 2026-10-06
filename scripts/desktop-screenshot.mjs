import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

export async function captureDesktopScreenshot(application, path) {
  const capture = await application.evaluateMain(`(async () => {
    const window = require('electron').BrowserWindow.getAllWindows().find(window => !window.isDestroyed() && window.webContents.getURL().startsWith('qiyao://app/'));
    const image = await window.capturePage();
    return { png: image.toPNG().toString('base64'), size: window.getContentSize() };
  })()`);
  const png = Buffer.from(capture.png, 'base64');
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], 'The native capture must be a PNG');
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], capture.size, 'Native screenshots must contain the entire unscaled content bounds');
  await writeFile(path, png);
}
