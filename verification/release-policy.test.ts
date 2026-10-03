import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { releaseNotes, releaseVersion, verifyRuntimeProof, type ReleaseProof } from '../scripts/release-policy.mjs';
import { readRuntimeProof, runtimeProofFiles } from '../scripts/runtime-proof.mjs';

const hash = 'a'.repeat(64);
const otherHash = 'b'.repeat(64);
const notes = (version = '1.2.3', newline = '\n') => [
  `## [${version}] - 2026-10-03`, '',
  '### 新功能', '消息正文查找支持实际代码块的水平定位。', '',
  '### 变更与安全', '完整保留原始许可证及依赖法律文档。', '',
  '### 修复与完善', '最小窗口缩放时保持发送按钮可见。', '',
  '### 安装', '下载 Windows x64 安装版或便携版，并核对 SHA-256。', '',
  '### English', 'Adds literal chat-body search and verifies Windows installation and portable execution.',
].join(newline);

function proof(): ReleaseProof {
  const audit = { compiledAssetsMatchVerifiedBuild: true, removedUiFontReferencesVerified: true, oldProductIdentityMatches: [], unresolvedAssets: [], unresolvedDistribution: [], executableSha256: hash, archiveSha256: otherHash };
  const desktop = { variant: 'packaged executable', checks: 194, normalCloseVerified: true, runtimeErrors: [], executableSha256: hash, archiveSha256: otherHash };
  return {
    audit, desktop, surfaces: { ...desktop, checks: 4 },
    branches: { ...desktop, checks: 9, verificationRun: 'complete desktop suite', suiteChecks: desktop.checks, modelRequests: 0, ambiguousHistoryRecoveryVerified: true, manualOrderingVerified: true, orderingFailureRecoveryVerified: true, orderingBackupRestartVerified: true },
    temporary: { ...desktop, checks: 6, verificationRun: 'complete desktop suite', suiteChecks: desktop.checks, temporaryModelRequests: 3, persistenceExcludedVerified: true, backupsExcludedVerified: true, restartClearedVerified: true, storageModeImmutableVerified: true, regularDraftsRetainedVerified: true },
    comparisons: { ...desktop, checks: 6, verificationRun: 'complete desktop suite', suiteChecks: desktop.checks, comparisonModelRequests: 11, parallelStreamsVerified: true, independentFailureStopVerified: true, atomicSaveRetryVerified: true, backupsRestartVerified: true, temporaryExclusionVerified: true, originalDraftRetainedVerified: true, originalModelIdentityVerified: true },
    portable: { checks: 7, launches: [{ longDocumentPathLength: 301 }, { longDocumentPathLength: 301 }], longPathCleanupVerified: true, unpackedFilesVerified: 50, runtimeErrors: [], wrapperSha256: hash, childExecutableSha256: hash },
    portableAudit: { executableSha256: hash, archiveSha256: otherHash, unresolvedAssets: [], unresolvedDistribution: [] },
    bootstrap: { variants: ['installer', 'uninstaller', 'portable'].map((variant) => ({ variant, executableSha256: hash, plugins: [{ redistributionStatus: 'verified' }] })) },
    installer: { checks: 194, normalCloseVerified: true, registrationVerified: true, shortcutsVerified: true, uninstalled: true, userDataRetained: true, executableSha256: hash, archiveSha256: otherHash, installerSha256: hash },
  };
}

