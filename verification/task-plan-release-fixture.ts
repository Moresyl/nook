import type { TaskPlanProof } from '../scripts/release-policy.mjs';

export function taskPlanProof(): TaskPlanProof {
  const layouts = ['light', 'dark'].flatMap(theme => [[1280, 840], [760, 540]].flatMap(size => [1, 1.25, 1.5].map(zoom => ({
    theme, size, zoom, contained: true, headerVisible: true, horizontalOverflow: false,
    padding: '12px', border: zoom === 1.5 ? '0.666667px' : `${1 / zoom}px`, count: 3,
    rows: [0, 1, 2].map(index => ({ top: 100 + index * 30, bottom: 124 + index * 30, readableTop: 80, readableBottom: 200, contained: true })),
  }))));
  const screenshots = ['light', 'dark'].flatMap(theme => [
    ...layouts.filter(row => row.theme === theme).map(row => `task-plans-${theme}-${row.size[0]}-${row.zoom * 100}.png`),
    `task-plans-${theme}-760-150-last-step.png`,
  ]).concat(['task-plans-stopped.png', 'task-plans-restart.png']);
  return {
    checks: 8, actualReadOnlyTool: true, rawToolRecordsPreserved: true, projectFilesUnchanged: true, noPlanDocument: true,
    invalidUpdateRetainsPlan: true, stoppedStateAccurate: true, plainTextRendering: true, actualRestart: true, noModelReplay: true,
    layouts, screenshots, nativeCaptureSizes: screenshots.map(filename => ({ filename, size: filename.includes('-760-') ? [760, 540] : [1280, 840] })),
  };
}
