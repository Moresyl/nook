import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { GetPromptRequestSchema, ListPromptsRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema, SubscribeRequestSchema, UnsubscribeRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { mcpPdfFixtureBytes } from './mcp-pdf-fixture-data.mjs';

const original = mcpPdfFixtureBytes();
let revision = 0, subscribed = false;
const server = new Server({ name: 'pdf-fixture', version: '1' }, { capabilities: { resources: { subscribe: true }, prompts: {} } });
server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: ['document', 'broken', 'change'].map(name => ({ name, uri: `fixture://pdf/${name}`, mimeType: name === 'change' ? 'text/plain' : 'application/pdf' })) }));
server.setRequestHandler(SubscribeRequestSchema, async () => { subscribed = true; return {}; });
server.setRequestHandler(UnsubscribeRequestSchema, async () => { subscribed = false; return {}; });
server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: [{ name: 'document', description: 'PDF prompt evidence' }] }));
server.setRequestHandler(GetPromptRequestSchema, async () => ({ messages: [{ role: 'user', content: { type: 'resource', resource: { uri: 'fixture://pdf/document', mimeType: 'application/pdf', blob: original.toString('base64') } } }] }));
server.setRequestHandler(ReadResourceRequestSchema, async request => {
  if (request.params.uri === 'fixture://pdf/change') {
    revision++;
    if (subscribed) await server.sendResourceUpdated({ uri: 'fixture://pdf/document' });
    return { contents: [{ uri: request.params.uri, text: 'changed' }] };
  }
  const bytes = request.params.uri === 'fixture://pdf/broken' ? Buffer.from('MCP_PDF_PRIVATE_INVALID') : revision ? Buffer.from(original.toString().replace('Document evidence', 'Updated evidence ')) : original;
  return { contents: [{ uri: request.params.uri, text: `MCP_PDF_REVISION_${revision}`, mimeType: 'text/plain' }, { uri: request.params.uri, mimeType: 'application/pdf', blob: bytes.toString('base64') }] };
});
await server.connect(new StdioServerTransport());
