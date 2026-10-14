import { useLayoutEffect, useRef, useState } from 'react';
import { writeTableClipboard } from '../lib/table-clipboard';

export function useTextCopy(text: string, html?: string) {
  const [copied, setCopied] = useState(false), [copying, setCopying] = useState(false), [error, setError] = useState(false);
  const revision = useRef(0), pending = useRef(false);
  useLayoutEffect(() => {
    revision.current++; pending.current = false; setCopied(false); setCopying(false); setError(false);
    return () => { revision.current++; };
  }, [text, html]);
  async function copy() {
    if (pending.current) return;
    const request = revision.current;
    pending.current = true; setCopied(false); setCopying(true); setError(false);
    try { await writeTableClipboard(text, html); if (request === revision.current) setCopied(true); }
    catch { if (request === revision.current) setError(true); }
    finally { if (request === revision.current) { pending.current = false; setCopying(false); } }
  }
  return { copied, copying, error, copy };
}
