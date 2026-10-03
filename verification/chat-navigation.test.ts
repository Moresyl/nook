import { describe, expect, it } from 'vitest';
import { chatTextMatches, messageMarkerIndex, messageMarkers } from '../contracts/chat-navigation';
import type { Message } from '../contracts/workspace';

const user: Message = { id: '__proto__', role: 'user', content: ' 中文😀\n第二行 $& {{literal}} <img> ', createdAt: 1, status: 'complete', attachments: [] };

describe('chat message navigation', () => {
  it('orders only user turns and preserves message IDs and the complete original text', () => {
    const messages = [{ ...user }, { ...user, id: 'reply', role: 'assistant' as const }, { ...user, id: 'constructor' }]; const before = structuredClone(messages);
    expect(messageMarkers(messages)).toEqual([{ id: '__proto__', number: 1, preview: '中文😀 第二行 $& {{literal}} <img>' }, { id: 'constructor', number: 2, preview: '中文😀 第二行 $& {{literal}} <img>' }]); expect(messages).toEqual(before); expect(messageMarkers([])).toEqual([]);
  });
  it('bounds only previews and describes empty and attachment-only turns', () => {
    expect(messageMarkers([{ ...user, content: 'x'.repeat(1000) }])[0].preview).toHaveLength(160);
    expect(messageMarkers([{ ...user, content: `${'x'.repeat(159)}😀` }])[0].preview).toBe('x'.repeat(159));
    expect(messageMarkers([{ ...user, content: ' \n ' }])[0].preview).toBe('空白消息');
    expect(messageMarkers([{ ...user, content: '', attachments: [{ id: 'file', name: '资料😀.txt', content: 'ORIGINAL_DOCUMENT' }] }])[0].preview).toBe('资料😀.txt');
  });
  it('clamps keyboard focus to available markers without wrapping or inventing an empty target', () => {
    expect(messageMarkerIndex(0, 0, 'Home')).toBe(-1); expect(messageMarkerIndex(-1, 0, 'End')).toBe(-1);
    expect(messageMarkerIndex(3, 1, 'Home')).toBe(0); expect(messageMarkerIndex(3, 1, 'End')).toBe(2); expect(messageMarkerIndex(3, 1, 'ArrowUp')).toBe(0); expect(messageMarkerIndex(3, 1, 'ArrowDown')).toBe(2);
    expect(messageMarkerIndex(3, 0, 'ArrowUp')).toBe(0); expect(messageMarkerIndex(3, 2, 'ArrowDown')).toBe(2); expect(messageMarkerIndex(3, -1, 'Enter')).toBe(0); expect(messageMarkerIndex(3, 9, 'Enter')).toBe(2); expect(messageMarkerIndex(3, 1, 'Enter')).toBe(1);
  });
});

describe('literal chat find offsets', () => {
  it('finds every case-insensitive non-overlapping result with original UTF-16 offsets', () => {
    expect(chatTextMatches('A😀 x X', 'x')).toEqual([{ start: 4, end: 5 }, { start: 6, end: 7 }]);
    expect(chatTextMatches('İ x X', 'x')).toEqual([{ start: 2, end: 3 }, { start: 4, end: 5 }]); expect(chatTextMatches('Σ σ ς', 'σ')).toHaveLength(3); expect(chatTextMatches('aaaaa', 'aa')).toEqual([{ start: 0, end: 2 }, { start: 2, end: 4 }]);
  });
  it('treats metacharacters, markup and Unicode as exact text', () => {
    for (const query of ['a.*b', '[x]', '(a)', '?', '+', '^', '$&', '{literal}', '\\', '|', '中文😀', '<img>']) expect(chatTextMatches(`before ${query} after`, query)).toEqual([{ start: 7, end: 7 + query.length }]);
    expect(chatTextMatches('axxb', 'a.*b')).toEqual([]); expect(chatTextMatches('中文😀😀', '😀')).toEqual([{ start: 2, end: 4 }, { start: 4, end: 6 }]);
  });
  it('retains literal whitespace, reports no matches and rejects excess query length without private input', () => {
    expect(chatTextMatches(' x  x ', ' ')).toHaveLength(4); expect(chatTextMatches('text', '')).toEqual([]); expect(chatTextMatches('text', 'missing')).toEqual([]);
    expect(chatTextMatches('x'.repeat(512), 'x'.repeat(512))).toEqual([{ start: 0, end: 512 }]); expect(() => chatTextMatches('', 'PRIVATE'.repeat(100))).toThrow('Chat search exceeds 512 characters.');
  });
});
