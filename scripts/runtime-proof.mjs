import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const runtimeProofFiles = {
  audit: 'package-audit-result.json', desktop: 'packaged-result.json', surfaces: 'surfaces-packaged-result.json',
  branches: 'conversation-branches-packaged-result.json', temporary: 'temporary-conversations-packaged-result.json', comparisons: 'model-comparisons-packaged-result.json',
  portable: 'portable-result.json', portableAudit: 'portable-package-audit-result.json', bootstrap: 'distribution-bootstrap-result.json', installer: 'pipeline-installer-result.json',
};

export async function readRuntimeProof(root) {
  return Object.fromEntries(await Promise.all(Object.entries(runtimeProofFiles).map(async ([key, name]) => {
    try {
      const record = JSON.parse(await readFile(join(root, 'verification', name), 'utf8'));
      if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('Invalid record');
      return [key, record];
    } catch { throw new Error(`Could not read complete runtime proof (${key}). Run all distribution checks again.`); }
  })));
}
