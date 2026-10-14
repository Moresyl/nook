import type { Workspace } from '../../contracts/workspace';
import { Field, Select } from './controls';

type Props = { preferences: Workspace['preferences']; busy: boolean; onChange(preferences: Workspace['preferences']): void };
const sizes = Array.from({ length: 15 }, (_, index) => index + 10);

export function ChatFontSettings({ preferences, busy, onChange }: Props) {
  function change(field: 'chatFontSize' | 'chatCodeFontSize', value: string) {
    const next = { ...preferences };
    if (value === '') delete next[field]; else next[field] = Number(value);
    onChange(next);
  }
  return <>{(['chatFontSize', 'chatCodeFontSize'] as const).map(field => <Field key={field} label={field === 'chatFontSize' ? '对话字号' : '代码字号'} hint={field === 'chatFontSize' ? '调整主工作台与快速聊天的消息文字。' : '单独调整消息中的代码，保留界面控件的字号。'}><Select disabled={busy} value={preferences[field] ?? ''} onChange={event => change(field, event.target.value)}><option value="">默认</option>{sizes.map(size => <option key={size} value={size}>{size} px</option>)}</Select></Field>)}</>;
}
