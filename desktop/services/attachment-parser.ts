import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { parseOffice, type SupportedFileType } from 'officeparser';
import sharp from 'sharp';
import { attachmentInputSchema, attachmentLimits, attachmentSchema, type Attachment, type AttachmentInput } from '../../contracts/attachments';

const documents = new Set(['pdf', 'docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp', 'rtf']);
const images = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif']);
const textFormats = new Set(['txt', 'md', 'markdown', 'json', 'csv', 'tsv', 'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'rs', 'html', 'htm', 'css', 'scss', 'log', 'yaml', 'yml', 'toml', 'xml', 'svg', 'sql', 'sh', 'ps1', 'bat', 'c', 'h', 'cpp', 'hpp', 'java', 'go', 'rb', 'ini', 'cfg', 'conf', 'tex']);

function readableText(bytes: Buffer): string {
  try {
    const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8';
    const text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
    if (/[\0-\x08\x0b\x0c\x0e-\x1f]/.test(text)) throw new Error();
    return text;
  } catch { throw new Error('The file is binary or has an unsupported text encoding. Save it as UTF-8 or UTF-16 with a byte-order mark.'); }
}

function documentError(error: unknown): Error {
  const code = (error as { officeIssue?: { code?: string } })?.officeIssue?.code;
  if (code === 'PASSWORD_REQUIRED' || code === 'PASSWORD_INCORRECT' || code === 'DOCUMENT_DECRYPTION_FAILED') return new Error('This document is password protected. Import an unlocked copy.');
  if (code && /LIMIT|DECOMPRESSION/.test(code)) return new Error('This document exceeds the extraction limits. Split it into smaller files.');
  return new Error('Could not read this document. Check its format and integrity, then import it again.');
}

function incomplete(code: string): boolean { return /NOT_READ|FAILED|EXCEEDED|TRUNCATED|BUFFER_TYPE_MISMATCH/.test(code); }

export async function parseAttachment(raw: AttachmentInput): Promise<Attachment> {
  const input = attachmentInputSchema.parse(raw);
  const bytes = Buffer.from(input.data, 'base64');
  if (bytes.length > attachmentLimits.fileBytes || bytes.toString('base64') !== input.data) throw new Error('Choose a valid file smaller than 12 MB.');
  const extension = extname(input.name).slice(1).toLowerCase();
  const base = { id: randomUUID(), name: input.name };
  if (images.has(extension)) {
    try {
      const source = sharp(bytes, { limitInputPixels: 40_000_000, failOn: 'warning', animated: false });
      const metadata = await source.metadata();
      if (!metadata.format || !['png', 'jpeg', 'webp', 'gif'].includes(metadata.format)) throw new Error();
      const { data, info } = await source.rotate().resize(attachmentLimits.imageDimension, attachmentLimits.imageDimension, { fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 85 }).toBuffer({ resolveWithObject: true });
      if (data.length > attachmentLimits.imageBytes) throw new Error();
      const warnings = ['图片已转换为 JPEG，并移除文件元数据。透明区域使用白色背景。'];
      if ((metadata.pages ?? 1) > 1) warnings.push('动画图片仅使用第一帧。');
      if (metadata.width && metadata.height && (metadata.width > attachmentLimits.imageDimension || metadata.height > attachmentLimits.imageDimension)) warnings.push('图片最长边已缩小至 2,000 像素。');
      return attachmentSchema.parse({ ...base, content: '', source: { format: metadata.format, bytes: bytes.length }, image: { mimeType: 'image/jpeg', data: data.toString('base64'), width: info.width, height: info.height }, warnings });
    } catch { throw new Error('Could not read this image. Use a valid PNG, JPEG, WebP or GIF below 12 MB and 40 million pixels.'); }
  }
  if (documents.has(extension)) {
    let content: string;
    try {
      const ast = await parseOffice(bytes, {
        fileType: extension as SupportedFileType, ocr: false, extractAttachments: false, includeRawContent: false,
        decompressionLimits: { maxUncompressedBytes: 32_000_000, maxZipEntries: 2000, maxXmlElements: 200_000, maxTableCells: 50_000, maxRepeatedContent: 1_000_000, maxRawContentLength: 1_000_000 },
        pdfParserConfig: { separateProcess: false, extractTextColor: false, maxTextItems: 20_000, maxOperators: 50_000, maxAnnotations: 1000 },
      });
      if (ast.warnings.some((warning) => incomplete(warning.code))) throw new Error();
      const output = await ast.to('text', { includeImages: 'none', textConfig: { pageSeparator: '\n\n--- Page / slide ---\n\n' } });
      if (output.messages.some((warning) => incomplete(warning.code))) throw new Error();
      content = output.value;
    } catch (error) { throw documentError(error); }
    if (!content.trim()) throw new Error('No readable text was found in this document. Scanned PDFs and image-only documents need OCR or image input.');
    if (content.length > attachmentLimits.textCharacters) throw new Error('The extracted document exceeds 256,000 characters. Split it into smaller files.');
    return attachmentSchema.parse({ ...base, content, source: { format: extension, bytes: bytes.length } });
  }
  if (extension && !textFormats.has(extension)) throw new Error('This file format is unsupported. Import text, PDF, DOCX, XLSX, PPTX, ODT, ODS, ODP, RTF or a supported image.');
  const content = readableText(bytes);
  if (content.length > attachmentLimits.textCharacters) throw new Error('The text file exceeds 256,000 characters. Split it into smaller files.');
  return attachmentSchema.parse({ ...base, content, source: { format: 'text', bytes: bytes.length } });
}
