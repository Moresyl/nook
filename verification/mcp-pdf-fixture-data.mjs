import { documentBytes } from './attachment-fixtures.mjs';

export function mcpPdfFixtureBytes() {
  // A distinct original lets the full suite prove preview ownership independently.
  return Buffer.concat([documentBytes('pdf', { outline: true, annotations: true }), Buffer.from('\n% MCP_PDF_RESOURCE_ORIGINAL\n')]);
}
