import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

const sha256 = (content) => createHash('sha256').update(content).digest('hex');
const hashPattern = /^[a-f0-9]{64}$/;

async function retainedFile(root, file) {
  if (!file || typeof file.path !== 'string' || isAbsolute(file.path) || !hashPattern.test(file.sha256)) throw new Error('Invalid distribution file declaration');
  const path = await realpath(resolve(root, file.path)); const scope = relative(root, path);
  if (!scope || scope === '..' || scope.startsWith(`..${sep}`) || isAbsolute(scope)) throw new Error('A distribution file escapes its declared directory');
  const content = await readFile(path);
  if (!content.length || sha256(content) !== file.sha256) throw new Error(`Distribution file is absent, empty or changed: ${file.path}`);
  return content;
}

export async function collectDistributionInventory(manifest, legalRoot) {
  if (!manifest || manifest.schemaVersion !== 1 || typeof manifest.builderVersion !== 'string' || !manifest.builderVersion.trim() || typeof manifest.toolset !== 'string' || !manifest.toolset.trim() || manifest.archiveFilter !== 'BCJ' || !Array.isArray(manifest.components) || !manifest.components.length) throw new Error('Invalid Windows distribution inventory');
  const root = await realpath(legalRoot); const names = new Set(); const notices = [];
  for (const component of manifest.components) {
    if (!component || typeof component.name !== 'string' || !component.name.trim() || names.has(component.name) || typeof component.license !== 'string' || !component.license.trim() || !['verified', 'unresolved'].includes(component.status) || !/^https:\/\/[^\s]+$/.test(component.source) || !Array.isArray(component.documents) || !component.documents.length || !Array.isArray(component.sources) || !Array.isArray(component.binaries) || !component.binaries.length) throw new Error('Invalid Windows distribution component');
    names.add(component.name);
    const documents = [];
    for (const file of component.documents) documents.push(`${file.path}\n\n${(await retainedFile(root, file)).toString('utf8')}`);
    for (const file of component.sources) await retainedFile(root, file);
    for (const binary of component.binaries) {
      if (!binary || !['compiler', 'plugins', 'elevate'].includes(binary.location) || typeof binary.path !== 'string' || !binary.path || isAbsolute(binary.path) || binary.path.split(/[\\/]/).includes('..') || !hashPattern.test(binary.sha256)) throw new Error('Invalid distribution binary declaration');
      if (binary.location === 'elevate' && binary.path !== 'elevate.exe') throw new Error('Invalid elevation helper declaration');
    }
    notices.push(`${component.name}\nDeclared license: ${component.license}\nRedistribution status: ${component.status}\nSource: ${component.source}\n${component.notes ? `Notes: ${component.notes}\n` : ''}\n${documents.join('\n\n')}\n\nRetained source material:\n${component.sources.map((file) => `${file.path} (SHA256 ${file.sha256})`).join('\n') || 'See the component source URL.'}`);
  }
  return { notices: notices.join('\n\n---\n\n'), components: manifest.components.length, unresolved: manifest.components.filter((component) => component.status !== 'verified').map((component) => component.name) };
}

export async function verifyDistributionBinaries(manifest, locations) {
  const verified = [];
  for (const component of manifest.components) {
    for (const binary of component.binaries) {
      const directory = locations[binary.location];
      if (typeof directory !== 'string') throw new Error('A distribution tool directory is missing');
      await retainedFile(await realpath(directory), binary);
      verified.push({ component: component.name, location: binary.location, path: binary.path, sha256: binary.sha256 });
    }
  }
  return verified;
}
