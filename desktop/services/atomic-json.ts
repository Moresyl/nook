import { atomicFile } from './atomic-file';

export async function atomicJson(path: string, value: unknown): Promise<void> {
  await atomicFile(path, async (file) => { await file.writeFile(JSON.stringify(value, null, 2), 'utf8'); });
}
