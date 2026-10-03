import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function createPluginFixture(source, domain = '127.0.0.1:9999') {
  await mkdir(join(source, 'ui'), { recursive: true });
  const manifest = { schemaVersion: 1, id: 'example.evidence', name: '验证插件', version: '1.0.0', description: '验证插件工具、命令与隔离面板。', author: 'Qiyao verification', main: 'main.js',
    permissions: ['tools', 'commands', 'panels', 'storage', 'project.read', 'project.write', 'network'], domains: [domain],
    tools: [{ name: 'evidence', description: 'Plugin evidence with optional input', parameters: { type: 'object', properties: { text: { type: 'string' }, action: { type: 'string', enum: ['echo', 'read', 'write', 'network', 'slow'] } }, additionalProperties: false } }],
    commands: [{ id: 'greet', title: '插件问候', description: '保存调用次数并检查运行环境。' }], panels: [{ id: 'dashboard', title: '插件仪表板', entry: 'ui/index.html' }] };
  await writeFile(join(source, 'qiyao-plugin.json'), JSON.stringify(manifest, null, 2));
  await writeFile(join(source, 'LICENSE'), 'Qiyao verification fixture license. Preserve this complete asset.');
  await writeFile(join(source, 'image.bin'), Buffer.from([0, 255, 128]));
  await writeFile(join(source, 'main.js'), `export default async function activate(api) {
  api.registerTool('evidence', async (args, context) => {
    if(args.action === 'read') { const credentialsBlocked=await api.call('project.document',{path:'.env'},context.token).then(()=>false,()=>true); if(!credentialsBlocked) throw new Error('Private file was readable'); return {...await api.call('project.document',{path:'README.md'},context.token),credentialsBlocked}; }
    if(args.action === 'write') return api.call('project.write', {path:'plugin-created.txt',content:args.text || 'PLUGIN_WRITE_EVIDENCE',expected_sha256:null}, context.token);
    if(args.action === 'network') return api.call('network.fetch', {url:'http://${domain}/plugin-evidence'}, context.token);
    if(args.action === 'slow') { await new Promise(resolve => setTimeout(resolve, 120000)); return 'SHOULD_NOT_FINISH'; }
    return {text:args.text ?? 'PLUGIN_TOOL_EVIDENCE',node:typeof process,require:typeof require,app:typeof window.qiyao};
  });
  api.registerCommand('greet', async () => { const count=(await api.call('storage.get',{key:'count'}) || 0)+1; await api.call('storage.set',{key:'count',value:count}); return {text:'PLUGIN_COMMAND_EVIDENCE',count,node:typeof process,require:typeof require}; });
}`);
  await writeFile(join(source, 'ui/index.html'), '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>插件仪表板</title><link rel="stylesheet" href="/_qiyao/theme.css"><h2>插件仪表板</h2><p>调用你允许的命令，保存自己的工作记录。</p><button id="greet" disabled>运行插件问候</button><pre id="result" aria-label="面板命令结果">正在加载…</pre><script type="module" src="panel.js"></script></html>');
  await writeFile(join(source, 'ui/panel.js'), `import api from '/_qiyao/panel-sdk.js';
const result=document.querySelector('#result'); const button=document.querySelector('#greet'); globalThis.panelEvents=[]; addEventListener('pointerdown',event=>panelEvents.push({type:'pointerdown',target:event.target.id,x:event.clientX,y:event.clientY}));
button.addEventListener('click',async()=>{panelEvents.push({type:'click'});button.disabled=true;result.textContent='正在执行…';try{result.textContent=JSON.stringify(await api.call('command.run',{name:'greet'}));}catch(error){result.textContent=error.message;}finally{button.disabled=false;}});
let parentBlocked=false; try { void parent.qiyao; } catch { parentBlocked=true; }
result.textContent=JSON.stringify({context:await api.call('context'),node:typeof process,require:typeof require,app:typeof window.qiyao,parentBlocked});
button.disabled=false;`);
  return manifest;
}
