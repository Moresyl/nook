import { contextBridge, ipcRenderer } from 'electron';
import type { PluginInvocation } from '../contracts/plugins';

const tools = new Map<string, (args: unknown, context: PluginInvocation['context']) => unknown>();
const commands = new Map<string, (args: unknown, context: PluginInvocation['context']) => unknown>();
const cancelled = new Set<string>();
let deactivate: (() => unknown) | undefined;
ipcRenderer.on('qiyao:plugin-cancel', (_event, token: string) => { cancelled.add(token); });
ipcRenderer.on('qiyao:plugin-call', async (_event, call: PluginInvocation) => {
  try {
    const handler = call.kind === 'deactivate' ? deactivate : (call.kind === 'tool' ? tools : commands).get(call.name);
    if (!handler && call.kind !== 'deactivate') throw new Error('No handler');
    const value = handler ? await handler(call.arguments, call.context) : null;
    const text = JSON.stringify(value); if (!text || text.length > 256_000) throw new Error('Invalid result');
    ipcRenderer.send('qiyao:plugin-result', call.id, true, JSON.parse(text));
  } catch { ipcRenderer.send('qiyao:plugin-result', call.id, false, null); }
  finally { cancelled.delete(call.context.token); }
});
contextBridge.exposeInMainWorld('qiyaoPlugin', {
  registerTool: (name: string, handler: (args: unknown, context: PluginInvocation['context']) => unknown) => { if (tools.has(name) || typeof handler !== 'function') throw new Error('Duplicate or invalid tool handler'); tools.set(name, handler); },
  registerCommand: (name: string, handler: (args: unknown, context: PluginInvocation['context']) => unknown) => { if (commands.has(name) || typeof handler !== 'function') throw new Error('Duplicate or invalid command handler'); commands.set(name, handler); },
  onDeactivate: (handler: () => unknown) => { deactivate = handler; },
  isCancelled: (token: string) => cancelled.has(token),
  call: (method: string, params: unknown = {}, token?: string) => ipcRenderer.invoke('qiyao:plugin-rpc', method, params, token),
  ready: (failed = false) => ipcRenderer.send('qiyao:plugin-ready', { failed, tools: [...tools.keys()], commands: [...commands.keys()] }),
});
