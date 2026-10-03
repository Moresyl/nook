import { isAbsolute, relative, resolve, sep } from 'node:path';
import { realpath } from 'node:fs/promises';

export async function appAssetPath(root: string, raw: string): Promise<string> {
  const url = new URL(raw);
  if (url.protocol !== 'qiyao:' || url.hostname !== 'app' || url.username || url.password || url.port) throw new Error('Unknown application origin.');
  const path = decodeURIComponent(url.pathname);
  if (/[\0\\]/.test(path)) throw new Error('Invalid application path.');
  const actualRoot = await realpath(root);
  const candidate = await realpath(resolve(actualRoot, `.${path}`));
  const displacement = relative(actualRoot, candidate);
  if (isAbsolute(displacement) || displacement === '..' || displacement.startsWith(`..${sep}`)) throw new Error('Invalid application path.');
  return candidate;
}
