import assert from 'node:assert/strict';

export function nativeProviderFixture() {
  const requests = []; const cancellations = [];
  async function handle(request, response) {
    const url = new URL(request.url, 'http://localhost'); if (!url.pathname.startsWith('/native/')) return false;
    const gemini = url.pathname.startsWith('/native/gemini/');
    const responses = url.pathname.endsWith('/responses');
    if (url.pathname.endsWith('/models')) {
      assert.equal(request.headers[gemini ? 'x-goog-api-key' : 'api-key'], 'native-fixture-key');
      const body = gemini ? { models: [{ name: 'models/gemini-native', supportedGenerationMethods: ['generateContent'], inputTokenLimit: 32_768, outputTokenLimit: 8192, thinking: true }, { name: 'models/embedding-native', supportedGenerationMethods: ['embedContent'] }], ...(url.searchParams.has('pageToken') ? {} : { nextPageToken: 'native/+page' }) } : { data: [{ id: 'azure-native' }] };
      if (url.searchParams.has('pageToken')) assert.equal(url.searchParams.get('pageToken'), 'native/+page');
      response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(body)); return true;
    }
    assert.equal(request.headers[gemini ? 'x-goog-api-key' : 'api-key'], 'native-fixture-key'); assert.equal(request.headers.authorization, undefined); assert.equal(url.searchParams.has('key'), false);
    if (gemini) { assert.match(url.pathname, /\/models\/gemini-native:streamGenerateContent$/); assert.equal(url.searchParams.get('alt'), 'sse'); }
    else if (url.pathname.includes('/deployments/')) { assert.match(url.pathname, /\/deployments\/azure-native\/chat\/completions$/); assert.equal(url.searchParams.get('api-version'), '2024-10-21'); }
    else assert.equal(url.searchParams.has('api-version'), false);
    let raw = ''; for await (const chunk of request) raw += chunk; const body = JSON.parse(raw);
    const history = body.contents ?? body.input ?? body.messages;
    const prompt = history.findLast((item) => item.role === 'user' && (typeof item.content === 'string' || item.parts?.some((part) => typeof part.text === 'string')));
    const marker = gemini ? prompt.parts.filter((part) => typeof part.text === 'string').map((part) => part.text).join('') : prompt.content;
    assert.equal(gemini ? body.generationConfig.maxOutputTokens : responses ? body.max_output_tokens : url.pathname.includes('/deployments/') ? body.max_tokens : body.max_completion_tokens, 500);
    if (!gemini && !responses) assert.deepEqual(body.stream_options, { include_usage: true });
    requests.push({ protocol: gemini ? 'gemini' : responses ? 'azure-responses' : url.pathname.includes('/deployments/') ? 'azure-deployment-chat' : 'azure-chat', marker, route: url.pathname + url.search });
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const event = (value) => response.write(`data: ${JSON.stringify(value)}\n\n`);
    const textEvent = (text, done) => gemini ? { candidates: [{ index: 0, content: { role: 'model', parts: [{ text }] }, ...(done ? { finishReason: 'STOP' } : {}) }] }
      : responses ? { type: 'response.output_text.delta', delta: text } : { choices: [{ delta: { content: text }, ...(done ? { finish_reason: 'stop' } : {}) }] };
    const usage = (input, output) => gemini ? { promptTokenCount: input, candidatesTokenCount: output - 4, thoughtsTokenCount: 4, cachedContentTokenCount: 20, totalTokenCount: input + output }
      : responses ? { input_tokens: input, output_tokens: output, total_tokens: input + output, input_tokens_details: { cached_tokens: 20, cache_write_tokens: 5 }, output_tokens_details: { reasoning_tokens: 4 } }
      : { prompt_tokens: input, completion_tokens: output, total_tokens: input + output, prompt_tokens_details: { cached_tokens: 20 }, completion_tokens_details: { reasoning_tokens: 4 } };
    function finish(text, input = 100, output = 20) {
      if (responses) event({ type: 'response.completed', response: { status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }], usage: usage(input, output) } });
      else if (gemini) event({ usageMetadata: usage(input, output) });
      else { event({ choices: [], usage: usage(input, output) }); response.write('data: [DONE]\n\n'); }
      response.end();
    }
    if (marker === 'NATIVE_USAGE_FAILED') { assert.equal(responses, true); event({ type: 'response.incomplete', response: { usage: usage(100, 50) } }); response.end(); return true; }
    if (marker.startsWith('NATIVE_TOOL_')) {
      const results = gemini ? history.flatMap((item) => item.parts ?? []).filter((part) => part.functionResponse) : history.filter((item) => item.type === 'function_call_output' || item.role === 'tool');
      if (results.length) {
        assert.equal(results.length, 1); const result = results[0];
        const output = gemini ? result.functionResponse.response.output : result.output ?? result.content; assert.ok(output.includes('QIYAO_PROJECT_EVIDENCE'));
        if (gemini) { assert.equal(result.functionResponse.id, 'native-tool-call'); assert.equal(result.functionResponse.name, 'read_file'); assert.ok(history.some((item) => item.parts?.some((part) => part.thoughtSignature === 'native-signed-call'))); }
        if (responses) assert.ok(history.some((item) => item.type === 'reasoning' && item.encrypted_content === 'native-encrypted-reasoning'));
        const text = `NATIVE_TOOL_COMPLETE ${marker}`; event(textEvent(text, true)); finish(text, 200, 20); return true;
      }
      const name = 'read_file'; const args = { path: 'README.md', start_line: 1, max_lines: 20 };
      if (gemini) { assert.ok(body.tools[0].functionDeclarations.some((tool) => tool.name === name && tool.parametersJsonSchema)); event({ candidates: [{ index: 0, content: { role: 'model', parts: [{ functionCall: { id: 'native-tool-call', name, args }, thoughtSignature: 'native-signed-call' }] }, finishReason: 'STOP' }], usageMetadata: usage(100, 10) }); }
      else if (responses) { assert.equal(body.store, false); assert.deepEqual(body.include, ['reasoning.encrypted_content']); event({ type: 'response.completed', response: { status: 'completed', output: [{ type: 'reasoning', encrypted_content: 'native-encrypted-reasoning', summary: [] }, { type: 'function_call', call_id: 'native-tool-call', name, arguments: JSON.stringify(args) }], usage: usage(100, 10) } }); }
      else { assert.ok(body.tools.some((tool) => tool.function.name === name)); event({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'native-tool-call', function: { name, arguments: JSON.stringify(args).slice(0, 15) } }] } }] }); event({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify(args).slice(15) } }] }, finish_reason: 'tool_calls' }] }); event({ choices: [], usage: usage(100, 10) }); response.write('data: [DONE]\n\n'); }
      response.end(); return true;
    }
    if (marker.startsWith('NATIVE_SLOW_')) { event({ ...textEvent(`NATIVE_PARTIAL ${marker}`, false), ...(gemini ? { usageMetadata: usage(100, 10) } : {}) }); response.on('close', () => cancellations.push(marker)); return true; }
    const text = `NATIVE_STREAM_COMPLETE ${marker}`; const chunks = [text.slice(0, 7), text.slice(7, 19), text.slice(19)]; let index = 0;
    const timer = setInterval(() => { if (index < chunks.length) { event(textEvent(chunks[index], index === chunks.length - 1)); index++; } else { clearInterval(timer); finish(text); } }, 25);
    response.on('close', () => clearInterval(timer)); return true;
  }
  return { handle, requests, cancellations };
}
