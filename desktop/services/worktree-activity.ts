/** Serialize application cleanup against in-flight actions; external processes are not locked. */
export class WorktreeActivity {
  private readers = 0;
  private cleaning = false;
  get idle(): boolean { return !this.cleaning && this.readers === 0; }
  assertAvailable(): void {
    if (this.cleaning) throw new Error('Worktree cleanup is running. Retry after it finishes.');
  }
  async run<T>(action: () => T | Promise<T>): Promise<T> {
    this.assertAvailable(); this.readers++;
    try { return await action(); } finally { this.readers--; }
  }
  async exclusive<T>(action: () => T | Promise<T>): Promise<T> {
    if (this.cleaning || this.readers) throw new Error('The workspace is busy. Retry worktree cleanup after current actions finish.');
    this.cleaning = true;
    try { return await action(); } finally { this.cleaning = false; }
  }
}
