import { createHash } from 'node:crypto';
import { readFile, readdir, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';

const legalName = /^(licen[cs]es?|notices?|copying|copyright|third[_ -]?party[_ -]?notices?)(?:[._-].*)?$/i;
const sort = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const sha256 = (content) => createHash('sha256').update(content).digest('hex');

async function documents(directory, prefix = '') {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) { if (legalName.test(entry.name)) throw new Error('A dependency license document must not be a link'); continue; }
    if (entry.isDirectory()) files.push(...await documents(join(directory, entry.name), name));
    else if (entry.isFile() && legalName.test(entry.name)) files.push({ name, content: await readFile(join(directory, entry.name)) });
  }
  return files.sort((left, right) => sort(left.name, right.name));
}

export async function collectLicenseInventory(groups, projectRoot, supplements = []) {
  const moduleRoot = await realpath(join(projectRoot, 'node_modules'));
  const components = new Map(); const retained = new Map();
  for (const entries of Object.values(groups)) {
    for (const entry of entries) {
      for (const directory of entry.paths) {
        const root = await realpath(directory); const scope = relative(moduleRoot, root);
        if (!scope || scope === '..' || scope.startsWith(`..${sep}`) || isAbsolute(scope)) throw new Error('A dependency license source is outside project dependencies');
        const metadata = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
        const id = `${metadata.name}@${metadata.version}`;
        if (typeof entry.license !== 'string' || !entry.license.trim() || !Array.isArray(entry.versions)) throw new Error(`Missing declared license for ${id}`);
        if (metadata.name !== entry.name || !entry.versions.includes(metadata.version)) throw new Error('Dependency identity does not match the installed license inventory');
        let originals = await documents(root); let provenance;
        const supplement = supplements.find((item) => item.name === metadata.name && item.version === metadata.version);
        if (!originals.length && supplement) {
          const legalRoot = await realpath(join(projectRoot, 'licenses'));
          const path = await realpath(join(legalRoot, supplement.document)); const scope = relative(legalRoot, path);
          if (scope === '..' || scope.startsWith(`..${sep}`) || isAbsolute(scope)) throw new Error(`Supplemental license escapes its managed directory: ${id}`);
          const content = await readFile(path);
          if (supplement.license !== entry.license || sha256(content) !== supplement.sha256 || !/^https:\/\/[^\s]+\/[a-f0-9]{40}\//.test(supplement.source)) throw new Error(`Unverified supplemental license for ${id}`);
          originals = [{ name: 'LICENSE', content }]; provenance = { source: supplement.source, originalSha256: supplement.sha256 };
        }
        if (!originals.length) throw new Error(`Missing license document for ${id}`);
        if (originals.some((document) => !document.content.length)) throw new Error(`Empty license document for ${id}`);
        const component = { name: metadata.name, version: metadata.version, license: entry.license, documents: originals.map(({ name, content }) => ({ path: `runtime/${encodeURIComponent(id)}/${name}`, sha256: sha256(content), bytes: content.length })) };
        if (provenance) component.provenance = provenance;
        const previous = components.get(id);
        if (previous && JSON.stringify({ ...previous, provenance: undefined }) !== JSON.stringify({ ...component, provenance: undefined })) throw new Error(`Conflicting license documents for ${id}`);
        if (previous?.provenance && !provenance) component.provenance = previous.provenance;
        components.set(id, component);
        for (let index = 0; index < originals.length; index++) retained.set(component.documents[index].path, originals[index].content);
      }
    }
  }
  if (!components.size) throw new Error('The installed dependency license inventory is empty');
  const inventory = [...components.values()].sort((left, right) => sort(`${left.name}@${left.version}`, `${right.name}@${right.version}`));
  const notices = inventory.map((component) => [`${component.name} ${component.version}`, `Declared license: ${component.license}`, ...(component.provenance ? [`Original license source: ${component.provenance.source}`] : []), ...component.documents.map((document) => `${document.path}\n\n${retained.get(document.path).toString('utf8')}`)].join('\n\n')).join('\n\n---\n\n');
  return { components: inventory, files: [...retained.entries()].map(([path, content]) => ({ path, content })), notices };
}
