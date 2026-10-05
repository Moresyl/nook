// Consume child output continuously without retaining potentially private content.
export function drainDesktopOutput(stream) {
  let bytes = 0;
  stream.on('data', (chunk) => { bytes += Buffer.byteLength(chunk); });
  return () => bytes;
}
