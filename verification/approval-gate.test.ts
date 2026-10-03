import { describe, expect, it, vi } from 'vitest';
import { ApprovalGate } from '../desktop/services/approval-gate';
import type { ApprovalDetails } from '../contracts/tools';

const details: ApprovalDetails = { kind: 'file', root: 'project', path: 'notes.txt', exists: true, before: 'Before', after: 'After' };
describe('per-action approvals', () => {
  it('shows the exact proposal, snapshots pending requests and releases a granted action', async () => {
    const emit = vi.fn(); const gate = new ApprovalGate(emit);
    const pending = gate.ask('thread', 'message', 'write_file', details, new AbortController().signal);
    const request = gate.pending()[0];
    expect(emit.mock.calls[0][0].approval).toEqual(request);
    request.details = { kind: 'command', program: 'wrong', args: [], cwd: '.', timeout: 10 };
    expect(gate.pending()[0].details).toEqual(details);
    gate.resolve(request.id, true);
    expect(await pending).toBe(true);
    expect(gate.pending()).toEqual([]);
    expect(emit.mock.calls[1][0].approvalResolved).toBe(request.id);
    expect(() => gate.resolve(request.id, true)).toThrow('no longer pending');
  });
  it('keeps decisions separate across concurrent conversations and respects denial', async () => {
    const gate = new ApprovalGate(() => {});
    const first = gate.ask('first', 'm1', 'write_file', details, new AbortController().signal);
    const second = gate.ask('second', 'm2', 'write_file', details, new AbortController().signal);
    const requests = gate.pending();
    gate.resolve(requests[1].id, false); gate.resolve(requests[0].id, true);
    expect(await first).toBe(true); expect(await second).toBe(false);
  });
  it('cancels pending approvals when stopped and rejects already cancelled requests', async () => {
    const gate = new ApprovalGate(() => {}); const controller = new AbortController();
    const promise = gate.ask('thread', 'message', 'write_file', details, controller.signal);
    controller.abort(); await expect(promise).rejects.toThrow('cancelled');
    expect(gate.pending()).toEqual([]);
    expect(() => gate.ask('thread', 'message', 'write_file', details, controller.signal)).toThrow();
  });
});
