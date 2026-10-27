import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { projectFolderNameSchema } from '../../contracts/projects';
import { Button, Input, Modal } from './controls';

export function ProjectFolderDialog({ projectId, directory, onCreated, onClose }: { projectId: string; directory: string; onCreated: (path: string) => void; onClose: () => void }) {
  const [name, setName] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const locked = useRef(false), mounted = useRef(true), input = useRef<HTMLInputElement>(null), errorId = useId();
  const valid = projectFolderNameSchema.safeParse(name).success;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useLayoutEffect(() => { if (error && !busy) input.current?.focus({ preventScroll: true }); }, [error, busy]);
  async function create() {
    if (locked.current || !valid) return;
    locked.current = true; setBusy(true); setError('');
    try {
      const path = await window.qiyao.createProjectFolder(projectId, { directory, name });
      if (mounted.current) onCreated(path);
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error && cause.message.includes('already exists') ? '文件或文件夹已存在，请更换名称。' : '无法创建文件夹，请检查目标目录和权限后重试。');
    } finally { locked.current = false; if (mounted.current) setBusy(false); }
  }
  return <Modal title="新建文件夹" dismissible={!busy} onClose={onClose} footer={<><Button disabled={busy} onClick={onClose}>取消</Button><Button tone="solid" disabled={busy || !valid} onClick={() => { void create(); }}>{busy ? '正在创建…' : '创建'}</Button></>}>
    <p className="muted">创建位置：{directory || '项目根目录'}</p>
    <Input ref={input} autoFocus aria-label="文件夹名称" aria-invalid={name.length > 0 && !valid} aria-describedby={error ? errorId : undefined} maxLength={255} disabled={busy} value={name} onChange={event => { setName(event.target.value); setError(''); }} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) { event.preventDefault(); void create(); } }} />
    {name.length > 0 && !valid && <p className="thread-action-error">请输入有效的文件夹名称。</p>}
    {error && <p id={errorId} role="alert" className="thread-action-error">{error}</p>}
  </Modal>;
}
