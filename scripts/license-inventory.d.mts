export type LicenseGroups = Record<string, { name: string; versions: string[]; paths: string[]; license: string }[]>;
export type LicenseSupplement = { name: string; version: string; license: string; document: string; sha256: string; source: string; packageIntegrity: string };
export function collectLicenseInventory(groups: LicenseGroups, projectRoot: string, supplements?: LicenseSupplement[]): Promise<{
  components: { name: string; version: string; license: string; provenance?: { source: string; originalSha256: string }; documents: { path: string; sha256: string; bytes: number }[] }[];
  files: { path: string; content: Buffer }[];
  notices: string;
}>;
