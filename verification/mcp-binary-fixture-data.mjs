import sharp from 'sharp';

export async function mcpBinaryFixtureData() {
  const png = await sharp({ create: { width: 64, height: 48, channels: 4, background: { r: 42, g: 150, b: 110, alpha: 0.7 } } }).png().toBuffer();
  return { png, generic: Buffer.from('MCP_BINARY_ORIGINAL 中文😀\0\xff'), empty: Buffer.alloc(0), svg: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>throw new Error("MCP_SVG_INERT")</script></svg>'), broken: Buffer.from('MCP_BROKEN_PNG_PRIVATE'), audio: Buffer.from('RIFF_MCP_AUDIO_ORIGINAL') };
}
