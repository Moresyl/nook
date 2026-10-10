import assert from 'node:assert/strict';

export function contextSummaryFixture() {
  const requests = [], closed = [];
  return { requests, closed, async handle(request, response) {
    if (!request.url?.startsWith('/context-summary/')) return false;
    assert.equal(request.url, '/context-summary/v1/chat/completions');
    let data = ''; for await (const chunk of request) data += chunk;
    const input = JSON.parse(data); assert.equal(input.tools, undefined); assert.equal(input.stream, true);
    const summary = input.messages[0]?.role === 'system' && input.messages[0].content.startsWith('Summarize the supplied conversation');
    const row = { ...input, summary, index: requests.length }; requests.push(row);
    response.once('close', () => closed.push(row.index));
    if (input.model === 'fail') { response.writeHead(503); response.end('unavailable'); return true; }
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    if (input.model === 'held') { response.write(': waiting for cancellation\n\n'); return true; }
    const content = summary ? `SUMMARY_GENERATED_${row.index}\n约束：保留原文；待完成：验证。\n<img src=x onerror=alert(1)> {{literal}} 😀` : `CONTEXT_REPLY_${row.index}`;
    response.end(`data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 70, completion_tokens: 20, total_tokens: 90 } })}\n\ndata: [DONE]\n\n`);
    return true;
  } };
}
