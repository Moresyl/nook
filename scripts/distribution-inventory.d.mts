export interface DistributionFile { path: string; sha256: string }
export interface DistributionBinary extends DistributionFile { location: 'compiler' | 'plugins' | 'elevate' }
export interface DistributionComponent { name: string; license: string; status: 'verified' | 'unresolved'; source: string; notes?: string; documents: DistributionFile[]; sources: DistributionFile[]; binaries: DistributionBinary[] }
export interface DistributionManifest { schemaVersion: 1; builderVersion: string; toolset: string; archiveFilter: 'BCJ'; components: DistributionComponent[] }
export function collectDistributionInventory(manifest: DistributionManifest, legalRoot: string): Promise<{ notices: string; components: number; unresolved: string[] }>;
export function verifyDistributionBinaries(manifest: DistributionManifest, locations: Record<DistributionBinary['location'], string>): Promise<Array<{ component: string; location: DistributionBinary['location']; path: string; sha256: string }>>;
