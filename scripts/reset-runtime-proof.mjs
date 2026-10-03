import { fileURLToPath } from 'node:url';
import { resetRuntimeProof } from './runtime-proof.mjs';

try {
  if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('Runtime-proof reset is restricted to an isolated GitHub Actions checkout.');
  await resetRuntimeProof(fileURLToPath(new URL('..', import.meta.url)));
  console.log('Reset ten generated runtime records before this isolated verification run.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
