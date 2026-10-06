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
  const desktop = { variant: 'packaged executable', checks: 252, normalCloseVerified: true, runtimeErrors: [], executableSha256: hash, archiveSha256: otherHash,
    quickChat: { checks: 9, quickModelRequests: 3, mainFixtureRequests: 1, originalSha256: hash, independentDraftsVerified: true, restrictedBridgeVerified: true, exactOriginalVerified: true, textOnlyTransportVerified: true, stopOwnerVerified: true, approvalScopeVerified: true, handoffVerified: true, windowStateVerified: true, filesystemRetryVerified: true, backupRestartVerified: true, staleRevisionVerified: true, layout: ['light', 'dark'].flatMap(theme => [1, 1.25, 1.5].map(zoom => ({ theme, zoom, controlsVisible: true, overflow: false }))) },
    mcpPdf: { checks: 8, explicitModelRequests: 1, previewPersisted: false, originalSha256: hash, exactOriginalVerified: true, promptPdfVerified: true, textOnlyModelTransportVerified: true, staleSubscriptionVerified: true, filesystemRetryVerified: true, restartVerified: true, backupRestoreVerified: true, layout: ['light', 'dark'].flatMap(theme => [1, 1.25, 1.5].map(zoom => ({ theme, zoom, controlsVisible: true, overflow: false }))) },
    pdfPreview: { checks: 6, canvasTextVerified: true, outlineTargetsVerified: true, fullDocumentSearchVerified: true, linksNotesZoomVerified: true, exportOwnershipRestartVerified: true },
    attachments: { pdfOriginal: { textOnlyProtocols: ['responses', 'openai', 'anthropic', 'gemini', 'ollama', 'azure-responses', 'azure-chat', 'azure-deployment'], restartBytesVerified: true, deduplicatedBackupVerified: true, missingFileRestoredVerified: true } },
    memories: { checks: 3 }, projectPreview: { checks: 9, outsideHttpRequests: 0, docked: { checks: 4, floatingTransferVerified: true, projectRemovalVerified: true } },
    promptTransfer: { checks: 5, transferModelRequests: 0, exportModesVerified: true, inertPreviewCancelVerified: true, atomicImportRetryVerified: true, sharedFreshAssociationsVerified: true, zoomKeyboardVerified: true, backupRestartVerified: true, originalDraftRetained: true } };
  return {
    audit, desktop: { ...desktop, mcpResourceSubscriptions: { checks: 6, modelRequests: 0, realNotificationsVerified: true, explicitDraftInsertionVerified: true, delayedUnsubscribeFiltered: true, templateSelectionVerified: true, disconnectRestartVerified: true, unsupportedServerVerified: true, zoomKeyboardVerified: true, originalDraftRetained: true }, mcpBinaryFiles: { checks: 6, binaryModelRequests: 0, realWorkerPreviewVerified: true, exactOriginalExportVerified: true, emptyAndUnsupportedExportVerified: true, promptBinaryTextOnlyVerified: true, staleSelectionVerified: true, zoomKeyboardVerified: true, restartDraftRetainedVerified: true }, assistantRecipes: { checks: 4, recipeModelRequests: 0, assistantBindingVerified: true, defaultOptionalChoicesVerified: true, deletedAssistantRecoveryVerified: true, zoomKeyboardVerified: true, backupRestartVerified: true, originalDraftRetained: true } }, surfaces: { ...desktop, checks: 4 },
    preview: { ...desktop, ...structuredClone(desktop.projectPreview) },
    branches: { ...desktop, checks: 9, verificationRun: 'complete desktop suite', suiteChecks: desktop.checks, modelRequests: 0, ambiguousHistoryRecoveryVerified: true, manualOrderingVerified: true, orderingFailureRecoveryVerified: true, orderingBackupRestartVerified: true },
    temporary: { ...desktop, checks: 6, verificationRun: 'complete desktop suite', suiteChecks: desktop.checks, temporaryModelRequests: 3, persistenceExcludedVerified: true, backupsExcludedVerified: true, restartClearedVerified: true, storageModeImmutableVerified: true, regularDraftsRetainedVerified: true },
    comparisons: { ...desktop, checks: 6, verificationRun: 'complete desktop suite', suiteChecks: desktop.checks, comparisonModelRequests: 11, parallelStreamsVerified: true, independentFailureStopVerified: true, atomicSaveRetryVerified: true, backupsRestartVerified: true, temporaryExclusionVerified: true, originalDraftRetainedVerified: true, originalModelIdentityVerified: true },
    portable: { checks: 7, launches: [{ longDocumentPathLength: 301 }, { longDocumentPathLength: 301 }], longPathCleanupVerified: true, unpackedFilesVerified: 50, runtimeErrors: [], wrapperSha256: hash, childExecutableSha256: hash },
    portableAudit: { executableSha256: hash, archiveSha256: otherHash, unresolvedAssets: [], unresolvedDistribution: [] },
    bootstrap: { variants: ['installer', 'uninstaller', 'portable'].map((variant) => ({ variant, executableSha256: hash, plugins: [{ redistributionStatus: 'verified' }] })) },
    installer: { checks: desktop.checks, normalCloseVerified: true, registrationVerified: true, shortcutsVerified: true, uninstalled: true, userDataRetained: true, executableSha256: hash, archiveSha256: otherHash, installerSha256: hash },
  };
}

