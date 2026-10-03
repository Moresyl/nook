export async function waitForDesktopPage(context, { hasExited = () => false, timeoutMs = 30_000 } = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Desktop page discovery requires a positive timeout.');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (hasExited()) throw new Error('Desktop exited before its application page became ready.');
    const page = context.pages().find((page) => !page.isClosed() && page.url().startsWith('qiyao://app/'));
    if (page) return page;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Desktop page discovery timed out after ${timeoutMs} ms.`);
}
