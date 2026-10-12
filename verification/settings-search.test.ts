import { describe, expect, it } from 'vitest';
import { moveSettingsSelection, settingsMatches, settingsTabs } from '../contracts/settings-search';

describe('settings search destinations', () => {
  it('has unique categories and destinations for all nine supported panels', () => {
    expect(settingsTabs).toHaveLength(9); expect(new Set(settingsTabs.map(tab => tab.id)).size).toBe(9);
    const all = settingsTabs.flatMap(tab => settingsMatches(tab.label));
    for (const tab of settingsTabs) expect(all.some(item => item.id === tab.id && item.tab === tab.id)).toBe(true);
    const unique = new Map(all.map(item => [item.id, item]));
    expect(unique.size).toBe(27); expect([...unique.values()].every(item => settingsTabs.some(tab => tab.id === item.tab))).toBe(true);
  });
  it('matches literal multi-term labels and aliases with exact label priority', () => {
    expect(settingsMatches('  THEME  浅色 ').map(item => item.label)).toEqual(['主题']);
    expect(settingsMatches('工作树 保留').map(item => item.label)).toEqual(['自动清理旧工作树', '保留工作树数量']);
    expect(settingsMatches('主题')[0]).toMatchObject({ tab: 'appearance', focusLabel: '主题' });
    expect(settingsMatches('restore')[0]).toMatchObject({ tab: 'data', focusLabel: '恢复备份…' });
    for (const query of [' ', '', '不存在', '.*', '<script>', '${secret}']) expect(settingsMatches(query)).toEqual([]);
  });
  it('indexes provider form fields only while editing and respects conditional controls', () => {
    expect(settingsMatches('密钥')).toEqual([]);
    expect(settingsMatches('密钥', { kind: 'responses' })[0].focusLabel).toBe('API 密钥');
    expect(settingsMatches('添加模型连接', { kind: 'responses' })).toEqual([]);
    expect(settingsMatches('Azure 接口', { kind: 'responses' })).toEqual([]);
    expect(settingsMatches('API 版本', { kind: 'azure', azureApi: 'responses' })).toEqual([]);
    expect(settingsMatches('API 版本', { kind: 'azure', azureApi: 'deployment-chat' })).toHaveLength(1);
    for (const kind of ['responses', 'anthropic', 'gemini'] as const) expect(settingsMatches('token', { kind })).toEqual([]);
    for (const kind of ['openai', 'ollama'] as const) expect(settingsMatches('token', { kind })).toHaveLength(1);
    expect(settingsMatches('token', { kind: 'azure' })).toEqual([]);
    expect(settingsMatches('token', { kind: 'azure', azureApi: 'responses' })).toEqual([]);
    expect(settingsMatches('token', { kind: 'azure', azureApi: 'chat' })).toHaveLength(1);
  });
  it('never reads or indexes provider secrets, endpoints, names or model values', () => {
    const provider = { kind: 'openai' as const };
    for (const name of ['name', 'endpoint', 'models', 'key']) Object.defineProperty(provider, name, { get() { throw new Error('Private values must not be inspected'); } });
    expect(settingsMatches('API', provider).map(item => item.label)).toEqual(['API 类型', 'API 地址', 'API 密钥']);
  });
  it('bounds query length and does not mutate provider configuration or tabs', () => {
    const provider = { kind: 'azure' as const, azureApi: 'chat' as const }; const before = structuredClone(provider); const tabs = structuredClone(settingsTabs);
    expect(settingsMatches('x'.repeat(512), provider)).toEqual([]); expect(() => settingsMatches('x'.repeat(513))).toThrow('512');
    settingsMatches('API', provider); expect(provider).toEqual(before); expect(settingsTabs).toEqual(tabs);
  });
});

describe('settings result keyboard selection', () => {
  it('starts unselected, wraps arrow selection and supports endpoints', () => {
    const results = settingsMatches('工作树'); const first = results[0].id; const last = results.at(-1)!.id;
    expect(moveSettingsSelection(results, '', 'Enter')).toBe(''); expect(moveSettingsSelection(results, '', 'ArrowDown')).toBe(first);
    expect(moveSettingsSelection(results, '', 'ArrowUp')).toBe(last); expect(moveSettingsSelection(results, first, 'ArrowUp')).toBe(last);
    expect(moveSettingsSelection(results, last, 'ArrowDown')).toBe(first); expect(moveSettingsSelection(results, last, 'Home')).toBe(first);
    expect(moveSettingsSelection(results, first, 'End')).toBe(last); expect(moveSettingsSelection(results, first, 'Enter')).toBe(first);
  });
  it('safely handles empty results and stale selection after query or form changes', () => {
    for (const key of ['Home', 'End', 'ArrowDown', 'ArrowUp', 'Enter']) expect(moveSettingsSelection([], 'gone', key)).toBe('');
    const results = settingsMatches('主题'); expect(moveSettingsSelection(results, 'gone', 'ArrowDown')).toBe(results[0].id);
    expect(moveSettingsSelection(results, 'gone', 'ArrowUp')).toBe(results.at(-1)!.id); expect(moveSettingsSelection(results, 'gone', 'Enter')).toBe('');
  });
});
