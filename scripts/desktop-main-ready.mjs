export const mainProcessReadyExpression = `(async () => {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const electron = require('electron');
    if (typeof electron?.app?.commandLine?.hasSwitch === 'function') return true;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Electron main-process exports did not become ready within 5000 ms.');
})()`;
