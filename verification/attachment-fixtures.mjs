import { zipSync, strToU8 } from 'fflate';
import sharp from 'sharp';

const zip = (parts) => Buffer.from(zipSync(Object.fromEntries(Object.entries(parts).map(([path, text]) => [path, strToU8(text)]))));
const contentTypes = '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/></Types>';
const relationships = (entries) => `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${entries.map(([id, type, target]) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`).join('')}</Relationships>`;

export function documentBytes(format, { outline = false } = {}) {
  if (format === 'rtf') return Buffer.from('{\\rtf1\\ansi Document evidence\\par Budget 42}', 'ascii');
  if (format === 'pdf') {
    const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>', ...[5, 6].map((id) => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents ${id} 0 R >>`), ...['Document evidence', 'Budget 42'].map((text) => { const stream = `BT /F1 16 Tf 72 720 Td (${text}) Tj ET`; return `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`; }), '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
    if (outline) {
      objects[0] = '<< /Type /Catalog /Pages 2 0 R /Outlines 8 0 R /Names << /Dests << /Names [(budget) [4 0 R /XYZ 0 600 null]] >> >> >>';
      objects.push('<< /Type /Outlines /First 9 0 R /Last 9 0 R /Count 3 >>',
        '<< /Title (Evidence chapter) /Parent 8 0 R /Dest [3 0 R /Fit] /First 10 0 R /Last 11 0 R /Count 2 >>',
        '<< /Title (Budget details) /Parent 9 0 R /Next 11 0 R /Dest (budget) >>',
        '<< /Title (External reference) /Parent 9 0 R /Prev 10 0 R /A << /S /URI /URI (https://example.invalid/) >> >>');
    }
    let pdf = '%PDF-1.4\n'; const offsets = [0]; objects.forEach((value, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${value}\nendobj\n`; });
    const xref = Buffer.byteLength(pdf); pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return Buffer.from(pdf);
  }
  if (format === 'docx') return zip({ '[Content_Types].xml': contentTypes, '_rels/.rels': relationships([['rId1', 'officeDocument', 'word/document.xml']]), 'word/document.xml': '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Document evidence 中文</w:t></w:r></w:p><w:p><w:r><w:t>Budget 42</w:t></w:r></w:p></w:body></w:document>' });
  if (format === 'xlsx') return zip({ '[Content_Types].xml': contentTypes, '_rels/.rels': relationships([['rId1', 'officeDocument', 'xl/workbook.xml']]), 'xl/workbook.xml': '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Budget" sheetId="1" r:id="rId1"/></sheets></workbook>', 'xl/_rels/workbook.xml.rels': relationships([['rId1', 'worksheet', 'worksheets/sheet1.xml']]), 'xl/worksheets/sheet1.xml': '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Document evidence</t></is></c><c r="B1"><v>42</v></c></row></sheetData></worksheet>' });
  if (format === 'pptx') return zip({ '[Content_Types].xml': contentTypes, '_rels/.rels': relationships([['rId1', 'officeDocument', 'ppt/presentation.xml']]), 'ppt/presentation.xml': '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>', 'ppt/_rels/presentation.xml.rels': relationships([['rId1', 'slide', 'slides/slide1.xml']]), 'ppt/slides/slide1.xml': '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:bodyPr/><a:p><a:r><a:t>Document evidence</a:t></a:r></a:p><a:p><a:r><a:t>Budget 42</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>' });
  const mime = { odt: 'text', ods: 'spreadsheet', odp: 'presentation' }[format];
  if (!mime) throw new Error(`Unknown document fixture: ${format}`);
  const body = format === 'odt' ? '<office:text><text:p>Document evidence</text:p><text:p>Budget 42</text:p></office:text>' : format === 'ods' ? '<office:spreadsheet><table:table table:name="Budget"><table:table-row><table:table-cell office:value-type="string"><text:p>Document evidence</text:p></table:table-cell><table:table-cell office:value-type="float" office:value="42"><text:p>42</text:p></table:table-cell></table:table-row></table:table></office:spreadsheet>' : '<office:presentation><draw:page draw:name="Slide 1"><draw:frame><draw:text-box><text:p>Document evidence</text:p><text:p>Budget 42</text:p></draw:text-box></draw:frame></draw:page></office:presentation>';
  return zip({ mimetype: `application/vnd.oasis.opendocument.${mime}`, 'META-INF/manifest.xml': '<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"/>', 'content.xml': `<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"><office:body>${body}</office:body></office:document-content>` });
}

export async function imageBytes(format = 'png', width = 64, height = 48) {
  return sharp({ create: { width, height, channels: 4, background: { r: 45, g: 120, b: 185, alpha: 0.5 } } }).withMetadata({ orientation: 6 }).toFormat(format).toBuffer();
}
