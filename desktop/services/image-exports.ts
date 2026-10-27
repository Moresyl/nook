import { extname, isAbsolute } from 'node:path';
import { attachmentSchema } from '../../contracts/attachments';
import { atomicFile } from './atomic-file';

export class ImageExports {
  private busy = false;
  constructor(private readonly choosePath: (name: string) => Promise<string | undefined>) {}

  async export(raw: unknown): Promise<boolean> {
    const file = attachmentSchema.safeParse(raw);
    if (!file.success || !file.data.image) throw new Error('Choose a valid image attachment to export.');
    if (this.busy) throw new Error('Another image export is running. Wait and retry.');
    this.busy = true;
    try {
      const bytes = Buffer.from(file.data.image.data, 'base64');
      let stem = file.data.name.replace(/\.[^.]*$/, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 120).replace(/[. ]+$/, '') || 'image';
      if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem)) stem = `_${stem}`;
      const path = await this.choosePath(`${stem}.jpg`);
      if (path === undefined) return false;
      if (!isAbsolute(path) || !/^\.jpe?g$/i.test(extname(path))) throw new Error('Choose an absolute JPEG file path.');
      await atomicFile(path, handle => handle.writeFile(bytes));
      return true;
    } catch { throw new Error('Could not save the JPEG image. Choose a writable JPEG destination and retry.'); }
    finally { this.busy = false; }
  }
}
