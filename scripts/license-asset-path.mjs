import { realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

/** A shared dependency root is supported, but links inside it must remain within that resolved root. */
export async function licenseAssetPath(directory, name, allowDependencies = false) {
  const invalid = () => new Error('A bundled license asset is outside its declared directory');
  if (typeof name !== 'string' || !name || isAbsolute(name) || /[:\0]/.test(name)) throw invalid();
  const parts = name.split(/[\\/]/);
  if (parts.some(part => !part || part === '.' || part === '..')) throw invalid();
  const base = resolve(directory);
  const boundary = allowDependencies && parts[0] === 'node_modules' ? await realpath(join(base, 'node_modules')) : base;
  const path = await realpath(resolve(base, name));
  const scope = relative(boundary, path);
  if (!scope || scope === '..' || scope.startsWith(`..${sep}`) || isAbsolute(scope)) throw invalid();
  return path;
}
