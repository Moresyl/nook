import assert from 'node:assert/strict';

export function replyProviderFixture(prefix = '/reply-versions/') {
  const fixture = { requests: [], texts: [], mode: 'reply', stoppedStreams: 0, async handle(request, response) {
    if (!request.url?.startsWith(prefix)) return false;
    assert.equal(request.url, `${prefix}v1/chat/completions`); assert.equal(request.headers.authorization, 'Bearer REPLY_VERSION_TEST_KEY');
    let body = ''; for await (const chunk of request) body += chunk; const input = JSON.parse(body); assert.equal(input.stream, true); fixture.requests.push(input);
    const mode = fixture.mode; fixture.mode = 'reply';
    if (mode === 'fail') { fixture.texts.push(''); response.writeHead(503, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ error: { message: 'Synthetic reply provider failure' } })); return true; }
    const text = mode === 'stop' ? 'PARTIAL_REPLY_VERSION' : `REPLY_VERSION_RESPONSE_${fixture.requests.length} 中文😀 $& {{literal}} <img src="https://example.invalid/reply.png">`;
    fixture.texts.push(text); response.writeHead(200, { 'Content-Type': 'text/event-stream' }); response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: null }] })}\n\n`);
    if (mode === 'stop') { response.once('close', () => { fixture.stoppedStreams++; }); return true; }
    response.end(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })}\n\ndata: [DONE]\n\n`); return true;
  } };
  return fixture;
}
