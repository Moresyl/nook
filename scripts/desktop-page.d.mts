import type { Page } from 'playwright';

export function waitForDesktopPage<T extends Pick<Page, 'url' | 'isClosed'>>(context: { pages(): T[] }, options?: { hasExited?: () => boolean; timeoutMs?: number }): Promise<T>;
