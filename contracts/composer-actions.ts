import { appendPrompt, promptTemplateLimits, type PromptTemplate } from './prompt-templates';
import type { Assistant, Project } from './workspace';

export type ComposerQuery = { source: string; start: number; end: number; query: string };
export type ComposerAction = { key: string; kind: 'template' | 'assistant' | 'project' | 'tools' | 'knowledge'; id: string; title: string; description: string; group: string };

export function composerQuery(text: string, start: number, end = start): ComposerQuery | null {
  if (!Number.isInteger(start) || start !== end || start < 0 || start > text.length || (start < text.length && !/\s/u.test(text[start]))) return null;
  const match = /(?:^|\s)\/([^\s/]{0,80})$/u.exec(text.slice(0, start));
  if (!match) return null;
  return { source: text, start: start - match[1].length - 1, end: start, query: match[1] };
}

export function consumeComposerQuery(text: string, query?: ComposerQuery): string {
  if (!query) return text;
  const current = composerQuery(text, query.end);
  if (text !== query.source || !current || current.start !== query.start || current.query !== query.query) throw new Error('草稿已变化，快捷选择未应用。请在当前草稿重新选择。');
  return text.slice(0, query.start) + text.slice(query.end);
}

export function insertComposerPrompt(text: string, prompt: string, query?: ComposerQuery): string {
  if (!query) return appendPrompt(text, prompt);
  consumeComposerQuery(text, query); appendPrompt('', prompt);
  const next = text.slice(0, query.start) + prompt + text.slice(query.end);
  if (next.length > promptTemplateLimits.draft) throw new Error('The combined draft exceeds 256 KB. Shorten the draft before adding this prompt.');
  return next;
}

export function composerActions(input: { templates: PromptTemplate[]; assistants: Assistant[]; projects: Project[]; tools: boolean; knowledge: boolean }, query: string): ComposerAction[] {
  const items: ComposerAction[] = [];
  const add = (kind: ComposerAction['kind'], id: string, title: string, description: string, group: string) => items.push({ key: JSON.stringify([kind, id]), kind, id, title, description, group });
  for (const item of input.templates) add('template', item.id, item.title, item.description, '模板');
  add('assistant', '', '默认助手', '使用默认助手，保留当前草稿', '助手');
  for (const item of input.assistants) add('assistant', item.id, item.name, '切换助手，保留当前草稿', '助手');
  add('project', '', '独立聊天', '移除项目关联，保留当前草稿', '项目');
  for (const item of input.projects) add('project', item.id, item.name, '切换项目，保留当前草稿', '项目');
  if (input.tools) add('tools', '', '工具与技能', '选择本次对话可用的工具与技能', '工具');
  if (input.knowledge) add('knowledge', '', '资料集', '选择本次对话检索的资料集', '资料');
  const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase();
  const needle = normalize(query).trim();
  const rank = (item: ComposerAction) => normalize(item.title) === needle ? 0 : normalize(item.title).startsWith(needle) ? 1 : 2;
  return items.filter(item => !needle || normalize(`${item.title} ${item.description} ${item.group}`).includes(needle)).sort((a, b) => rank(a) - rank(b)).slice(0, 100);
}

export function moveComposerAction(items: ComposerAction[], current: string, key: string): string {
  if (!items.length) return '';
  if (key === 'Home') return items[0].key;
  if (key === 'End') return items.at(-1)!.key;
  const index = items.findIndex(item => item.key === current);
  if (key !== 'ArrowDown' && key !== 'ArrowUp') return items[index < 0 ? 0 : index].key;
  const direction = key === 'ArrowDown' ? 1 : -1;
  return items[index < 0 ? direction < 0 ? items.length - 1 : 0 : (index + direction + items.length) % items.length].key;
}
