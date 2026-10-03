import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { GetPromptRequestSchema, ListPromptsRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { mcpBinaryFixtureData } from './mcp-binary-fixture-data.mjs';

const bytes = await mcpBinaryFixtureData();
const mimeTypes = { png: 'image/png', generic: 'application/octet-stream', empty: 'application/octet-stream', svg: 'image/svg+xml', broken: 'image/png', audio: 'audio/wav' };
const server = new Server({ name: 'binary-fixture', version: '1' }, { capabilities: { resources: {}, prompts: {} } });
server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: [...Object.keys(bytes), 'slow'].map((name) => ({ name, uri: `fixture://binary/${name}` })) }));
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const name = request.params.uri.split('/').at(-1);
  if (name === 'slow') { await new Promise((resolve) => setTimeout(resolve, 800)); return { contents: [{ uri: request.params.uri, text: 'MCP_STALE_RESOURCE_TEXT' }] }; }
  if (!Object.hasOwn(bytes, name)) throw new Error('Unknown fixture resource');
  return { contents: [{ uri: request.params.uri, text: 'MCP_BINARY_LITERAL <img src="https://invalid.test/remote" onerror="alert(1)">' }, { uri: request.params.uri, mimeType: mimeTypes[name], blob: bytes[name].toString('base64') }] };
});
server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: [{ name: 'files', description: 'Binary prompt evidence' }] }));
server.setRequestHandler(GetPromptRequestSchema, async () => ({ messages: [
  { role: 'user', content: { type: 'text', text: 'MCP_BINARY_PROMPT_LITERAL <script>throw new Error("inert")</script>' } },
  { role: 'assistant', content: { type: 'image', mimeType: 'image/png', data: bytes.png.toString('base64') } },
  { role: 'assistant', content: { type: 'audio', mimeType: 'audio/wav', data: bytes.audio.toString('base64') } },
] }));
await server.connect(new StdioServerTransport());
