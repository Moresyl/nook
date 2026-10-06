export type DesktopProcessObservation =
  | { pid: number; exited: true }
  | { pid: number; unavailable: true }
  | { pid: number; cpuMilliseconds: number; workingSetBytes: number; threads: { id: number; state: string; reason: string }[] };

type Executor = (program: string, args: string[], options: { windowsHide: boolean; timeout: number; maxBuffer: number }) => Promise<{ stdout: string }>;

export function observeDesktopProcesses(pids: unknown, execute?: Executor): Promise<DesktopProcessObservation[]>;
