import { writeFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { attachmentSchema, type Attachment, type AttachmentInput } from '../../contracts/attachments';
import { mcpBinaryFileName, mcpBinaryImageSupported, mcpBinaryItemSchema, type McpBinaryItem } from '../../contracts/mcp-binary';

type Parser = (input: AttachmentInput) => Promise<Attachment>;
type ChooseFile = (name: string) => Promise<string | undefined>;
type Writer = (path: string, bytes: Buffer) => Promise<void>;

export class McpBinaryFiles {
  private busy = false;
  constructor(private readonly parse: Parser, private readonly choose: ChooseFile, private readonly write: Writer = writeFile) {}

  private item(raw: unknown): McpBinaryItem {
    const result = mcpBinaryItemSchema.safeParse(raw);
    if (!result.success) throw new Error('Choose a valid MCP binary item no larger than 2 MB.');
    return result.data;
  }
  private begin(): void {
    if (this.busy) throw new Error('Another MCP file operation is running. Wait and retry.');
    this.busy = true;
  }

  async preview(raw: unknown): Promise<Attachment> {
    const item = this.item(raw);
    if (!mcpBinaryImageSupported(item)) throw new Error('This file has no image preview. Export it to inspect it locally.');
    this.begin();
    try {
      const file = attachmentSchema.parse(await this.parse({ name: mcpBinaryFileName(item), data: item.data }));
      if (!file.image) throw new Error('No image');
      return file;
    } catch { throw new Error('Could not preview this MCP image. Check its format and size, then retry.'); }
    finally { this.busy = false; }
  }

  async export(raw: unknown): Promise<boolean> {
    const item = this.item(raw); this.begin();
    try {
      const path = await this.choose(mcpBinaryFileName(item));
      if (path === undefined) return false;
      if (!isAbsolute(path)) throw new Error('The selected path must be absolute.');
      await this.write(path, Buffer.from(item.data, 'base64'));
      return true;
    } catch { throw new Error('Could not export the MCP file. Choose a writable location and retry.'); }
    finally { this.busy = false; }
  }
}
