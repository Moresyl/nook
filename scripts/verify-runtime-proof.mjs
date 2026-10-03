import { fileURLToPath } from 'node:url';
import { verifyRuntimeProof } from './release-policy.mjs';
import { readRuntimeProof } from './runtime-proof.mjs';

try {
  const proof = await readRuntimeProof(fileURLToPath(new URL('..', import.meta.url)));
  verifyRuntimeProof(proof);
  console.log(`Verified ${Object.keys(proof).length} matching runtime records: ${proof.desktop.checks} complete desktop checks and normal installed/portable lifecycle.`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
