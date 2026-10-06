import type { Workspace } from '../../contracts/workspace';

/** Validated workspace records are detached individually to bound temporary serializer allocations. */
export function copyWorkspace(state: Workspace): Workspace {
  return Object.fromEntries(Object.entries(state).map(([key, value]) => [key,
    Array.isArray(value) ? value.map(record => structuredClone(record)) : structuredClone(value),
  ])) as Workspace;
}
