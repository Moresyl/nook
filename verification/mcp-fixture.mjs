import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, GetPromptRequestSchema, ListPromptsRequestSchema, ListResourcesRequestSchema, ListResourceTemplatesRequestSchema, ListToolsRequestSchema, ReadResourceRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { spawn } from 'node:child_process';

const server = new Server({ name: 'qiyao-verification', version: '1.0' }, { capabilities: { tools: {}, resources: {}, prompts: {} } });
server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: [{ name: '验证文档', uri: 'fixture://document' }, { name: '验证二进制', uri: 'fixture://binary' }] }));
server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({ resourceTemplates: [{ name: '用户资料', uriTemplate: 'fixture://profiles/{user}' }] }));
server.setRequestHandler(ReadResourceRequestSchema, async (request) => ({ contents: request.params.uri === 'fixture://binary' ? [{ uri: request.params.uri, blob: 'AP8=', mimeType: 'application/octet-stream' }] : [{ uri: request.params.uri, text: `MCP_RESOURCE_EVIDENCE:${request.params.uri}` }] }));
server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: [{ name: 'review', description: '整理指定主题', arguments: [{ name: 'topic', required: true }, { name: 'style', required: false }] }] }));
server.setRequestHandler(GetPromptRequestSchema, async (request) => ({ messages: [{ role: 'user', content: { type: 'text', text: `MCP_PROMPT_EVIDENCE:${request.params.arguments?.topic}` } }, { role: 'assistant', content: { type: 'resource', resource: { uri: 'fixture://document', text: 'PROMPT_EMBEDDED_RESOURCE' } } }] }));
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: 'echo', description: 'Echo real process evidence', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, additionalProperties: false } }, { name: 'child', inputSchema: { type: 'object', properties: {} } }] }));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === 'child') {
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore', windowsHide: true });
    return { content: [{ type: 'text', text: JSON.stringify({ pid: process.pid, child: child.pid }) }] };
  }
  return { content: [{ type: 'text', text: `STDIO_EVIDENCE:${request.params.arguments?.text ?? 'optional'}:${process.env.QIYAO_FIXTURE_SECRET ?? ''}` }] };
});
await server.connect(new StdioServerTransport());
