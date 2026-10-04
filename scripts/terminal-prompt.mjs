export async function waitForTerminalPrompt(read, { timeoutMs = 30_000 } = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Terminal startup requires a positive timeout.');
  const startedAt = Date.now();
  const failure = () => new Error(`Terminal prompt did not become ready within ${timeoutMs} ms.`);
  while (Date.now() - startedAt < timeoutMs) {
    let timer;
    const terminals = await Promise.race([read(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(failure()), timeoutMs - (Date.now() - startedAt));
    })]).finally(() => clearTimeout(timer));
    if (Date.now() - startedAt >= timeoutMs) break;
    const ready = terminals.find(terminal => terminal.status === 'running' && terminal.output.includes('PS '));
    if (ready) return { id: ready.id, elapsedMs: Date.now() - startedAt, timeoutMs };
    await new Promise(resolve => setTimeout(resolve, Math.min(100, timeoutMs - (Date.now() - startedAt))));
  }
  throw failure();
}
