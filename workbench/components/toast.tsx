import { useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconButton } from './controls';

export function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  const [host, setHost] = useState<HTMLElement>(document.body);
  useLayoutEffect(() => {
    const update = () => setHost([...document.querySelectorAll<HTMLDialogElement>('dialog[open]')].at(-1) ?? document.body);
    update(); const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open'] });
    return () => observer.disconnect();
  }, []);
  return createPortal(<div className="toast" role="alert"><span>{message}</span><IconButton icon="close" label="关闭提示" onClick={onClose} /></div>, host);
}
