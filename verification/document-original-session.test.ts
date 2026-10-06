import { describe, expect, it, vi } from 'vitest';
import { DocumentOriginalSession } from '../desktop/services/document-original-session';
import { originalDocumentIdentity } from '../desktop/services/document-original-store';

const pdf = (name: string) => Buffer.from(`%PDF-1.7\n${name}\n%%EOF`);
function fixture(limits = { memoryBytes: 1000, persistentBytes: 1000, pendingMilliseconds: 100 }) {
  let now = 0; const disk = new Map<string, Buffer>();
  const write = vi.fn(async (bytes: Uint8Array) => { const ref = originalDocumentIdentity(bytes); disk.set(ref.sha256, Buffer.from(bytes)); return ref; });
  const read = vi.fn(async (ref: ReturnType<typeof originalDocumentIdentity>) => { const bytes = disk.get(ref.sha256); if (!bytes) throw new Error('Missing original'); return Buffer.from(bytes); });
  return { session: new DocumentOriginalSession({ read, write }, () => now, limits), disk, read, write, advance: (value: number) => { now += value; } };
}

describe('document original session lifetime', () => {
  it('isolates staged metadata from references returned to the importer', async () => {
    const { session, write } = fixture(); const bytes = pdf('isolated metadata');
    const [returned] = session.stage([bytes]); const expected = { ...returned };
    returned.bytes += 1; returned.sha256 = '0'.repeat(64);
    expect(await session.read(expected, [expected])).toEqual(bytes);
    await session.prepare([expected], []);
    expect(write).toHaveBeenCalledWith(bytes, undefined);
  });

  it('retains temporary originals only in memory, captures caller bytes and requires live ownership', async () => {
    const { session, read, write, advance } = fixture(); const bytes = pdf('temporary'), expected = Buffer.from(bytes);
    const [ref] = session.stage([bytes]); bytes.fill(0); session.committed([ref], []); advance(101);
    expect(await session.read(ref, [ref])).toEqual(expected); expect(read).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled();
    await expect(session.read(ref, [])).rejects.toThrow('no longer belongs');
    session.committed([], []); await expect(session.read(ref, [ref])).rejects.toThrow('Missing original');
  });

  it('prepares new persistent originals before commit and releases their in-memory copy after commit', async () => {
    const { session, read, write, disk, advance } = fixture(); const bytes = pdf('saved'), [ref] = session.stage([bytes]);
    await session.prepare([ref, ref], []); expect(write).toHaveBeenCalledOnce(); expect(disk.get(ref.sha256)).toEqual(bytes);
    session.committed([ref], [ref]); advance(101); expect(await session.read(ref, [ref])).toEqual(bytes); expect(read).toHaveBeenCalledOnce();
    await session.prepare([ref], [ref]); expect(write).toHaveBeenCalledOnce(); expect(read).toHaveBeenCalledOnce();
  });

  it('keeps the staged bytes recoverable when preparation fails, so an identical transaction can retry', async () => {
    const { session, write } = fixture(); const bytes = pdf('retry'), [ref] = session.stage([bytes]);
    write.mockRejectedValueOnce(new Error('disk unavailable'));
    await expect(session.prepare([ref], [])).rejects.toThrow('disk unavailable');
    expect(await session.read(ref, [ref])).toEqual(bytes);
    await session.prepare([ref], []); session.committed([ref], [ref]); expect(write).toHaveBeenCalledTimes(2);
  });

  it('expires only unclaimed imports and validates existing originals when no staged bytes are available', async () => {
    const { session, read, disk, advance } = fixture(); const bytes = pdf('pending'), [ref] = session.stage([bytes]);
    advance(101); session.committed([], []);
    await expect(session.prepare([ref], [])).rejects.toThrow('Missing original');
    disk.set(ref.sha256, bytes); await session.prepare([ref], []); expect(read).toHaveBeenCalledTimes(2);
    expect(await session.read(ref, [ref])).toEqual(bytes);
  });

  it('rejects capacity changes atomically and deduplicates a batch without discarding earlier pending imports', async () => {
    const one = pdf('one'), two = pdf('two');
    const { session, advance } = fixture({ memoryBytes: one.length, persistentBytes: one.length, pendingMilliseconds: 100 });
    const [ref] = session.stage([one, one]);
    expect(() => session.stage([two])).toThrow('memory'); expect(await session.read(ref, [ref])).toEqual(one);
    await expect(session.prepare([ref, originalDocumentIdentity(two)], [])).rejects.toThrow('workspace limit');
    expect(() => session.stage([two, Buffer.from('not a PDF')])).toThrow(); expect(await session.read(ref, [ref])).toEqual(one);
    advance(101); const [second] = session.stage([two]); expect(await session.read(second, [second])).toEqual(two);
    await expect(session.read(ref, [ref])).rejects.toThrow('Missing original');
  });

  it('rejects malformed and inconsistent references, oversized batches and cancellation before persistence', async () => {
    const { session, write } = fixture(); const [ref] = session.stage([pdf('identity')]); const wrong = { ...ref, bytes: ref.bytes + 1 };
    await expect(session.prepare([ref, wrong], [])).rejects.toThrow('conflicting metadata');
    await expect(session.prepare([wrong], [ref])).rejects.toThrow('metadata cannot change');
    await expect(session.prepare([wrong], [])).rejects.toThrow('metadata cannot change');
    await expect(session.read(wrong, [ref])).rejects.toThrow('no longer belongs');
    await expect(session.read(wrong, [wrong])).rejects.toThrow('metadata cannot change');
    await expect(session.read({ ...ref, sha256: '../outside' }, [ref])).rejects.toThrow('Invalid original');
    expect(() => session.stage(Array.from({ length: 13 }, () => pdf('same')))).toThrow('import limit');
    const controller = new AbortController(); controller.abort();
    await expect(session.prepare([ref], [], controller.signal)).rejects.toThrow(); await expect(session.read(ref, [ref], controller.signal)).rejects.toThrow();
    expect(write).not.toHaveBeenCalled();
  });
});
