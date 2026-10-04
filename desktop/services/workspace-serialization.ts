import { isDeepStrictEqual } from 'node:util';
import type { Thread, Workspace } from '../../contracts/workspace';

type EncodedThread = { value: Thread; bytes: Buffer };

function samePropertyOrder(left: object, right: object): boolean {
  const keys = Object.keys(left); const otherKeys = Object.keys(right);
  return keys.every((key, index) => {
    if (key !== otherKeys[index]) return false;
    const value = (left as Record<string, unknown>)[key];
    return !value || typeof value !== 'object' || samePropertyOrder(value, (right as Record<string, unknown>)[key] as object);
  });
}

/** Equal validated threads must also retain key order to preserve their exact JSON bytes. */
export function sameThreadEncoding(left: Thread, right: Thread): boolean {
  return isDeepStrictEqual(left, right) && samePropertyOrder(left, right);
}

/** Preserve the existing pretty JSON bytes while reusing unchanged validated histories. */
export class WorkspaceSerialization {
  private threads = new Map<string, EncodedThread>();

  serialize(state: Workspace): Buffer {
    const chunks: Buffer[] = [Buffer.from('{\n')];
    const nextThreads = new Map<string, EncodedThread>();
    let first = true;
    for (const [key, value] of Object.entries(state)) {
      if (value === undefined) continue;
      if (!first) chunks.push(Buffer.from(',\n'));
      first = false;
      chunks.push(Buffer.from(`  ${JSON.stringify(key)}: `));
      if (key !== 'threads') {
        chunks.push(Buffer.from(JSON.stringify(value, null, 2).replaceAll('\n', '\n  '), 'utf8'));
        continue;
      }
      if (!state.threads.length) { chunks.push(Buffer.from('[]')); continue; }
      chunks.push(Buffer.from('[\n'));
      for (let index = 0; index < state.threads.length; index++) {
        const thread = state.threads[index];
        const previous = this.threads.get(thread.id);
        const encoded = previous && sameThreadEncoding(previous.value, thread) ? previous : {
          value: structuredClone(thread),
          bytes: Buffer.from(`    ${JSON.stringify(thread, null, 2).replaceAll('\n', '\n    ')}`, 'utf8'),
        };
        nextThreads.set(thread.id, encoded);
        if (index) chunks.push(Buffer.from(',\n'));
        chunks.push(encoded.bytes);
      }
      chunks.push(Buffer.from('\n  ]'));
    }
    chunks.push(Buffer.from('\n}'));
    const bytes = Buffer.concat(chunks);
    this.threads = nextThreads;
    return bytes;
  }
}
