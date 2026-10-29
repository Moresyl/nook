import type { Locator, Page } from 'playwright';

export function scrollProjectTreeItem(page: Page, tree: Locator, path: string): Promise<void>;
export function projectTreeItem(getPage: () => Page, getTree: () => Locator, path: string): Locator;
export function collectProjectTreeRows(page: Page, tree: Locator): Promise<[string, string | null][]>;
