import { z } from 'zod';
import { documentOriginalLimits, documentOriginalSchema, type DocumentOriginal } from '../../contracts/document-originals';
import { originalDocumentIdentity } from './document-original-store';

const bundleSchema = z.object({ reference: documentOriginalSchema, data: z.string().max(4 * Math.ceil(documentOriginalLimits.fileBytes / 3)) }).strict();
export type DocumentOriginalBundle = z.infer<typeof bundleSchema>;

/** Validate every byte before restore performs any original-store writes. */
export function validateDocumentOriginalBundles(raw: unknown, owners: DocumentOriginal[]): DocumentOriginalBundle[] {
  const bundles = z.object({ documentOriginals: z.array(bundleSchema).optional() }).parse(raw).documentOriginals ?? [];
  const expected = new Map(owners.map(reference => [reference.sha256, reference]));
  if (bundles.length !== expected.size) throw new Error('The backup does not contain all of its original documents.');
  if (owners.reduce((sum, reference) => sum + reference.bytes, 0) > documentOriginalLimits.persistentBytes) throw new Error('The backup original documents exceed the workspace limit.');
  const seen = new Set<string>();
  for (const bundle of bundles) {
    const reference = expected.get(bundle.reference.sha256);
    if (!reference || seen.has(reference.sha256) || reference.bytes !== bundle.reference.bytes) throw new Error('The backup original documents do not match their owners.');
    if (bundle.data.length !== 4 * Math.ceil(reference.bytes / 3)) throw new Error('The backup contains an invalid original document.');
    const bytes = Buffer.from(bundle.data, 'base64');
    if (bytes.length !== reference.bytes || bytes.toString('base64') !== bundle.data || originalDocumentIdentity(bytes).sha256 !== reference.sha256) throw new Error('The backup contains a damaged original document.');
    seen.add(reference.sha256);
  }
  return bundles;
}
