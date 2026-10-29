import assert from 'node:assert/strict';

async function settle(page) { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }

export async function scrollProjectTreeItem(page, tree, path) {
  const target = tree.getByRole('treeitem', { name: path, exact: true });
  if (await target.count()) return;
  const deadline = Date.now() + 5000;
  await tree.evaluate(element => { element.scrollTop = 0; }); await settle(page);
  while (!await target.count()) {
    assert.ok(Date.now() < deadline, `Tree row was not reachable by scrolling: ${path}`);
    const moved = await tree.evaluate(element => { const before = element.scrollTop; element.scrollTop += Math.max(28, element.clientHeight - 28); return element.scrollTop > before; });
    await settle(page);
    if (!moved) { await target.waitFor({ timeout: Math.max(1, deadline - Date.now()) }); break; }
  }
}

// Only user actions may scroll a virtual row into existence. Assertions and
// waitFor remain raw so missing focus, reveal or collapse behavior still fails.
export function projectTreeItem(getPage, getTree, path) {
  const wrap = locator => new Proxy(locator, {
    get(target, property) {
      if (['focus', 'click', 'hover', 'scrollIntoViewIfNeeded'].includes(property)) return async (...args) => {
        await scrollProjectTreeItem(getPage(), getTree(), path); return target[property](...args);
      };
      if (['locator', 'getByRole', 'getByText'].includes(property)) return (...args) => wrap(target[property](...args));
      const value = target[property]; return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return wrap(getTree().getByRole('treeitem', { name: path, exact: true }));
}

export async function collectProjectTreeRows(page, tree) {
  const before = await tree.evaluate(element => element.scrollTop), rows = new Map();
  const startedAt = Date.now(), deadline = startedAt + 5000;
  let steps = 0, minimumHeight = Infinity;
  try {
    await tree.evaluate(element => { element.scrollTop = 0; }); await settle(page);
    while (true) {
      const { current, height, moved } = await tree.evaluate(element => {
        const current = [...element.querySelectorAll('[role="treeitem"]')].map(row => [row.getAttribute('aria-label'), row.getAttribute('aria-expanded')]);
        const height = element.clientHeight, before = element.scrollTop;
        element.scrollTop += Math.max(28, height - 28);
        return { current, height, moved: element.scrollTop > before };
      });
      steps++; minimumHeight = Math.min(minimumHeight, height);
      assert.ok(current.length <= Math.ceil(height / 28) + 40, `Mounted tree rows must remain bounded: ${current.length}`);
      for (const [path, expanded] of current) rows.set(path, expanded);
      assert.ok(Date.now() < deadline, 'Scrolling the loaded tree exceeded the operation deadline');
      if (!moved) break; await settle(page);
    }
  } finally {
    console.log('Project tree traversal timing', JSON.stringify({ steps, minimumHeight, collectedRows: rows.size, elapsedMs: Date.now() - startedAt, timeoutMs: 5000 }));
    await tree.evaluate((element, top) => { element.scrollTop = top; }, before); await settle(page);
  }
  return [...rows].sort(([left], [right]) => left.localeCompare(right));
}
