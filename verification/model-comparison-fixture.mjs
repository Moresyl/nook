import assert from 'node:assert/strict';

export function modelComparisonFixture() {
  const pending = new Map();
  const finish = (response, model, timing) => {
    timing.completionQueuedAt = Date.now();
    response.end(`data: ${JSON.stringify({ choices: [{ delta: { content: `\n${model}: COMPLETE <img> {{literal}} 中文😀` }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 6, total_tokens: 18 } })}\n\ndata: [DONE]\n\n`, () => { timing.completionFlushedAt = Date.now(); });
  };
  return { requests: [], timeline: [], async handle(request, response) {
    if (!request.url?.startsWith('/model-comparison/')) return false;
    const match = /^\/model-comparison\/(a|b)\/v1\/chat\/completions$/.exec(request.url); assert.ok(match);
    assert.equal(request.headers.authorization, `Bearer COMPARISON_${match[1].toUpperCase()}_TEST_KEY`);
    let body = ''; for await (const chunk of request) body += chunk;
    const input = JSON.parse(body); assert.equal(input.stream, true); assert.ok(['one', 'two', 'fail', 'held'].includes(input.model)); assert.equal(input.tools, undefined);
    this.requests.push({ connection: match[1], ...input });
    const timing = { receivedAt: Date.now(), connection: match[1], model: input.model, messages: input.messages.length };
    this.timeline.push(timing); if (this.timeline.length > 16) this.timeline.shift(); response.once('close', () => { timing.closedAt = Date.now(); });
    if (input.model === 'fail') { response.writeHead(503, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ error: { message: 'Fixture model unavailable' } })); timing.failureSentAt = Date.now(); return true; }
    response.writeHead(200, { 'Content-Type': 'text/event-stream' }); response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: `${input.model}: PARTIAL` }, finish_reason: null }] })}\n\n`);
    timing.partialSentAt = Date.now();
    pending.set(response, { model: input.model, timing }); response.once('close', () => pending.delete(response)); return true;
  }, finish(model) { for (const [response, { model: selected, timing }] of pending) if ((!model && selected !== 'held') || selected === model) { pending.delete(response); finish(response, selected, timing); } } };
}
