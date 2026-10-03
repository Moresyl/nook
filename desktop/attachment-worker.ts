import { parentPort, workerData } from 'node:worker_threads';
import { parseAttachment } from './services/attachment-parser';

void parseAttachment(workerData).then((attachment) => parentPort?.postMessage({ attachment })).catch((error: unknown) => {
  parentPort?.postMessage({ error: error instanceof Error ? error.message.slice(0, 512) : 'Could not import this file.' });
});
