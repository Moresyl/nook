import { describe, expect, it } from 'vitest';
import { verifyTaskPlanProof, type TaskPlanProof } from '../scripts/release-policy.mjs';
import { taskPlanProof } from './task-plan-release-fixture';

const message = 'Complete task-plan';
const flags = ['actualReadOnlyTool', 'rawToolRecordsPreserved', 'projectFilesUnchanged', 'noPlanDocument', 'invalidUpdateRetainsPlan', 'stoppedStateAccurate', 'plainTextRendering', 'actualRestart', 'noModelReplay'] as const;

describe('task-plan release evidence', () => {
  it('accepts complete twelve-layout, sixteen-capture proof including fractional device-pixel borders', () => {
    expect(() => verifyTaskPlanProof(taskPlanProof())).not.toThrow();
  });

  it('rejects missing, partial and nonnumeric check totals', () => {
    expect(() => verifyTaskPlanProof(undefined)).toThrow(message);
    for (const checks of [0, 7, 9, Number.NaN, '8']) {
      const value = taskPlanProof(); Object.assign(value, { checks });
      expect(() => verifyTaskPlanProof(value)).toThrow(message);
    }
  });

  it.each(flags)('requires a strict recorded %s result', flag => {
    for (const state of [false, undefined, 'true', 1]) {
      const value = taskPlanProof(); Object.assign(value, { [flag]: state });
      expect(() => verifyTaskPlanProof(value)).toThrow(message);
    }
  });

  it('rejects missing or duplicate layouts and unsupported theme, size and zoom', () => {
    const changes: ((value: TaskPlanProof) => void)[] = [
      value => { value.layouts.pop(); },
      value => { value.layouts[1] = structuredClone(value.layouts[0]); },
      value => { value.layouts[0].theme = 'system'; },
      value => { value.layouts[0].size = [1280, 839]; },
      value => { value.layouts[0].zoom = 2; },
      value => { Object.assign(value, { layouts: null }); },
    ];
    for (const change of changes) { const value = taskPlanProof(); change(value); expect(() => verifyTaskPlanProof(value)).toThrow(message); }
  });

  it('rejects hidden headers, overflow and incorrect recorded card geometry', () => {
    for (const fields of [{ contained: false }, { headerVisible: false }, { horizontalOverflow: true }, { padding: '8px' }, { border: '0px' }, { border: '1rem' }, { border: 'NaNpx' }, { count: 2 }]) {
      const value = taskPlanProof(); Object.assign(value.layouts[0], fields);
      expect(() => verifyTaskPlanProof(value)).toThrow(message);
    }
  });

  it('requires all three finite, nonempty step bounds inside the readable region in every layout', () => {
    for (let index = 0; index < 12; index += 1) for (const fields of [{ contained: false }, { top: 0 }, { bottom: 250 }, { top: Number.NaN }, { readableBottom: Infinity }, { bottom: 100 }, { readableTop: 200 }]) {
      const value = taskPlanProof(); Object.assign(value.layouts[index].rows[0], fields);
      expect(() => verifyTaskPlanProof(value)).toThrow(message);
    }
    const missing = taskPlanProof(); missing.layouts[0].rows.pop(); expect(() => verifyTaskPlanProof(missing)).toThrow(message);
  });

  it('requires the exact unique screenshot names including separate last-step, stopped and restart frames', () => {
    for (let index = 0; index < 16; index += 1) {
      const missing = taskPlanProof(); missing.screenshots.splice(index, 1); expect(() => verifyTaskPlanProof(missing)).toThrow(message);
      const replaced = taskPlanProof(); replaced.screenshots[index] = '../other.png'; expect(() => verifyTaskPlanProof(replaced)).toThrow(message);
    }
    const duplicate = taskPlanProof(); duplicate.screenshots[1] = duplicate.screenshots[0]; expect(() => verifyTaskPlanProof(duplicate)).toThrow(message);
  });

  it('rejects clipped native dimensions, unknown or duplicate captures and missing dimension reports', () => {
    for (let index = 0; index < 16; index += 1) {
      const wrong = taskPlanProof(); wrong.nativeCaptureSizes[index].size[0] -= 1; expect(() => verifyTaskPlanProof(wrong)).toThrow(message);
      const height = taskPlanProof(); height.nativeCaptureSizes[index].size[1] -= 1; expect(() => verifyTaskPlanProof(height)).toThrow(message);
      const short = taskPlanProof(); short.nativeCaptureSizes[index].size.pop(); expect(() => verifyTaskPlanProof(short)).toThrow(message);
      const missing = taskPlanProof(); missing.nativeCaptureSizes.splice(index, 1); expect(() => verifyTaskPlanProof(missing)).toThrow(message);
    }
    const unknown = taskPlanProof(); unknown.nativeCaptureSizes[0].filename = 'unknown.png'; expect(() => verifyTaskPlanProof(unknown)).toThrow(message);
    const duplicate = taskPlanProof(); duplicate.nativeCaptureSizes[1] = structuredClone(duplicate.nativeCaptureSizes[0]); expect(() => verifyTaskPlanProof(duplicate)).toThrow(message);
    const absent = taskPlanProof(); Object.assign(absent, { nativeCaptureSizes: null }); expect(() => verifyTaskPlanProof(absent)).toThrow(message);
  });
});
