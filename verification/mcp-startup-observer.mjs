// Optional owned test-process markers; never write to the protocol's stdout.
const report = phase => process.stderr.write(`NOOK_MCP_STARTUP ${JSON.stringify({ phase, at: Date.now() })}\n`);
report('node-entry');
const originalOn = process.stdin.on;
process.stdin.on = function (event, listener) {
  if (event === 'data') {
    process.stdin.on = originalOn;
    report('stdin-listener-ready');
  }
  return originalOn.call(this, event, listener);
};
