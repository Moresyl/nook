import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export function attachmentProviderFixture() {
  const requests = [];
  async function handle(request, response) {
    const url = new URL(request.url, 'http://localhost'); if (!url.pathname.startsWith('/attachments/')) return false;
    const protocol = url.pathname.split('/')[2]; let raw = ''; for await (const chunk of request) raw += chunk; const body = JSON.parse(raw);
    const history = body.contents ?? body.input ?? body.messages; const user = history.findLast((item) => item.role === 'user'); const parts = user.parts ?? user.content;
    assert.ok(Array.isArray(parts)); const image = parts.find((part) => part.inlineData || part.type === 'image' || part.type === 'input_image' || part.type === 'image_url'); assert.ok(image, 'The native request must contain image bytes');
    const data = image.inlineData?.data ?? image.source?.data ?? (image.image_url?.url ?? image.image_url).split(',')[1]; const bytes = Buffer.from(data, 'base64'); assert.equal(bytes[0], 255); assert.equal(bytes[1], 216); assert.equal(bytes.at(-2), 255); assert.equal(bytes.at(-1), 217);
    const text = parts.map((part) => part.text ?? '').join('\n'); assert.ok(text.includes('Document evidence')); assert.ok(text.includes('42')); assert.ok(text.includes('ATTACHMENT_NATIVE_'));
    if (protocol === 'gemini') { assert.equal(request.headers['x-goog-api-key'], 'attachment-fixture-key'); assert.equal(image.inlineData.mimeType, 'image/jpeg'); }
    else if (protocol === 'anthropic') { assert.equal(request.headers['x-api-key'], 'attachment-fixture-key'); assert.equal(image.source.media_type, 'image/jpeg'); }
    else if (protocol.startsWith('azure')) assert.equal(request.headers['api-key'], 'attachment-fixture-key');
    if (protocol === 'azure-deployment') { assert.equal(url.searchParams.get('api-version'), '2024-10-21'); assert.ok(url.pathname.includes('/deployments/attachment-model/chat/completions')); }
    requests.push({ protocol, imageSha256: createHash('sha256').update(bytes).digest('hex'), documentEvidence: true });
    const answer = `ATTACHMENT_NATIVE_COMPLETE ${protocol}`; response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(protocol === 'gemini' ? { candidates: [{ index: 0, content: { role: 'model', parts: [{ text: answer }] }, finishReason: 'STOP' }] }
      : protocol === 'anthropic' ? { content: [{ type: 'text', text: answer }], stop_reason: 'end_turn' }
      : protocol === 'responses' || protocol === 'azure-responses' ? { status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: answer }] }] }
      : { choices: [{ message: { content: answer }, finish_reason: 'stop' }] })); return true;
  }
  return { handle, requests };
}
