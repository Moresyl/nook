export type StartupEvent = { phase: string; at: number; memory: NodeJS.MemoryUsage; cpu: NodeJS.CpuUsage };

export class StartupDiagnostics {
  private events: StartupEvent[] = [];
  constructor(private readonly enabled: boolean, private readonly now = Date.now,
    private readonly memory: () => NodeJS.MemoryUsage = process.memoryUsage, private readonly cpu: () => NodeJS.CpuUsage = process.cpuUsage) {}

  phase(phase: string): void {
    if (!this.enabled) return;
    this.events.push({ phase, at: this.now(), memory: this.memory(), cpu: this.cpu() });
    if (this.events.length > 32) this.events.shift();
  }

  snapshot(): { events: StartupEvent[] } | undefined {
    return this.enabled ? structuredClone({ events: this.events }) : undefined;
  }
}