describe('PDF release evidence', () => {
  it('requires independent quick-chat boundaries, original identity, request counts and every minimum-window theme/zoom pair', () => {
    const missing = proof(); delete missing.desktop.quickChat; expect(() => verifyRuntimeProof(missing)).toThrow('quick-chat');
    for (const [key, value] of Object.entries({ checks: 8, quickModelRequests: 4, mainFixtureRequests: 0, originalSha256: '', layout: [], independentDraftsVerified: false, restrictedBridgeVerified: false, exactOriginalVerified: false, textOnlyTransportVerified: false, stopOwnerVerified: false, approvalScopeVerified: false, handoffVerified: false, windowStateVerified: false, filesystemRetryVerified: false, backupRestartVerified: false, staleRevisionVerified: false })) {
      const invalid = proof(); (invalid.desktop.quickChat as unknown as Record<string, unknown>)[key] = value; expect(() => verifyRuntimeProof(invalid)).toThrow('quick-chat');
    }
    for (const change of [{ zoom: 1.25 }, { theme: 'light' }, { controlsVisible: false }, { overflow: true }]) {
      const invalid = proof(); invalid.desktop.quickChat!.layout[5] = { ...invalid.desktop.quickChat!.layout[5], ...change }; expect(() => verifyRuntimeProof(invalid)).toThrow('quick-chat');
    }
    const previous = proof(); previous.desktop.checks = 243; previous.installer.checks = 243; previous.branches.suiteChecks = 243; previous.temporary.suiteChecks = 243; previous.comparisons.suiteChecks = 243;
    expect(() => verifyRuntimeProof(previous)).toThrow('Complete desktop');
  });
  it('requires complete MCP PDF evidence, exact request count and both themes at every zoom', () => {
    const missing = proof(); delete missing.desktop.mcpPdf; expect(() => verifyRuntimeProof(missing)).toThrow('MCP PDF');
    for (const [key, value] of [['checks', 7], ['explicitModelRequests', 0], ['explicitModelRequests', 2], ['previewPersisted', true], ['originalSha256', 'invalid'], ['layout', []], ['layout', Array(6).fill(null)]] as const) {
      const invalid = proof(); (invalid.desktop.mcpPdf as unknown as Record<string, unknown>)[key] = value; expect(() => verifyRuntimeProof(invalid)).toThrow('MCP PDF');
    }
    for (const key of ['exactOriginalVerified', 'promptPdfVerified', 'textOnlyModelTransportVerified', 'staleSubscriptionVerified', 'filesystemRetryVerified', 'restartVerified', 'backupRestoreVerified']) {
      for (const value of [false, undefined, 'true']) {
        const invalid = proof(); (invalid.desktop.mcpPdf as unknown as Record<string, unknown>)[key] = value; expect(() => verifyRuntimeProof(invalid)).toThrow('MCP PDF');
      }
    }
    for (const change of [{ theme: 'light' }, { zoom: 2 }, { controlsVisible: false }, { overflow: true }]) {
      const invalid = proof(); invalid.desktop.mcpPdf!.layout[5] = { ...invalid.desktop.mcpPdf!.layout[5], ...change }; expect(() => verifyRuntimeProof(invalid)).toThrow('MCP PDF');
    }
  });
  it('rejects missing, partial and non-boolean viewer evidence', () => {
    const missing = proof(); delete missing.desktop.pdfPreview;
    expect(() => verifyRuntimeProof(missing)).toThrow('PDF preview');
    const count = proof(); count.desktop.pdfPreview!.checks = 5;
    expect(() => verifyRuntimeProof(count)).toThrow('PDF preview');
    for (const key of ['canvasTextVerified', 'outlineTargetsVerified', 'fullDocumentSearchVerified', 'linksNotesZoomVerified', 'exportOwnershipRestartVerified']) {
      for (const value of [false, undefined, 'true']) {
        const incomplete = proof(); (incomplete.desktop.pdfPreview as unknown as Record<string, unknown>)[key] = value;
        expect(() => verifyRuntimeProof(incomplete)).toThrow('PDF preview');
      }
    }
  });
  it('requires every unique HTTP protocol and exact-byte backup/restart checks', () => {
    const missing = proof(); delete missing.desktop.attachments;
    expect(() => verifyRuntimeProof(missing)).toThrow('PDF original');
    for (const protocols of [[], ['responses'], Array(8).fill('responses'), [...proof().desktop.attachments!.pdfOriginal!.textOnlyProtocols, 'unknown']]) {
      const incomplete = proof(); incomplete.desktop.attachments!.pdfOriginal!.textOnlyProtocols = protocols;
      expect(() => verifyRuntimeProof(incomplete)).toThrow('PDF original');
    }
    for (const key of ['restartBytesVerified', 'deduplicatedBackupVerified', 'missingFileRestoredVerified']) {
      for (const value of [false, undefined, 'true']) {
        const incomplete = proof(); (incomplete.desktop.attachments!.pdfOriginal as unknown as Record<string, unknown>)[key] = value;
        expect(() => verifyRuntimeProof(incomplete)).toThrow('PDF original');
      }
    }
  });
  it('rejects a previous suite count even when its other evidence is populated', () => {
    const old = proof(); old.desktop.checks = 223; old.installer.checks = 223;
    old.branches.suiteChecks = 223; old.temporary.suiteChecks = 223; old.comparisons.suiteChecks = 223;
    expect(() => verifyRuntimeProof(old)).toThrow('Complete desktop');
  });
});

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
  it('rejects retained installed or portable results for a different audited wrapper even when their application body is identical', () => {
    const installed = proof(); installed.installer.installerSha256 = otherHash;
    const portable = proof(); portable.bootstrap.variants.find((variant) => variant.variant === 'portable')!.executableSha256 = otherHash;
    for (const value of [installed, portable]) expect(() => verifyRuntimeProof(value)).toThrow('bootstraps');
  });
  it('requires valid hashes for the installer and each actual bootstrap executable', () => {
    for (const value of ['', 'unavailable', hash.toUpperCase(), undefined]) {
      const installed = proof(); installed.installer.installerSha256 = value as string;
      expect(() => verifyRuntimeProof(installed)).toThrow('SHA-256');
      for (const name of ['installer', 'uninstaller', 'portable']) {
        const bootstrap = proof(); bootstrap.bootstrap.variants.find((variant) => variant.variant === name)!.executableSha256 = value as string;
        expect(() => verifyRuntimeProof(bootstrap)).toThrow('SHA-256');
      }
    }
  });
  it('accepts matching complete runtime and actual distribution evidence', () => {
    expect(() => verifyRuntimeProof(proof())).not.toThrow();
    const future = proof(); const nextChecks = future.desktop.checks + 1; future.desktop.checks = nextChecks; future.installer.checks = nextChecks; future.branches.suiteChecks = nextChecks; future.temporary.suiteChecks = nextChecks; future.comparisons.suiteChecks = nextChecks;
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
    for (const key of ['desktop', 'surfaces', 'preview', 'branches', 'temporary', 'comparisons'] as const) {
      const cases = [proof(), proof(), proof(), proof(), proof()];
      cases[0][key].variant = 'development executable'; cases[1][key].normalCloseVerified = false;
      cases[2][key].runtimeErrors = ['Failure']; cases[3][key].executableSha256 = otherHash; cases[4][key].archiveSha256 = hash;
      for (const value of cases) expect(() => verifyRuntimeProof(value)).toThrow('normal close');
    }
  });
  it('rejects missing, partial or network-accessing project preview evidence', () => {
    const absent = proof(); delete (absent as Partial<ReleaseProof>).preview; expect(() => verifyRuntimeProof(absent)).toThrow('normal close');
    const cases = [proof(), proof(), proof()]; cases[0].preview.checks = 4; cases[1].preview.outsideHttpRequests = 1;
    delete (cases[2].preview as Partial<ReleaseProof['preview']>).outsideHttpRequests;
    for (const value of cases) expect(() => verifyRuntimeProof(value)).toThrow('project-preview');
  });
  it('rejects old floating-only and incomplete docked lifecycle evidence in focused and complete suites', () => {
    for (const surface of ['preview', 'desktop'] as const) {
      for (const defect of ['old', 'missing', 'partial', 'transfer', 'removal'] as const) {
        const value = proof(), result = surface === 'preview' ? value.preview : value.desktop.projectPreview!;
        if (defect === 'old') result.checks = 5;
        if (defect === 'missing') delete result.docked;
        if (defect === 'partial') result.docked!.checks = 3;
        if (defect === 'transfer') result.docked!.floatingTransferVerified = false;
        if (defect === 'removal') delete result.docked!.projectRemovalVerified;
        expect(() => verifyRuntimeProof(value)).toThrow('project-preview');
      }
    }
  });
  it('rejects incomplete desktop/settings/portable checks and different portable body', () => {
    const cases = Array.from({ length: 11 }, proof);
    cases[0].desktop.checks = 199; cases[1].desktop.checks = Number.NaN; cases[2].surfaces.checks = 3;
    cases[3].portable.checks = 6; cases[4].portable.launches = [{}]; cases[5].portable.runtimeErrors = ['Failure'];
    cases[6].portable.childExecutableSha256 = otherHash; cases[7].portableAudit.executableSha256 = otherHash;
    cases[8].portableAudit.archiveSha256 = hash; cases[9].portableAudit.unresolvedAssets = ['Font']; cases[10].portableAudit.unresolvedDistribution = ['Plugin'];
    for (const value of cases) expect(() => verifyRuntimeProof(value)).toThrow('portable verification');
  });
  it('requires memory and offline preview checks within the complete desktop suite', () => {
    const missing = proof(); delete missing.desktop.memories; expect(() => verifyRuntimeProof(missing)).toThrow('memory verification');
    for (const count of [0, 2, 4, Number.NaN]) {
      const partial = proof(); partial.desktop.memories!.checks = count; expect(() => verifyRuntimeProof(partial)).toThrow('memory verification');
    }
    const absent = proof(); delete absent.desktop.projectPreview; expect(() => verifyRuntimeProof(absent)).toThrow('desktop must include');
    for (const count of [0, 4, 6, Number.NaN]) {
      const partial = proof(); partial.desktop.projectPreview!.checks = count; expect(() => verifyRuntimeProof(partial)).toThrow('desktop must include');
    }
    for (const count of [1, -1, Number.NaN, undefined]) {
      const outside = proof(); outside.desktop.projectPreview!.outsideHttpRequests = count as number; expect(() => verifyRuntimeProof(outside)).toThrow('desktop must include');
    }
  });
  it('rejects old 215/218-check complete suites even when every matching-body count agrees', () => {
    for (const count of [215, 218]) {
      const old = proof(); old.desktop.checks = count; old.installer.checks = count;
      old.branches.suiteChecks = count; old.temporary.suiteChecks = count; old.comparisons.suiteChecks = count;
      expect(() => verifyRuntimeProof(old)).toThrow('Complete desktop');
    }
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
    const cases = Array.from({ length: 4 }, proof); cases[0].comparisons.checks = 5; cases[1].comparisons.verificationRun = 'focused model-comparison suite'; cases[2].comparisons.suiteChecks = 199; cases[3].comparisons.comparisonModelRequests = 10;
    for (const value of cases) expect(() => verifyRuntimeProof(value)).toThrow('parallel model-comparison');
    for (const key of ['parallelStreamsVerified', 'independentFailureStopVerified', 'atomicSaveRetryVerified', 'backupsRestartVerified', 'temporaryExclusionVerified', 'originalDraftRetainedVerified', 'originalModelIdentityVerified'] as const) {
      const failed = proof(); failed.comparisons[key] = false; expect(() => verifyRuntimeProof(failed)).toThrow('parallel model-comparison');
      const absent = proof(); delete (absent.comparisons as Partial<ReleaseProof['comparisons']>)[key]; expect(() => verifyRuntimeProof(absent)).toThrow('parallel model-comparison');
      const invalid = proof(); (invalid.comparisons as unknown as Record<string, unknown>)[key] = 'true'; expect(() => verifyRuntimeProof(invalid)).toThrow('parallel model-comparison');
    }
  });
  it('requires complete native MCP subscription evidence without accepting absent, partial or string-valued claims', () => {
    const missing = proof(); delete missing.desktop.mcpResourceSubscriptions; expect(() => verifyRuntimeProof(missing)).toThrow('MCP resource-subscription');
    const partial = proof(); partial.desktop.mcpResourceSubscriptions!.checks = 5; expect(() => verifyRuntimeProof(partial)).toThrow('MCP resource-subscription');
    const requesting = proof(); requesting.desktop.mcpResourceSubscriptions!.modelRequests = 1; expect(() => verifyRuntimeProof(requesting)).toThrow('MCP resource-subscription');
    for (const key of ['realNotificationsVerified', 'explicitDraftInsertionVerified', 'delayedUnsubscribeFiltered', 'templateSelectionVerified', 'disconnectRestartVerified', 'unsupportedServerVerified', 'zoomKeyboardVerified', 'originalDraftRetained'] as const) {
      const failed = proof(); failed.desktop.mcpResourceSubscriptions![key] = false; expect(() => verifyRuntimeProof(failed)).toThrow('MCP resource-subscription');
      const absent = proof(); delete (absent.desktop.mcpResourceSubscriptions as Partial<NonNullable<ReleaseProof['desktop']['mcpResourceSubscriptions']>>)[key]; expect(() => verifyRuntimeProof(absent)).toThrow('MCP resource-subscription');
      const invalid = proof(); (invalid.desktop.mcpResourceSubscriptions as unknown as Record<string, unknown>)[key] = 'true'; expect(() => verifyRuntimeProof(invalid)).toThrow('MCP resource-subscription');
    }
  });
  it('requires complete native binary-file evidence and rejects absent, partial, model-sending or non-boolean claims', () => {
    const missing = proof(); delete missing.desktop.mcpBinaryFiles; expect(() => verifyRuntimeProof(missing)).toThrow('MCP binary-file');
    const partial = proof(); partial.desktop.mcpBinaryFiles!.checks = 5; expect(() => verifyRuntimeProof(partial)).toThrow('MCP binary-file');
    const sending = proof(); sending.desktop.mcpBinaryFiles!.binaryModelRequests = 1; expect(() => verifyRuntimeProof(sending)).toThrow('MCP binary-file');
    for (const key of ['realWorkerPreviewVerified', 'exactOriginalExportVerified', 'emptyAndUnsupportedExportVerified', 'promptBinaryTextOnlyVerified', 'staleSelectionVerified', 'zoomKeyboardVerified', 'restartDraftRetainedVerified'] as const) {
      const failed = proof(); failed.desktop.mcpBinaryFiles![key] = false; expect(() => verifyRuntimeProof(failed)).toThrow('MCP binary-file');
      const absent = proof(); delete (absent.desktop.mcpBinaryFiles as Partial<NonNullable<ReleaseProof['desktop']['mcpBinaryFiles']>>)[key]; expect(() => verifyRuntimeProof(absent)).toThrow('MCP binary-file');
      const invalid = proof(); (invalid.desktop.mcpBinaryFiles as unknown as Record<string, unknown>)[key] = 'true'; expect(() => verifyRuntimeProof(invalid)).toThrow('MCP binary-file');
    }
    const previous = proof(); previous.desktop.checks = 200; expect(() => verifyRuntimeProof(previous)).toThrow('Complete desktop');
  });
  it('rejects the previous complete 206-check body even with matching installation and suite counts', () => {
    const previous = proof(); previous.desktop.checks = 206; previous.installer.checks = 206;
    previous.branches.suiteChecks = 206; previous.temporary.suiteChecks = 206; previous.comparisons.suiteChecks = 206;
    expect(() => verifyRuntimeProof(previous)).toThrow('Complete desktop');
  });
  it('rejects absent, partial, excessive, requesting or incomplete assistant-recipe evidence', () => {
    const missing = proof(); delete missing.desktop.assistantRecipes; expect(() => verifyRuntimeProof(missing)).toThrow('assistant-recipe');
    for (const count of [3, 5, Number.NaN]) {
      const partial = proof(); partial.desktop.assistantRecipes!.checks = count; expect(() => verifyRuntimeProof(partial)).toThrow('assistant-recipe');
    }
    for (const count of [1, -1, Number.NaN, undefined]) {
      const sending = proof(); (sending.desktop.assistantRecipes as unknown as Record<string, unknown>).recipeModelRequests = count; expect(() => verifyRuntimeProof(sending)).toThrow('assistant-recipe');
    }
  });
  it('requires exact boolean proof for recipe binding, parameters, removal recovery, zoom, backup and the retained draft', () => {
    for (const key of ['assistantBindingVerified', 'defaultOptionalChoicesVerified', 'deletedAssistantRecoveryVerified', 'zoomKeyboardVerified', 'backupRestartVerified', 'originalDraftRetained'] as const) {
      const failed = proof(); failed.desktop.assistantRecipes![key] = false; expect(() => verifyRuntimeProof(failed)).toThrow('assistant-recipe');
      const absent = proof(); delete (absent.desktop.assistantRecipes as Partial<NonNullable<ReleaseProof['desktop']['assistantRecipes']>>)[key]; expect(() => verifyRuntimeProof(absent)).toThrow('assistant-recipe');
      const invalid = proof(); (invalid.desktop.assistantRecipes as unknown as Record<string, unknown>)[key] = 'true'; expect(() => verifyRuntimeProof(invalid)).toThrow('assistant-recipe');
    }
  });
  it('rejects the previous 210-check application even with matching complete suite and installation counts', () => {
    const previous = proof(); previous.desktop.checks = 210; previous.installer.checks = 210;
    previous.branches.suiteChecks = 210; previous.temporary.suiteChecks = 210; previous.comparisons.suiteChecks = 210;
    expect(() => verifyRuntimeProof(previous)).toThrow('Complete desktop');
  });
  it('rejects missing, partial, excessive and requesting prompt-transfer proof', () => {
    const missing = proof(); delete missing.desktop.promptTransfer; expect(() => verifyRuntimeProof(missing)).toThrow('prompt-transfer');
    for (const count of [0, 4, 6, Number.NaN]) { const partial = proof(); partial.desktop.promptTransfer!.checks = count; expect(() => verifyRuntimeProof(partial)).toThrow('prompt-transfer'); }
    for (const count of [1, -1, Number.NaN, '0']) { const requesting = proof(); (requesting.desktop.promptTransfer as unknown as Record<string, unknown>).transferModelRequests = count; expect(() => verifyRuntimeProof(requesting)).toThrow('prompt-transfer'); }
  });
  it('requires exact booleans for prompt export, preview/cancel, atomic retry, fresh shared bindings, zoom, backup and draft retention', () => {
    for (const key of ['exportModesVerified', 'inertPreviewCancelVerified', 'atomicImportRetryVerified', 'sharedFreshAssociationsVerified', 'zoomKeyboardVerified', 'backupRestartVerified', 'originalDraftRetained'] as const) {
      const failed = proof(); failed.desktop.promptTransfer![key] = false; expect(() => verifyRuntimeProof(failed)).toThrow('prompt-transfer');
      const absent = proof(); delete (absent.desktop.promptTransfer as Partial<NonNullable<ReleaseProof['desktop']['promptTransfer']>>)[key]; expect(() => verifyRuntimeProof(absent)).toThrow('prompt-transfer');
      const invalid = proof(); (invalid.desktop.promptTransfer as unknown as Record<string, unknown>)[key] = 'true'; expect(() => verifyRuntimeProof(invalid)).toThrow('prompt-transfer');
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
  it('loads all eleven independent records and passes their matching-body policy without changing their data', async () => {
    const { root, value } = await proofFiles(); const actual = await readRuntimeProof(root); expect(Object.keys(actual)).toHaveLength(11); expect(actual).toEqual(value); expect(() => verifyRuntimeProof(actual)).not.toThrow();
  });
  it('rejects missing required comparison evidence without exposing its filesystem location', async () => {
    const { root } = await proofFiles(); await rm(join(root, 'verification', runtimeProofFiles.comparisons)); const error = await readRuntimeProof(root).catch((error) => error);
    expect(error.message).toContain('comparisons'); expect(error.message).not.toContain(root);
  });
  it('rejects malformed JSON, null, arrays and primitive records without exposing their contents', async () => {
    const { root } = await proofFiles(); for (const content of ['PRIVATE_INVALID_JSON', 'null', '[]', '"PRIVATE_RECORD_CONTENT"']) { await writeFile(join(root, 'verification', runtimeProofFiles.audit), content); const error = await readRuntimeProof(root).catch((error) => error); expect(error.message).toContain('proof (audit)'); expect(error.message).not.toMatch(/PRIVATE|qiyao-runtime-proof-/); }
  });
});
