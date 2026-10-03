import assert from 'node:assert/strict';

export function chatNavigationFixture() {
  let pending;
  return { requests: [], async handle(request, response) {
    if (!request.url?.startsWith('/chat-navigation/')) return false;
    assert.equal(request.url, '/chat-navigation/v1/chat/completions'); assert.equal(request.headers.authorization, 'Bearer CHAT_NAVIGATION_TEST_KEY');
    let body = ''; for await (const chunk of request) body += chunk; const input = JSON.parse(body); assert.equal(input.stream, true); assert.equal(input.messages.at(-1).content, 'CHAT_NAV_STREAM_REQUEST'); this.requests.push(input);
    response.writeHead(200, { 'Content-Type': 'text/event-stream' }); response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'STREAM_FIND_NEEDLE\n\n正在继续生成。' }, finish_reason: null }] })}\n\n`);
    pending = response; response.once('close', () => { if (pending === response) pending = undefined; }); return true;
  }, finish() {
    if (!pending) return;
    pending.end(`data: ${JSON.stringify({ choices: [{ delta: { content: '\n\nSTREAM_FIND_NEEDLE 已完成。' }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })}\n\ndata: [DONE]\n\n`); pending = undefined;
  } };
}
