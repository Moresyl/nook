import { describe, expect, it } from 'vitest';
import { composerActions, composerQuery, consumeComposerQuery, insertComposerPrompt, moveComposerAction } from '../contracts/composer-actions';
import { promptTemplateLimits, type PromptTemplate } from '../contracts/prompt-templates';
import type { Assistant, Project } from '../contracts/workspace';

const template = (id: string, title = '写作'): PromptTemplate => ({ id, title, description: '写作说明', content: 'TEXT' });
const input = { templates: [template('one'), template('two', 'Writing')], assistants: [{ id: 'assistant', name: '助手一' }] as Assistant[], projects: [{ id: 'project', name: '项目一' }] as Project[], tools: true, knowledge: true };

describe('composer quick selection', () => {
  it('finds only collapsed slash queries at word boundaries and retains exact UTF-16 offsets', () => {
    expect(composerQuery('/', 1)).toEqual({ source: '/', start: 0, end: 1, query: '' });
    const text = '保留😀\n /写作\n尾文'; const end = text.indexOf('\n尾文');
    expect(composerQuery(text, end)).toEqual({ source: text, start: text.indexOf('/'), end, query: '写作' });
    for (const text of ['https://host', 'a/template', '/a/b', '/has space', '//', '/'+ 'x'.repeat(81)]) expect(composerQuery(text, text.length)).toBeNull();
    for (const position of [-1, Infinity, NaN, 0.5, 4]) expect(composerQuery('/', position)).toBeNull();
    expect(composerQuery('/test', 3)).toBeNull(); expect(composerQuery('/test', 5, 1)).toBeNull();
    expect(composerQuery('中文 /中文', 6)).not.toBeNull();
  });
  it('consumes only the selected query and rejects changed text or forged ranges', () => {
    const text = 'KEEP /写作\nTAIL'; const query = composerQuery(text, 8)!;
    expect(consumeComposerQuery(text, query)).toBe('KEEP \nTAIL'); expect(consumeComposerQuery(text)).toBe(text);
    expect(() => consumeComposerQuery(text + 'changed', query)).toThrow('草稿已变化');
    for (const change of [{ start: 0 }, { end: Infinity }, { query: 'wrong' }, { source: 'other' }]) expect(() => consumeComposerQuery(text, { ...query, ...change })).toThrow('草稿已变化');
  });
  it('inserts a template at the chosen caret range with exact surrounding text, without sending or trimming', () => {
    const text = '  KEEP /写作\nTAIL  '; const query = composerQuery(text, text.indexOf('\n'))!;
    expect(insertComposerPrompt(text, '  PROMPT\nTEXT  ', query)).toBe('  KEEP   PROMPT\nTEXT  \nTAIL  ');
    expect(insertComposerPrompt('KEEP', 'TEXT')).toBe('KEEP\n\nTEXT');
    expect(() => insertComposerPrompt(text + 'changed', 'TEXT', query)).toThrow('草稿已变化');
    expect(() => insertComposerPrompt('/', ' ', composerQuery('/', 1)!)).toThrow();
    const long = 'x'.repeat(promptTemplateLimits.draft - 2) + ' /'; const at = composerQuery(long, long.length)!;
    expect(insertComposerPrompt(long, 'x', at)).toHaveLength(promptTemplateLimits.draft);
    expect(() => insertComposerPrompt(long, 'xx', at)).toThrow('256 KB');
    expect(() => insertComposerPrompt('/', 'x'.repeat(promptTemplateLimits.draft + 1), composerQuery('/', 1)!)).toThrow();
  });
  it('searches actual templates, assistants, projects and available pickers without making model requests', () => {
    const actions = composerActions(input, ''); expect(actions).toHaveLength(8); expect(new Set(actions.map(item => item.key)).size).toBe(8);
    expect(composerActions(input, 'WRITING')[0].id).toBe('two'); expect(composerActions(input, 'Ｗｒｉｔｉｎｇ')[0].id).toBe('two');
    expect(composerActions(input, '模板')).toHaveLength(2); expect(composerActions(input, 'no-match')).toEqual([]);
    expect(composerActions({ ...input, tools: false, knowledge: false }, '').some(item => item.kind === 'tools' || item.kind === 'knowledge')).toBe(false);
    expect(composerActions({ ...input, templates: [template('prefix', 'Writing extra'), template('exact', 'Writing'), template('contains', 'Extra Writing')] }, 'writing').map(item => item.id)).toEqual(['exact', 'prefix', 'contains']);
    expect(composerActions({ ...input, templates: Array.from({ length: 120 }, (_, index) => template(String(index))) }, '')).toHaveLength(100);
  });
  it('cycles only current results and handles empty or changed lists', () => {
    const actions = composerActions(input, ''); const first = actions[0].key; const last = actions.at(-1)!.key;
    expect(moveComposerAction([], first, 'ArrowDown')).toBe('');
    expect(moveComposerAction(actions, '', 'ArrowUp')).toBe(last); expect(moveComposerAction(actions, '', 'ArrowDown')).toBe(first);
    expect(moveComposerAction(actions, last, 'ArrowDown')).toBe(first); expect(moveComposerAction(actions, first, 'ArrowUp')).toBe(last);
    expect(moveComposerAction(actions, first, 'End')).toBe(last); expect(moveComposerAction(actions, last, 'Home')).toBe(first);
    expect(moveComposerAction(actions, '', 'other')).toBe(first); expect(moveComposerAction(actions, last, 'other')).toBe(last);
  });
});
