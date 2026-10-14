import { useLayoutEffect } from 'react';
import type { Workspace } from '../../contracts/workspace';

export function useChatFontSettings(preferences?: Workspace['preferences']) {
  const chat = preferences?.chatFontSize, code = preferences?.chatCodeFontSize;
  useLayoutEffect(() => {
    const style = document.documentElement.style;
    if (chat === undefined) style.removeProperty('--chat-font-size');
    else style.setProperty('--chat-font-size', `${chat}px`);
    if (code === undefined) style.removeProperty('--chat-code-font-size');
    else style.setProperty('--chat-code-font-size', `${code}px`);
  }, [chat, code]);
}