describe('release version and notes', () => {
  it('distinguishes exact stable and prerelease versions', () => {
    expect(releaseVersion('v1.2.3', '1.2.3')).toEqual({ tag: 'v1.2.3', version: '1.2.3', prerelease: false });
    expect(releaseVersion('v0.1.0-alpha.1', '0.1.0-alpha.1').prerelease).toBe(true);
  });
  it.each([['1.2.3', '1.2.3'], ['v2.0.0', '1.2.3'], ['v01.2.3', '01.2.3'], ['v1.2.3\n', '1.2.3\n'], ['v1.2.3-alpha.01', '1.2.3-alpha.01'], ['v1.2.3;echo', '1.2.3;echo'], ['v1.2.3/../x', '1.2.3/../x'], ['v1.2.3+build', '1.2.3+build'], ['', ''], [undefined, '1.2.3']])('rejects unmatched or unsafe tag %j for version %j', (tag, version) => {
    expect(() => releaseVersion(tag as string, version as string)).toThrow('exactly match');
  });
  it.each(['\n', '\r\n'])('extracts only the exact bilingual release with %j newlines', (newline) => {
    const changelog = `# Changes${newline}${notes('1.2.3', newline)}${newline}## [1.2.2]${newline}OLD_NOTES`;
    const result = releaseNotes(changelog, '1.2.3');
    expect(result.startsWith('### 新功能')).toBe(true);
    expect(result).toContain('### English');
    expect(result).not.toMatch(/OLD_NOTES|\r|## \[1/);
    expect(releaseNotes(notes(), '1.2.3')).toBe(result);
  });
  it('rejects absent and duplicate version sections', () => {
    for (const content of ['## [1.2.2]\nOld notes', `${notes()}\n${notes()}`]) expect(() => releaseNotes(content, '1.2.3')).toThrow('one exact');
  });
  it('requires populated Chinese installation/change/fix sections and English summary', () => {
    for (const heading of ['新功能', '变更与安全', '修复与完善', '安装', 'English']) {
      expect(() => releaseNotes(notes().replace(`### ${heading}`, '### Other'), '1.2.3')).toThrow('Chinese');
      const content = notes().replace(new RegExp(`(### ${heading}\\n)[^\\n]+`), '$1TODO');
      expect(() => releaseNotes(content, '1.2.3')).toThrow('incomplete');
    }
  });
});

describe('Windows release execution evidence', () => {
  it('accepts matching complete runtime and actual distribution evidence', () => {
    expect(() => verifyRuntimeProof(proof())).not.toThrow();
    const future = proof(); future.desktop.checks = 195; future.installer.checks = 195; future.branches.suiteChecks = 195; future.temporary.suiteChecks = 195; future.comparisons.suiteChecks = 195;
    expect(() => verifyRuntimeProof(future)).not.toThrow();
  });
  it('rejects missing or malformed executable/archive/wrapper hashes', () => {
    const first = proof(); first.audit.executableSha256 = '';
    const second = proof(); second.audit.archiveSha256 = 'unavailable';
    const third = proof(); third.portable.wrapperSha256 = hash.toUpperCase();
    for (const value of [first, second, third]) expect(() => verifyRuntimeProof(value)).toThrow('SHA-256');
  });
  it('rejects unresolved fonts, old identity, distribution rights and stale compiled assets', () => {
    const cases = [proof(), proof(), proof(), proof(), proof()];
    cases[0].audit.unresolvedAssets = ['Font']; cases[1].audit.oldProductIdentityMatches = ['Old product'];
    cases[2].audit.unresolvedDistribution = ['Plugin']; cases[3].audit.compiledAssetsMatchVerifiedBuild = false;
    cases[4].audit.removedUiFontReferencesVerified = false;
    for (const value of cases) expect(() => verifyRuntimeProof(value)).toThrow('unresolved');
  });
  it('rejects source/forced-close/error or mismatched packaged execution', () => {
    for (const key of ['desktop', 'surfaces', 'branches', 'temporary', 'comparisons'] as const) {
      const cases = [proof(), proof(), proof(), proof(), proof()];
      cases[0][key].variant = 'development executable'; cases[1][key].normalCloseVerified = false;
      cases[2][key].runtimeErrors = ['Failure']; cases[3][key].executableSha256 = otherHash; cases[4][key].archiveSha256 = hash;
      for (const value of cases) expect(() => verifyRuntimeProof(value)).toThrow('normal close');
    }
  });
  it('rejects incomplete desktop/settings/portable checks and different portable body', () => {
    const cases = Array.from({ length: 11 }, proof);
    cases[0].desktop.checks = 193; cases[1].desktop.checks = Number.NaN; cases[2].surfaces.checks = 3;
    cases[3].portable.checks = 6; cases[4].portable.launches = [{}]; cases[5].portable.runtimeErrors = ['Failure'];
    cases[6].portable.childExecutableSha256 = otherHash; cases[7].portableAudit.executableSha256 = otherHash;
    cases[8].portableAudit.archiveSha256 = hash; cases[9].portableAudit.unresolvedAssets = ['Font']; cases[10].portableAudit.unresolvedDistribution = ['Plugin'];
    for (const value of cases) expect(() => verifyRuntimeProof(value)).toThrow('portable verification');
  });
  it('rejects missing, focused, incomplete, stale or requesting branch-navigation evidence', () => {
    const missing = proof(); delete (missing as Partial<ReleaseProof>).branches;
    expect(() => verifyRuntimeProof(missing)).toThrow('normal close');
    const cases = [proof(), proof(), proof(), proof(), proof()];
    cases[0].branches.checks = 5; cases[1].branches.verificationRun = 'focused branch-navigation suite';
    cases[2].branches.suiteChecks = 178; cases[3].branches.modelRequests = 1; cases[4].branches.ambiguousHistoryRecoveryVerified = false;
    for (const value of cases) expect(() => verifyRuntimeProof(value)).toThrow('branch-navigation verification');
  });
  it('rejects missing or failed manual order, write-recovery and ordered-backup/restart evidence', () => {
    for (const key of ['manualOrderingVerified', 'orderingFailureRecoveryVerified', 'orderingBackupRestartVerified'] as const) {
      const failed = proof(); failed.branches[key] = false; expect(() => verifyRuntimeProof(failed)).toThrow('branch-navigation verification');
      const absent = proof(); delete (absent.branches as Partial<ReleaseProof['branches']>)[key]; expect(() => verifyRuntimeProof(absent)).toThrow('branch-navigation verification');
    }
  });
  it('rejects missing, focused, stale or incomplete temporary-chat privacy and restart evidence', () => {
    const missing = proof(); delete (missing as Partial<ReleaseProof>).temporary;
    expect(() => verifyRuntimeProof(missing)).toThrow('normal close');
    const cases = Array.from({ length: 9 }, proof);
    cases[0].temporary.checks = 5; cases[1].temporary.verificationRun = 'focused temporary-conversation suite';
    cases[2].temporary.suiteChecks = 184; cases[3].temporary.temporaryModelRequests = 2;
    cases[4].temporary.persistenceExcludedVerified = false; cases[5].temporary.backupsExcludedVerified = false;
    cases[6].temporary.restartClearedVerified = false; cases[7].temporary.storageModeImmutableVerified = false; cases[8].temporary.regularDraftsRetainedVerified = false;
    for (const value of cases) expect(() => verifyRuntimeProof(value)).toThrow('temporary-chat');
  });
  it('rejects missing, focused, stale, partial or unverified parallel comparison evidence', () => {
    const missing = proof(); delete (missing as Partial<ReleaseProof>).comparisons; expect(() => verifyRuntimeProof(missing)).toThrow('normal close');
    const cases = Array.from({ length: 4 }, proof); cases[0].comparisons.checks = 5; cases[1].comparisons.verificationRun = 'focused model-comparison suite'; cases[2].comparisons.suiteChecks = 193; cases[3].comparisons.comparisonModelRequests = 10;
    for (const value of cases) expect(() => verifyRuntimeProof(value)).toThrow('parallel model-comparison');
    for (const key of ['parallelStreamsVerified', 'independentFailureStopVerified', 'atomicSaveRetryVerified', 'backupsRestartVerified', 'temporaryExclusionVerified', 'originalDraftRetainedVerified', 'originalModelIdentityVerified'] as const) {
      const failed = proof(); failed.comparisons[key] = false; expect(() => verifyRuntimeProof(failed)).toThrow('parallel model-comparison');
      const absent = proof(); delete (absent.comparisons as Partial<ReleaseProof['comparisons']>)[key]; expect(() => verifyRuntimeProof(absent)).toThrow('parallel model-comparison');
      const invalid = proof(); (invalid.comparisons as unknown as Record<string, unknown>)[key] = 'true'; expect(() => verifyRuntimeProof(invalid)).toThrow('parallel model-comparison');
    }
  });
  it('rejects absent cleanup proof and untested or incomplete long-path launches', () => {
    const cases = [proof(), proof(), proof(), proof(), proof(), proof()];
    cases[0].portable.longPathCleanupVerified = false; cases[1].portable.launches[0] = {};
    cases[2].portable.launches[1].longDocumentPathLength = 260; cases[3].portable.launches[1].longDocumentPathLength = 301.5;
    cases[4].portable.unpackedFilesVerified = 0; cases[5].portable.unpackedFilesVerified = Number.NaN;
    for (const value of cases) expect(() => verifyRuntimeProof(value)).toThrow('long-path cleanup');
  });
  it('requires all three bootstrap variants with licensed original inputs', () => {
    const cases = [proof(), proof(), proof(), proof()];
    cases[0].bootstrap.variants.pop(); cases[1].bootstrap.variants[2].variant = 'installer';
    cases[2].bootstrap.variants[1].plugins = []; cases[3].bootstrap.variants[2].plugins[0].redistributionStatus = 'unresolved';
    for (const value of cases) expect(() => verifyRuntimeProof(value)).toThrow('original plugin');
  });
  it('rejects incomplete installation, uninstall, data retention or mismatched installed body', () => {
    for (const key of ['normalCloseVerified', 'registrationVerified', 'shortcutsVerified', 'uninstalled', 'userDataRetained'] as const) {
      const value = proof(); value.installer[key] = false;
      expect(() => verifyRuntimeProof(value)).toThrow('uninstall proof');
    }
    const cases = [proof(), proof(), proof()]; cases[0].installer.checks = 172;
    cases[1].installer.executableSha256 = otherHash; cases[2].installer.archiveSha256 = hash;
    for (const value of cases) expect(() => verifyRuntimeProof(value)).toThrow('uninstall proof');
  });
});

const proofDirectories: string[] = [];
afterEach(async () => { await Promise.all(proofDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });
async function proofFiles() {
  const root = await mkdtemp(join(tmpdir(), 'qiyao-runtime-proof-')); proofDirectories.push(root); await mkdir(join(root, 'verification'));
  const value = proof(); await Promise.all(Object.entries(runtimeProofFiles).map(([key, name]) => writeFile(join(root, 'verification', name), JSON.stringify(value[key as keyof ReleaseProof]))));
  return { root, value };
}
describe('complete runtime proof file loader', () => {
  it('loads all ten independent records and passes their matching-body policy without changing their data', async () => {
    const { root, value } = await proofFiles(); const actual = await readRuntimeProof(root); expect(Object.keys(actual)).toHaveLength(10); expect(actual).toEqual(value); expect(() => verifyRuntimeProof(actual)).not.toThrow();
  });
  it('rejects missing required comparison evidence without exposing its filesystem location', async () => {
    const { root } = await proofFiles(); await rm(join(root, 'verification', runtimeProofFiles.comparisons)); const error = await readRuntimeProof(root).catch((error) => error);
    expect(error.message).toContain('comparisons'); expect(error.message).not.toContain(root);
  });
  it('rejects malformed JSON, null, arrays and primitive records without exposing their contents', async () => {
    const { root } = await proofFiles(); for (const content of ['PRIVATE_INVALID_JSON', 'null', '[]', '"PRIVATE_RECORD_CONTENT"']) { await writeFile(join(root, 'verification', runtimeProofFiles.audit), content); const error = await readRuntimeProof(root).catch((error) => error); expect(error.message).toContain('proof (audit)'); expect(error.message).not.toMatch(/PRIVATE|qiyao-runtime-proof-/); }
  });
});
