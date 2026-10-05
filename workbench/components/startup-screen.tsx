import { Button } from './controls';
import { Emblem } from './glyphs';

export function StartupScreen({ error }: { error: string }) {
  return <div className="startup" role={error ? 'alert' : 'status'} aria-busy={!error}>
    <Emblem size={56} />
    {error ? <><h1>暂时无法打开工作台</h1><p>{error}</p><Button tone="solid" onClick={() => window.location.reload()}>重新加载</Button></> : <p>正在打开你的工作台…</p>}
  </div>;
}
