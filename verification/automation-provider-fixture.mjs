import assert from 'node:assert/strict';

export function automationProviderFixture() {
  const requests = []; const errors = []; let cancelled = 0;
  async function handle(request, response) {
    if (!request.url?.startsWith('/automation/')) return false;
    let timer;
    try {
      assert.equal(request.url, '/automation/v1/chat/completions'); assert.equal(request.headers.authorization, 'Bearer AUTOMATION_TEST_KEY');
      let body = ''; for await (const chunk of request) body += chunk; const input = JSON.parse(body); requests.push(input); const prompt = input.messages.filter((item) => item.role === 'user').at(-1).content;
      if (prompt.includes('QIYAO_AUTOMATION_FAIL')) { response.writeHead(503, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ error: { message: 'Synthetic automation provider failure' } })); return true; }
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const send = (content) => response.write(`data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: null }] })}\n\n`);
      if (prompt.includes('QIYAO_AUTOMATION_SLOW')) send('QIYAO_AUTOMATION_PARTIAL');
      timer = setTimeout(() => { send('QIYAO_AUTOMATION_COMPLETE'); response.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 7, total_tokens: 12 } })}\n\n`); response.end('data: [DONE]\n\n'); }, prompt.includes('QIYAO_AUTOMATION_SLOW') ? 15_000 : 500);
      response.once('close', () => { clearTimeout(timer); if (!response.writableEnded) cancelled++; }); return true;
    } catch (error) { clearTimeout(timer); errors.push(error.message); response.destroy(); return true; }
  }
  return { handle, requests, errors, get cancelled() { return cancelled; } };
}
