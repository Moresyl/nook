import assert from 'node:assert/strict';

export async function verifyDiffDisposal({ page, open, close }) {
  const errors = []; const onError = (error) => errors.push(error.message); page.on('pageerror', onError);
  await page.evaluate(() => {
    const post = Worker.prototype.postMessage; const gate = { held: 0, replies: 0, released: false, missingModelReply: false, received: [] };
    window.qiyaoDiffDisposalGate = gate;
    Worker.prototype.postMessage = function (data, ...args) {
      if (data?.type === 0 && data.method === '$computeDiff' && !gate.released) {
        gate.held++; const worker = this; const listener = (event) => {
          gate.received.push({ type: event.data?.type, seq: event.data?.seq, req: data.req }); if (gate.received.length > 8) gate.received.shift();
          if (event.data?.type === 1 && event.data.seq === data.req) { gate.replies++; gate.missingModelReply ||= event.data.res == null; worker.removeEventListener('message', listener); }
        };
        worker.addEventListener('message', listener); (gate.pending ??= []).push(() => post.call(worker, data, ...args)); return;
      }
      return post.call(this, data, ...args);
    };
    gate.release = () => { gate.released = true; for (const send of gate.pending ?? []) send(); gate.pending = []; };
    gate.restore = () => { Worker.prototype.postMessage = post; gate.release(); };
  });
  try {
    await open(); await page.locator('.monaco-diff-editor').waitFor();
    await page.waitForFunction(() => window.qiyaoDiffDisposalGate.held > 0);
    await close(); await page.locator('.monaco-diff-editor').waitFor({ state: 'detached' });
    await page.evaluate(() => window.qiyaoDiffDisposalGate.release());
    await page.waitForFunction(() => window.qiyaoDiffDisposalGate.replies === window.qiyaoDiffDisposalGate.held);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const result = await page.evaluate(() => { const { held, replies, missingModelReply } = window.qiyaoDiffDisposalGate; return { held, replies, missingModelReply }; });
    assert.ok(result.held > 0); assert.ok(result.missingModelReply, 'The actual worker must see disposed models after native view closure'); assert.deepEqual(errors, []);
    console.log('Verified actual in-flight diff-worker reply after native view closure', JSON.stringify(result)); return result;
  } finally {
    console.log('Diff disposal gate diagnostics', JSON.stringify(await page.evaluate(() => { const { held, replies, missingModelReply, received } = window.qiyaoDiffDisposalGate; return { held, replies, missingModelReply, received }; }).catch(() => null)), JSON.stringify(errors));
    await page.evaluate(() => window.qiyaoDiffDisposalGate.restore()).catch(() => {}); page.off('pageerror', onError);
  }
}
